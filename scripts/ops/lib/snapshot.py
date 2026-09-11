#!/usr/bin/env python3
"""Verify and restore instance snapshots without executing archived configuration.

Only regular files, directories and archive-internal hardlinks are accepted.
The destination is published only after SQLite, original bytes and recovery
state have all been checked. Original archives are never modified.
"""
import argparse
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import sqlite3
import sys
import tarfile
import tempfile
import time

CHUNK = 1024 * 1024
RESERVE_BYTES = 128 * 1024 * 1024
MAX_MEMBERS = 1_000_000


class SnapshotError(Exception):
    pass


def require(condition, code):
    if not condition:
        raise SnapshotError(code)


def hash_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as source:
        for chunk in iter(lambda: source.read(CHUNK), b""):
            digest.update(chunk)
    return digest.hexdigest()


def member_name(raw, directory=False):
    require(isinstance(raw, str) and not any(ord(c) < 32 for c in raw), "unsafe_archive_path")
    require(not raw.startswith("/") and "\\" not in raw and ":" not in raw, "unsafe_archive_path")
    while raw.startswith("./"):
        raw = raw[2:]
    if directory:
        raw = raw.rstrip("/")
    if raw in ("", ".") and directory:
        return ""
    require(raw and all(p not in ("", ".", "..") for p in raw.split("/")), "unsafe_archive_path")
    return raw


def require_space(directory, size):
    require(isinstance(size, int) and size >= 0, "invalid_archive_size")
    require(shutil.disk_usage(directory).free >= size + RESERVE_BYTES, "insufficient_staging_space")


def copy_member(tar, member, target):
    target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    require_space(target.parent, member.size)
    source = tar.extractfile(member)
    require(source is not None, "unreadable_archive_entry")
    remaining = member.size
    with source, open(target, "xb") as output:
        os.chmod(target, 0o600)
        while remaining:
            chunk = source.read(min(CHUNK, remaining))
            require(chunk, "truncated_archive_entry")
            output.write(chunk)
            remaining -= len(chunk)


def unpack_data(archive, destination):
    destination.mkdir(mode=0o700)
    seen = {}
    links = []
    with tarfile.open(archive, "r:") as tar:
        for member in tar:
            require(len(seen) < MAX_MEMBERS, "too_many_archive_entries")
            name = member_name(member.name, member.isdir())
            require(name not in seen, "duplicate_archive_entry")
            require(member.isfile() or member.isdir() or member.islnk(), "unsupported_archive_entry")
            seen[name] = member
            if not name:
                continue
            target = destination / name
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True, mode=0o700)
            elif member.islnk():
                links.append((name, member_name(member.linkname)))
            else:
                copy_member(tar, member, target)
    for name, link in links:
        # Upload finalization briefly uses hardlinks. Materialize only links to
        # a regular file in this same archive, never to host files or other links.
        require(link in seen and seen[link].isfile(), "unsafe_archive_hardlink")
        target = destination / name
        target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        require_space(target.parent, (destination / link).stat().st_size)
        with open(destination / link, "rb") as source, open(target, "xb") as output:
            os.chmod(target, 0o600)
            shutil.copyfileobj(source, output, CHUNK)


