"""Real archives and SQLite; the restore command itself is never mocked."""
import hashlib
import io
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import tarfile
import tempfile
import unittest

REPO = Path(__file__).resolve().parents[2]


class SnapshotTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="ftc-snapshot-test-")
        self.root = Path(self.temp.name)
        self.data = self.root / "source"
        (self.data / "db").mkdir(parents=True)
        (self.data / "originals").mkdir()
        self.original = b"synthetic original bytes"
        (self.data / "originals/photo.jpg").write_bytes(self.original)
        with sqlite3.connect(self.data / "db/capsule.sqlite") as db:
            db.executescript("""
                CREATE TABLE family(id TEXT PRIMARY KEY, name TEXT);
                CREATE TABLE user(id TEXT PRIMARY KEY, family_id TEXT REFERENCES family(id), disabled_at INTEGER);
                CREATE TABLE memory_event(id TEXT PRIMARY KEY, family_id TEXT REFERENCES family(id),
                  created_by_user_id TEXT REFERENCES user(id), visibility TEXT, body_text TEXT, occurred_at_precision TEXT);
                CREATE TABLE asset(id TEXT PRIMARY KEY, storage_key TEXT, bytes INTEGER, sha256 TEXT, original_asset_id TEXT);
                CREATE TABLE session(id TEXT PRIMARY KEY, token TEXT, user_id TEXT REFERENCES user(id));
                CREATE TABLE verification(id TEXT PRIMARY KEY, value TEXT);
                CREATE TABLE sync_state(id TEXT PRIMARY KEY, generation TEXT, last_seq INTEGER, floor_seq INTEGER);
                CREATE TABLE sync_cursor(id TEXT PRIMARY KEY);
                CREATE TABLE guest_read_grant(id TEXT PRIMARY KEY, revoked_at INTEGER);
                CREATE TABLE family_invitation(id TEXT PRIMARY KEY, revoked_at INTEGER);
                INSERT INTO family VALUES ('f','Synthetic family');
                INSERT INTO user VALUES ('a','f',NULL),('b','f',42);
                INSERT INTO memory_event VALUES ('m','f','a','private','Preserved private text','unknown');
                INSERT INTO session VALUES ('s','old-session-token','a');
                INSERT INTO verification VALUES ('v','old-one-time-code');
                INSERT INTO sync_state VALUES ('instance','old-generation',12,0);
                INSERT INTO sync_cursor VALUES ('old-cursor');
                INSERT INTO guest_read_grant VALUES ('g',NULL);
                INSERT INTO family_invitation VALUES ('i',NULL);
            """)
            db.execute("INSERT INTO asset VALUES (?,?,?,?,NULL)",
                       ("photo", "originals/photo.jpg", len(self.original), hashlib.sha256(self.original).hexdigest()))
        self.env_bytes = b"AUTH_SECRET=synthetic-retained-secret\nFTC_DATA_VOLUME=original-live-volume\nAI_PROVIDER=openai-compatible\n"

    def tearDown(self):
        self.temp.cleanup()

    def archive(self, *, additions=(), outer_additions=(), omit=(), version=1):
        inner = io.BytesIO()
        with tarfile.open(fileobj=inner, mode="w") as tar:
            for item in sorted(self.data.rglob("*")):
                tar.add(item, arcname="./" + item.relative_to(self.data).as_posix(), recursive=False)
            for member, payload in additions:
                tar.addfile(member, io.BytesIO(payload) if payload is not None else None)
        archive = self.root / "snapshot.tar.gz"
        with tarfile.open(archive, "w:gz") as tar:
            for name, payload in {
                "manifest.json": json.dumps({"kind": "ftc-instance-snapshot", "version": version}).encode(),
                "env": self.env_bytes, "data.tar": inner.getvalue(),
            }.items():
                if name in omit:
                    continue
                member = tarfile.TarInfo(name)
                member.size = len(payload)
                tar.addfile(member, io.BytesIO(payload))
            for member, payload in outer_additions:
                tar.addfile(member, io.BytesIO(payload) if payload is not None else None)
        digest = hashlib.sha256(archive.read_bytes()).hexdigest()
        archive.with_name(archive.name + ".sha256").write_text(f"{digest}  {archive.name}\n")
        return archive

    def run_restore(self, archive, target=None):
        target = target or self.root / "restored"
        result = subprocess.run(["bash", str(REPO / "scripts/ops/restore.sh"), str(archive), "--to", str(target)],
                                env={**os.environ, "FTC_ROOT": str(self.root / "operator")},
                                capture_output=True, text=True, timeout=30)
        return result, target

    def assert_rejected_cleanly(self, archive, target=None):
        result, target = self.run_restore(archive, target)
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertTrue(not target.exists() or not list(target.iterdir()), result.stdout + result.stderr)
        self.assertFalse(list(target.parent.glob(".ftc-restore-*")))

    def test_roundtrip_preserves_core_and_invalidates_old_capabilities(self):
        archive = self.archive()
        original_archive = archive.read_bytes()
        target = self.root / "restore with space and ' quote"
        result, target = self.run_restore(archive, target)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual((target / "data/originals/photo.jpg").read_bytes(), self.original)
        self.assertEqual((target / "config/env.snapshot").read_bytes(), self.env_bytes)
        self.assertNotIn("original-live-volume", (target / "config/env").read_text())
        self.assertNotIn("synthetic-retained-secret", result.stdout + result.stderr)
        with sqlite3.connect(target / "data/db/capsule.sqlite") as db:
            self.assertEqual(db.execute("SELECT * FROM memory_event").fetchall(),
                             [("m", "f", "a", "private", "Preserved private text", "unknown")])
            self.assertEqual(db.execute("SELECT * FROM user ORDER BY id").fetchall(), [("a", "f", None), ("b", "f", 42)])
            self.assertEqual(db.execute("SELECT count(*) FROM session").fetchone()[0], 0)
            self.assertEqual(db.execute("SELECT count(*) FROM verification").fetchone()[0], 0)
            self.assertEqual(db.execute("SELECT count(*) FROM sync_cursor").fetchone()[0], 0)
            generation, floor = db.execute("SELECT generation,floor_seq FROM sync_state").fetchone()
            self.assertNotEqual(generation, "old-generation")
            self.assertEqual(floor, 12)
            self.assertIsNotNone(db.execute("SELECT revoked_at FROM guest_read_grant").fetchone()[0])
            self.assertIsNotNone(db.execute("SELECT revoked_at FROM family_invitation").fetchone()[0])
        self.assertEqual(archive.read_bytes(), original_archive)
        with sqlite3.connect(self.data / "db/capsule.sqlite") as db:
            self.assertEqual(db.execute("SELECT token FROM session").fetchone()[0], "old-session-token")
        report = json.loads((target / "restore-report.json").read_text())
        self.assertEqual(report["originalCount"], 1)
        self.assertFalse(report["postSnapshotRevocationsReconciled"])
        install = subprocess.run(["bash", str(REPO / "scripts/ops/install.sh"), "--yes"],
                                 env={**os.environ, "FTC_ROOT": str(target)}, capture_output=True, text=True)
        self.assertEqual(install.returncode, 24, install.stderr)
        self.assertFalse((target / "releases").exists())

    def test_committed_wal_contents_are_included(self):
        db = sqlite3.connect(self.data / "db/capsule.sqlite")
        try:
            db.execute("PRAGMA journal_mode=WAL")
            db.execute("PRAGMA wal_autocheckpoint=0")
            db.execute("UPDATE memory_event SET body_text='Committed in WAL'")
            db.commit()
            self.assertTrue((self.data / "db/capsule.sqlite-wal").exists())
            result, target = self.run_restore(self.archive())
            self.assertEqual(result.returncode, 0, result.stderr)
            with sqlite3.connect(target / "data/db/capsule.sqlite") as restored:
                self.assertEqual(restored.execute("SELECT body_text FROM memory_event").fetchone()[0], "Committed in WAL")
        finally:
            db.close()

    def test_dangling_foreign_keys_are_rejected(self):
        with sqlite3.connect(self.data / "db/capsule.sqlite") as db:
            db.execute("DELETE FROM family")
        self.assert_rejected_cleanly(self.archive())

    def test_inner_links_and_special_files_are_rejected(self):
        for kind, destination in ((tarfile.SYMTYPE, "/tmp"), (tarfile.LNKTYPE, "../outside"), (tarfile.FIFOTYPE, "")):
            with self.subTest(kind=kind):
                member = tarfile.TarInfo("special")
                member.type, member.linkname = kind, destination
                self.assert_rejected_cleanly(self.archive(additions=((member, None),)))

    def test_changed_original_with_valid_outer_checksum_is_rejected(self):
        (self.data / "originals/photo.jpg").write_bytes(b"x" * len(self.original))
        self.assert_rejected_cleanly(self.archive())

    def test_missing_original_and_invalid_sqlite_are_rejected(self):
        (self.data / "originals/photo.jpg").unlink()
        self.assert_rejected_cleanly(self.archive())
        (self.data / "db/capsule.sqlite").write_bytes(b"not a database")
        self.assert_rejected_cleanly(self.archive())

    def test_outer_symbolic_link_cannot_copy_an_unrelated_host_file(self):
        secret = self.root / "unrelated-secret"
        secret.write_text("must remain outside the restoration")
        link = tarfile.TarInfo("env")
        link.type, link.linkname = tarfile.SYMTYPE, str(secret)
        self.assert_rejected_cleanly(self.archive(omit=("env",), outer_additions=((link, None),)))

    def test_traversal_and_duplicate_entries_leave_no_partial_target(self):
        for name in ("dir/../../escaped", "/absolute", "originals/photo.jpg", "../escaped"):
            with self.subTest(name=name):
                member = tarfile.TarInfo(name)
                member.size = 4
                self.assert_rejected_cleanly(self.archive(additions=((member, b"evil"),)))
        self.assertFalse((self.root / "escaped").exists())

    def test_missing_config_and_unknown_version_leave_no_partial_target(self):
        self.assert_rejected_cleanly(self.archive(omit=("env",)))
        self.assert_rejected_cleanly(self.archive(version=42))

    def test_checksum_cannot_point_at_another_file(self):
        archive = self.archive()
        other = self.root / "other"
        other.write_bytes(b"other bytes")
        digest = hashlib.sha256(other.read_bytes()).hexdigest()
        archive.with_name(archive.name + ".sha256").write_text(f"{digest}  other\n")
        self.assert_rejected_cleanly(archive)

    def test_target_symlink_or_nonempty_directory_is_refused(self):
        archive = self.archive()
        elsewhere = self.root / "elsewhere"
        elsewhere.mkdir()
        target = self.root / "linked"
        target.symlink_to(elsewhere, target_is_directory=True)
        result, _ = self.run_restore(archive, target)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(list(elsewhere.iterdir()), [])
        target.unlink()
        target.mkdir()
        (target / "keep").write_text("unchanged")
        result, _ = self.run_restore(archive, target)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual([p.name for p in target.iterdir()], ["keep"])

    def test_hardlink_to_regular_archived_file_is_copied_safely(self):
        link = tarfile.TarInfo("uploads/interrupted-copy")
        link.type, link.linkname = tarfile.LNKTYPE, "./originals/photo.jpg"
        result, target = self.run_restore(self.archive(additions=((link, None),)))
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual((target / "data/uploads/interrupted-copy").read_bytes(), self.original)


if __name__ == "__main__":
    unittest.main()
