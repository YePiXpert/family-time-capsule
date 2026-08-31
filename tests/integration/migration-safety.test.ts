import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openDatabaseConnection } from "@/db";
import {
  DatabaseMigrationError,
  DatabaseVersionAheadError,
  runMigrationsWithPreMigrationSnapshot,
} from "@/db/migration-safety";

type TestMigration = {
  tag: string;
  when: number;
  sql: string;
};

const workDirectories: string[] = [];

function makeWorkDirectory(label: string): string {
  const directory = mkdtempSync(path.join(tmpdir(), `ftc-${label}-`));
  workDirectories.push(directory);
  return directory;
}

function writeMigrations(
  root: string,
  migrations: TestMigration[],
): string {
  const folder = path.join(root, "migrations");
  const meta = path.join(folder, "meta");
  mkdirSync(meta, { recursive: true });
  for (const migration of migrations) {
    writeFileSync(path.join(folder, `${migration.tag}.sql`), migration.sql);
  }
  writeFileSync(
    path.join(meta, "_journal.json"),
    JSON.stringify({
      version: "7",
      dialect: "sqlite",
      entries: migrations.map((migration, idx) => ({
        idx,
        version: "6",
        when: migration.when,
        tag: migration.tag,
        breakpoints: true,
      })),
    }),
  );
  return folder;
}

function createMigrationLedger(
  sqlite: InstanceType<typeof Database>,
  createdAt: number,
): void {
  sqlite.exec(`
    CREATE TABLE "__drizzle_migrations" (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at numeric
    );
  `);
  sqlite
    .prepare(
      'INSERT INTO "__drizzle_migrations" (hash, created_at) VALUES (?, ?)',
    )
    .run("fixture-ledger-hash", createdAt);
}