def verify_archive(archive, staging):
    checksum = Path(str(archive) + ".sha256")
    require(checksum.is_file() and checksum.stat().st_size <= 8192, "missing_or_invalid_checksum")
    match = re.fullmatch(r"([0-9a-fA-F]{64}) [ *]([^\r\n]+)\n?", checksum.read_text(encoding="utf-8"))
    require(match is not None and match[2] == archive.name, "checksum_filename_mismatch")
    # Unpack a private copy of the exact bytes whose checksum was verified.
    source_size = archive.stat().st_size
    require_space(staging, source_size)
    digest_state = hashlib.sha256()
    snapshot_copy = staging / "input.tar.gz"
    copied = 0
    with open(archive, "rb") as source, open(snapshot_copy, "xb") as output:
        for chunk in iter(lambda: source.read(CHUNK), b""):
            copied += len(chunk)
            require(copied <= source_size, "snapshot_changed_while_reading")
            output.write(chunk)
            digest_state.update(chunk)
    require(copied == source_size, "snapshot_changed_while_reading")
    digest = digest_state.hexdigest()
    require(digest == match[1].lower(), "snapshot_checksum_mismatch")
    expected = {"manifest.json", "env", "data.tar"}
    seen = set()
    with tarfile.open(snapshot_copy, "r:gz") as tar:
        for member in tar:
            name = member_name(member.name, member.isdir())
            if not name and member.isdir():
                continue
            require(name in expected and name not in seen and member.isfile(), "invalid_snapshot_structure")
            require(member.size <= {"manifest.json": 65536, "env": CHUNK}.get(name, member.size), "snapshot_metadata_too_large")
            copy_member(tar, member, staging / name)
            seen.add(name)
    require(seen == expected, "incomplete_snapshot")
    manifest = json.loads((staging / "manifest.json").read_text(encoding="utf-8"))
    require(isinstance(manifest, dict) and manifest.get("kind") == "ftc-instance-snapshot", "wrong_snapshot_kind")
    require(type(manifest.get("version")) is int and manifest["version"] == 1, "unsupported_snapshot_version")
    require((staging / "env").stat().st_size > 0, "empty_snapshot_configuration")
    unpack_data(staging / "data.tar", staging / "data")
    report = verify_database(staging / "data")
    report["snapshotSha256"] = digest
    # Non-secret provenance is carried into the isolated restore for pairing.
    configuration = dict(line.split("=", 1) for line in (staging / "env").read_text(encoding="utf-8").splitlines() if "=" in line and not line.startswith("#"))
    report["snapshotAppVersion"] = manifest.get("appVersion")
    report["snapshotImage"] = configuration.get("FTC_IMAGE")
    report["snapshotImageReference"] = manifest.get("image")
    return report


def table_names(db):
    return {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}


@contextmanager
def open_database(data, readonly=True):
    database = data / "db/capsule.sqlite"
    require(database.is_file(), "missing_database")
    # URI quoting handles spaces, quotes and query characters without letting a
    # pathname inject SQLite URI options.
    db = sqlite3.connect(database.as_uri() + ("?mode=ro" if readonly else "?mode=rw"))
    try:
        db.execute("PRAGMA foreign_keys=ON")
        db.execute("PRAGMA busy_timeout=5000")
        with db:
            yield db
    finally:
        db.close()


def verify_database(data):
    with open_database(data) as db:
        require({"family", "user", "memory_event", "asset", "session", "verification"} <= table_names(db), "incomplete_database_schema")
        require(db.execute("PRAGMA integrity_check").fetchall() == [("ok",)], "database_integrity_failed")
        require(db.execute("PRAGMA foreign_key_check").fetchone() is None, "database_foreign_keys_failed")
        count = total = 0
        for asset_id, key, size, sha in db.execute("SELECT id,storage_key,bytes,sha256 FROM asset WHERE original_asset_id IS NULL"):
            require(isinstance(key, str) and member_name(key) == key and key.startswith("originals/"), "invalid_original_storage_key")
            require(type(size) is int and size >= 0 and isinstance(sha, str) and re.fullmatch(r"[0-9a-f]{64}", sha), "invalid_original_metadata")
            original = data / key
            require(original.is_file() and not original.is_symlink(), "missing_original")
            require(original.stat().st_size == size and hash_file(original) == sha, "original_checksum_mismatch")
            count += 1
            total += size
        return {"originalCount": count, "originalBytes": total,
                "familyCount": db.execute("SELECT count(*) FROM family").fetchone()[0],
                "memoryCount": db.execute("SELECT count(*) FROM memory_event").fetchone()[0]}


