/** Isolated old-schema upgrade and old-export restore; no checkout/branch or old application build. */
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  copyFileSync,
  symlinkSync,
  cpSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import JSZip from "jszip";
async function main() {
  const repo = process.cwd(),
    root = mkdtempSync(path.join(tmpdir(), "ftc-upgrade12-matrix-")),
    legacy = path.join(root, "legacy-source"),
    oldVolume = path.join(root, "volume11"),
    fixtures = path.join(root, "fixtures");
  mkdirSync(legacy);
  mkdirSync(oldVolume);
  mkdirSync(fixtures);
  const run = (
    cmd: string,
    args: string[],
    cwd = repo,
    env: Record<string, string> = {},
  ) => {
    const r = spawnSync(cmd, args, {
      cwd,
      env: { ...process.env, ...env },
      encoding: "utf8",
      timeout: 180000,
    });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    return r.stdout;
  };
  const sha = run("git", ["rev-parse", "v1.1.0-alpha.1^{commit}"]).trim();
  const tar = path.join(root, "legacy.tar");
  run("git", ["archive", "v1.1.0-alpha.1", "--output", tar]);
  run("tar", ["-xf", tar, "-C", legacy]);
  symlinkSync(
    path.join(repo, "node_modules"),
    path.join(legacy, "node_modules"),
    "dir",
  );
  copyFileSync(
    path.join(repo, "scripts/fixture-legacy11.mts"),
    path.join(legacy, "scripts/fixture-legacy11.mts"),
  );
  const credentials = {
    INITIAL_SETUP_TOKEN: "fictional-upgrade12",
    AUTH_SECRET: "fictional-upgrade12-secret",
  };
  run(
    process.execPath,
    [
      "--conditions=react-server",
      "--import",
      path.join(repo, "node_modules/tsx/dist/loader.mjs"),
      "scripts/fixture-legacy11.mts",
    ],
    legacy,
    { ...credentials, DATA_DIR: oldVolume, FTC_FIXTURE_OUTPUT: fixtures },
  );
  const expected = JSON.parse(
      readFileSync(path.join(fixtures, "expected.json"), "utf8"),
    ),
    file = path.join(oldVolume, "db/capsule.sqlite"),
    old = new Database(file);
  assert.equal(
    (
      old
        .prepare("select count(*) n from sqlite_schema where name='collection'")
        .get() as { n: number }
    ).n,
    0,
  );
  const rows = old.prepare("select * from memory_event order by id").all();
  old.close();
  const originalShas = (volume: string) =>
    expected.assets.map((a: { storageKey: string; sha256: string }) => {
      const actual = createHash("sha256")
        .update(readFileSync(path.join(volume, a.storageKey)))
        .digest("hex");
      assert.equal(actual, a.sha256);
      return actual;
    });
  originalShas(oldVolume);
  const upgrade = path.join(root, "volume-upgrade"),
    failure = path.join(root, "volume-failure");
  cpSync(oldVolume, upgrade, { recursive: true });
  cpSync(oldVolume, failure, { recursive: true });
  process.env.DATA_DIR = upgrade;
  Object.assign(process.env, credentials);
  const db = await import("../db/index");
  const connection = db.openDatabaseConnection({
    databasePath: path.join(upgrade, "db/capsule.sqlite"),
    migrationsFolder: path.join(repo, "db/migrations"),
    snapshotDirectory: path.join(upgrade, "backups/pre-migration"),
  });
  assert.deepEqual(
    connection.sqlite.prepare("select * from memory_event order by id").all(),
    rows,
  );
  assert.deepEqual(connection.sqlite.pragma("foreign_key_check"), []);
  assert.equal(
    (
      connection.sqlite.prepare("select count(*) n from collection").get() as {
        n: number;
      }
    ).n,
    0,
  );
  connection.sqlite.close();
  assert.equal(
    readdirSync(path.join(upgrade, "backups/pre-migration")).length,
    1,
  );
  originalShas(upgrade);
  const broken = path.join(root, "broken-migrations");
  cpSync(path.join(repo, "db/migrations"), broken, { recursive: true });
  const journal = JSON.parse(
      readFileSync(path.join(broken, "meta/_journal.json"), "utf8"),
    ),
    last = journal.entries.at(-1);
  const sql = path.join(broken, last.tag + ".sql");
  writeFileSync(
    sql,
    readFileSync(sql, "utf8") +
      "\n--> statement-breakpoint\nINSERT INTO nonexistent_table VALUES(1);",
  );
  assert.throws(
    () =>
      db.openDatabaseConnection({
        databasePath: path.join(failure, "db/capsule.sqlite"),
        migrationsFolder: broken,
        snapshotDirectory: path.join(failure, "backups/pre-migration"),
      }),
    /migration failed/,
  );
  const failed = new Database(path.join(failure, "db/capsule.sqlite"));
  assert.deepEqual(
    failed.prepare("select * from memory_event order by id").all(),
    rows,
  );
  assert.equal(
    (
      failed
        .prepare("select count(*) n from sqlite_schema where name='collection'")
        .get() as { n: number }
    ).n,
    0,
  );
  failed
    .prepare("update memory_event set title=title where id=?")
    .run(expected.events[0]);
  failed.close();
  originalShas(failure);
  // Fresh 1.2 installation restores an archive actually produced by the old export code.
  const restored = path.join(root, "volume-restored");
  process.env.DATA_DIR = restored;
  // db's DATA_DIR is captured at import; restore runs in a fresh child, as an independent installation.
  run(
    process.execPath,
    [
      "--conditions=react-server",
      "--import",
      path.join(repo, "node_modules/tsx/dist/loader.mjs"),
      "scripts/verify-legacy-restore12.mts",
    ],
    repo,
    { ...credentials, DATA_DIR: restored, FTC_FIXTURE_OUTPUT: fixtures },
  );
  const first = await JSZip.loadAsync(
      readFileSync(path.join(fixtures, "legacy11.zip")),
    ),
    second = await JSZip.loadAsync(
      readFileSync(path.join(fixtures, "restored12.zip")),
    );
  assert(!first.file("family-time-capsule-export/book-projects.json"));
  for (const name of [
    "collections",
    "collection-sections",
    "collection-items",
    "book-projects",
    "book-chapters",
    "book-blocks",
    "book-source-refs",
    "book-block-sources",
    "book-revisions",
  ])
    assert.deepEqual(
      JSON.parse(
        await second
          .file(`family-time-capsule-export/${name}.json`)!
          .async("string"),
      ),
      [],
    );
  originalShas(restored);
  const report = {
    root,
    legacySource: sha,
    legacyVersion: "1.1.0-alpha.1",
    targetVersion: JSON.parse(readFileSync("package.json", "utf8")).version,
    oldVolume,
    upgradedVolume: upgrade,
    failure,
    restored,
    fixtures,
    events: 5,
    originals: 5,
    originalShas: originalShas(upgrade),
    upgrade: "passed",
    migrationRollback: "passed",
    legacyExportRestoreReexport: "passed",
  };
  writeFileSync(
    "/tmp/ftc-m8-upgrade-report.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