afterEach(() => {
  for (const directory of workDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("migration startup safety", () => {
  it("migrates a genuinely empty database without creating a rollback snapshot", () => {
    const root = makeWorkDirectory("migration-fresh");
    const migrationsFolder = writeMigrations(root, [
      {
        tag: "0000_fresh",
        when: 1_000,
        sql: "CREATE TABLE fresh_record (id text PRIMARY KEY);",
      },
    ]);
    const snapshotDirectory = path.join(root, "snapshots");
    const sqlite = new Database(path.join(root, "fresh.sqlite"));
    const db = drizzle(sqlite);

    try {
      const result = runMigrationsWithPreMigrationSnapshot({
        sqlite,
        migrationsFolder,
        snapshotDirectory,
        runMigrations: () => migrate(db, { migrationsFolder }),
      });

      expect(result).toEqual({ pendingMigrations: 1, snapshotPath: null });
      expect(existsSync(snapshotDirectory)).toBe(false);
      expect(
        sqlite
          .prepare(
            "SELECT 1 FROM sqlite_schema WHERE type='table' AND name='fresh_record'",
          )
          .pluck()
          .get(),
      ).toBe(1);
    } finally {
      sqlite.close();
    }
  });

  it("snapshots committed WAL pages before applying a pending migration", () => {
    const root = makeWorkDirectory("migration-wal");
    const migrationsFolder = writeMigrations(root, [
      {
        tag: "0000_existing",
        when: 1_000,
        sql: "CREATE TABLE archive_record (id text PRIMARY KEY, value text NOT NULL);",
      },
      {
        tag: "0001_pending",
        when: 2_000,
        sql: "ALTER TABLE archive_record ADD COLUMN migrated integer DEFAULT 1;",
      },
    ]);
    const databasePath = path.join(root, "archive.sqlite");
    const snapshotDirectory = path.join(root, "snapshots");
    const sqlite = new Database(databasePath);
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("wal_autocheckpoint = 0");
    sqlite.exec(
      "CREATE TABLE archive_record (id text PRIMARY KEY, value text NOT NULL)",
    );
    createMigrationLedger(sqlite, 1_000);
    sqlite
      .prepare("INSERT INTO archive_record (id, value) VALUES (?, ?)")
      .run("main-page", "already checkpointed");
    sqlite.pragma("wal_checkpoint(TRUNCATE)");
    sqlite
      .prepare("INSERT INTO archive_record (id, value) VALUES (?, ?)")
      .run("wal-page", "committed only after checkpoint");
    const walPath = `${databasePath}-wal`;
    expect(existsSync(walPath)).toBe(true);
    expect(statSync(walPath).size).toBeGreaterThan(0);

    const db = drizzle(sqlite);
    try {
      const result = runMigrationsWithPreMigrationSnapshot({
        sqlite,
        migrationsFolder,
        snapshotDirectory,
        runMigrations: () => migrate(db, { migrationsFolder }),
      });

      expect(result.pendingMigrations).toBe(1);
      expect(result.snapshotPath).not.toBeNull();
      expect(readdirSync(snapshotDirectory)).toEqual([
        path.basename(result.snapshotPath!),
      ]);

      const snapshot = new Database(result.snapshotPath!, {
        readonly: true,
        fileMustExist: true,
      });
      try {
        expect(snapshot.pragma("integrity_check", { simple: true })).toBe("ok");
        expect(
          snapshot
            .prepare("SELECT id, value FROM archive_record ORDER BY id")
            .all(),
        ).toEqual([
          { id: "main-page", value: "already checkpointed" },
          { id: "wal-page", value: "committed only after checkpoint" },
        ]);
        expect(
          snapshot
            .prepare("PRAGMA table_info(archive_record)")
            .all()
            .some((column) =>
              (column as { name: string }).name === "migrated",
            ),
        ).toBe(false);
      } finally {
        snapshot.close();
      }

      expect(
        sqlite
          .prepare("PRAGMA table_info(archive_record)")
          .all()
          .some((column) =>
            (column as { name: string }).name === "migrated",
          ),
      ).toBe(true);
    } finally {
      sqlite.close();
    }
  });

  it("preserves a recoverable snapshot and releases the file after migration failure", () => {
    const root = makeWorkDirectory("migration-failure");
    const migrationsFolder = writeMigrations(root, [
      {
        tag: "0000_existing",
        when: 1_000,
        sql: "CREATE TABLE retained_record (id text PRIMARY KEY, value text NOT NULL);",
      },
      {
        tag: "0001_broken",
        when: 2_000,
        sql: "CREATE TABLE broken_migration (",
      },
    ]);
    const databasePath = path.join(root, "archive.sqlite");
    const snapshotDirectory = path.join(root, "snapshots");
    const seed = new Database(databasePath);
    seed.exec(
      "CREATE TABLE retained_record (id text PRIMARY KEY, value text NOT NULL)",
    );
    createMigrationLedger(seed, 1_000);
    seed
      .prepare("INSERT INTO retained_record (id, value) VALUES (?, ?)")
      .run("must-survive", "pre-migration value");
    seed.close();

    let failure: unknown;
    try {
      openDatabaseConnection({
        databasePath,
        migrationsFolder,
        snapshotDirectory,
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(DatabaseMigrationError);
    const migrationFailure = failure as DatabaseMigrationError;
    expect(migrationFailure.snapshotPath).not.toBeNull();
    expect(migrationFailure.cause).toBeInstanceOf(Error);

    const snapshot = new Database(migrationFailure.snapshotPath!, {
      readonly: true,
      fileMustExist: true,
    });
    try {
      expect(snapshot.pragma("integrity_check", { simple: true })).toBe("ok");
      expect(
        snapshot
          .prepare("SELECT id, value FROM retained_record")
          .get(),
      ).toEqual({ id: "must-survive", value: "pre-migration value" });
      expect(
        snapshot
          .prepare(
            'SELECT created_at FROM "__drizzle_migrations" ORDER BY created_at DESC LIMIT 1',
          )
          .pluck()
          .get(),
      ).toBe(1_000);
    } finally {
      snapshot.close();
    }

    // Windows refuses this rename while better-sqlite3 still owns the source
    // handle, so this is an end-to-end assertion of the startup catch path.
    const renamedPath = path.join(root, "archive-after-failure.sqlite");
    renameSync(databasePath, renamedPath);
    renameSync(renamedPath, databasePath);

    const recoveredSource = new Database(databasePath, {
      readonly: true,
      fileMustExist: true,
    });
    try {
      expect(
        recoveredSource
          .prepare(
            "SELECT 1 FROM sqlite_schema WHERE type='table' AND name='broken_migration'",
          )
          .pluck()
          .get(),
      ).toBeUndefined();
      expect(
        recoveredSource
          .prepare("SELECT value FROM retained_record WHERE id = ?")
          .pluck()
          .get("must-survive"),
      ).toBe("pre-migration value");
    } finally {
      recoveredSource.close();
    }
  });

  it("refuses a database whose migration timestamp is newer than this build", () => {
    const root = makeWorkDirectory("migration-ahead");
    const migrationsFolder = writeMigrations(root, [
      {
        tag: "0000_available",
        when: 2_000,
        sql: "CREATE TABLE available_record (id text PRIMARY KEY);",
      },
    ]);
    const snapshotDirectory = path.join(root, "snapshots");
    const sqlite = new Database(path.join(root, "ahead.sqlite"));
    sqlite.exec("CREATE TABLE future_record (id text PRIMARY KEY)");
    createMigrationLedger(sqlite, 3_000);
    const runMigrations = vi.fn();

    try {
      expect(() =>
        runMigrationsWithPreMigrationSnapshot({
          sqlite,
          migrationsFolder,
          snapshotDirectory,
          runMigrations,
        }),
      ).toThrow(DatabaseVersionAheadError);
      expect(runMigrations).not.toHaveBeenCalled();
      expect(existsSync(snapshotDirectory)).toBe(false);
    } finally {
      sqlite.close();
    }
  });
});