def reset_recovery_capabilities(data):
    with open_database(data, readonly=False) as db:
        tables = table_names(db)
        db.execute("BEGIN IMMEDIATE")
        removed_sessions = db.execute("DELETE FROM session").rowcount
        db.execute("DELETE FROM verification")
        rotated = False
        if "sync_state" in tables:
            changed = db.execute("UPDATE sync_state SET generation=?,floor_seq=last_seq WHERE id='instance'", (secrets.token_hex(16),))
            require(changed.rowcount == 1, "invalid_sync_state")
            rotated = True
        if "sync_cursor" in tables:
            require(rotated, "invalid_sync_state")
            db.execute("DELETE FROM sync_cursor")
        revoked = {}
        for table in ("guest_read_grant", "family_invitation"):
            if table in tables:
                revoked[table] = db.execute(f"UPDATE {table} SET revoked_at=? WHERE revoked_at IS NULL", (int(time.time()),)).rowcount
        require(db.execute("PRAGMA foreign_key_check").fetchone() is None, "recovery_foreign_keys_failed")
    return {"invalidatedSessionCount": removed_sessions, "syncGenerationRotated": rotated, "revokedLinks": revoked}


def sync_directory(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def sync_tree(root):
    for directory, _, files in os.walk(root, topdown=False):
        for name in files:
            with open(Path(directory) / name, "rb") as file:
                os.fsync(file.fileno())
        sync_directory(directory)


def restore(archive, target):
    require(not target.is_symlink() and target.name not in ("", ".", ".."), "invalid_restore_target")
    target = target.parent.resolve(strict=True) / target.name
    if target.exists():
        require(target.is_dir() and target.stat().st_uid == os.getuid() and not any(target.iterdir()), "restore_target_not_empty")
    # A sibling staging directory makes the final rename atomic on this filesystem.
    with tempfile.TemporaryDirectory(prefix=".ftc-restore-", dir=target.parent) as temporary:
        staging = Path(temporary)
        report = verify_archive(archive, staging)
        report.update(reset_recovery_capabilities(staging / "data"))
        verify_database(staging / "data")
        published = staging / "ready"
        published.mkdir(mode=0o700)
        (published / "config").mkdir(mode=0o700)
        os.rename(staging / "data", published / "data")
        # Preserve the original config as evidence, not as executable/active
        # configuration: it may select the live volume, public origin or AI keys.
        os.rename(staging / "env", published / "config/env.snapshot")
        (published / "config/env").write_text(
            "# Isolated restore verification; fill these explicitly.\n"
            "# AUTH_SECRET must retain the original value for encrypted 2FA data.\n"
            "AUTH_SECRET=\nFTC_RESTORE_IMAGE=\nFTC_RESTORE_PORT=\n"
            "FTC_RESTORE_DATA_DIR=\nFTC_RESTORE_UID=\nFTC_RESTORE_GID=\n"
            "FTC_RESTORE_PROJECT=\nAI_PROVIDER=disabled\n", encoding="utf-8")
        os.chmod(published / "config/env", 0o600)
        report.update({"kind": "ftc-isolated-restore", "version": 1, "restoredAt": int(time.time()),
                       "postSnapshotRevocationsReconciled": False,
                       "activation": "isolated-verification-only"})
        (published / "restore-report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        os.chmod(published / "restore-report.json", 0o600)
        sync_tree(published)
        # rename refuses a nonempty target or a target swapped for a symlink.
        os.rename(published, target)
        sync_directory(target.parent)
        return report


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=("verify", "restore"))
    parser.add_argument("archive", type=Path)
    parser.add_argument("--to", type=Path)
    args = parser.parse_args()
    archive = args.archive.absolute()
    try:
        require(archive.is_file(), "missing_snapshot")
        if args.operation == "restore":
            require(args.to is not None, "missing_restore_target")
            report = restore(archive, args.to.absolute())
        else:
            # Use the snapshot filesystem for potentially large temporary data,
            # rather than unexpectedly filling a small system /tmp partition.
            with tempfile.TemporaryDirectory(prefix=".ftc-verify-", dir=archive.parent) as directory:
                report = verify_archive(archive, Path(directory))
        print(json.dumps(report))
        return 0
    except (SnapshotError, OSError, ValueError, sqlite3.Error, tarfile.TarError) as error:
        # Never print archived filenames, private text, SQL or credential values.
        code = str(error) if isinstance(error, SnapshotError) else "invalid_or_unreadable_snapshot"
        print(f"[ftc:error] {code}", file=sys.stderr)
        return 22


if __name__ == "__main__":
    sys.exit(main())
