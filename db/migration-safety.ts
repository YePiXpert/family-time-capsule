import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  rmSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import Database from "better-sqlite3";
import {
  readMigrationFiles,
  type MigrationMeta,
} from "drizzle-orm/migrator";

type SqliteHandle = InstanceType<typeof Database>;

export type MigrationSafetyResult = {
  pendingMigrations: number;
  snapshotPath: string | null;
};

export class DatabaseVersionAheadError extends Error {
  readonly databaseMigrationTimestamp: number;
  readonly newestAvailableMigrationTimestamp: number;

  constructor(databaseTimestamp: number, availableTimestamp: number) {
    super(
      `database migration ${databaseTimestamp} is newer than this build (${availableTimestamp}); refusing to open it with older code`,
    );
    this.name = "DatabaseVersionAheadError";
    this.databaseMigrationTimestamp = databaseTimestamp;
    this.newestAvailableMigrationTimestamp = availableTimestamp;
  }
}

export class DatabaseMigrationError extends Error {
  readonly snapshotPath: string | null;

  constructor(cause: unknown, snapshotPath: string | null) {
    const recovery = snapshotPath
      ? `; WAL-consistent pre-migration snapshot preserved at ${snapshotPath}`
      : "";
    super(`database migration failed${recovery}`, { cause });
    this.name = "DatabaseMigrationError";
    this.snapshotPath = snapshotPath;
  }
}

type MigrationState = {
  establishedDatabase: boolean;
  lastAppliedTimestamp: number | null;
  pending: MigrationMeta[];
};

function tableExists(sqlite: SqliteHandle, tableName: string): boolean {
  return (
    sqlite
      .prepare(
        "SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ? LIMIT 1",
      )
      .pluck()
      .get(tableName) === 1
  );
}

function inspectMigrationState(
  sqlite: SqliteHandle,
  migrations: MigrationMeta[],
): MigrationState {
  const hasMigrationTable = tableExists(sqlite, "__drizzle_migrations");
  const lastRow = hasMigrationTable
    ? (sqlite
        .prepare(
          'SELECT created_at FROM "__drizzle_migrations" ORDER BY created_at DESC LIMIT 1',
        )
        .get() as { created_at: number | string | null } | undefined)
    : undefined;

  let lastAppliedTimestamp: number | null = null;
  if (lastRow?.created_at !== null && lastRow?.created_at !== undefined) {
    const parsed = Number(lastRow.created_at);
    if (!Number.isFinite(parsed)) {
      throw new Error("database migration ledger contains an invalid created_at value");
    }
    lastAppliedTimestamp = parsed;
  }

  const newestAvailableTimestamp = migrations.at(-1)?.folderMillis ?? 0;
  if (
    lastAppliedTimestamp !== null &&
    lastAppliedTimestamp > newestAvailableTimestamp
  ) {
    throw new DatabaseVersionAheadError(
      lastAppliedTimestamp,
      newestAvailableTimestamp,
    );
  }

  const applicationTableCount = sqlite
    .prepare(
      `SELECT count(*)
         FROM sqlite_schema
        WHERE type = 'table'
          AND name NOT LIKE 'sqlite_%'
          AND name <> '__drizzle_migrations'`,
    )
    .pluck()
    .get() as number;

  return {
    establishedDatabase:
      applicationTableCount > 0 || lastAppliedTimestamp !== null,
    lastAppliedTimestamp,
    pending: migrations.filter(
      (migration) =>
        lastAppliedTimestamp === null ||
        migration.folderMillis > lastAppliedTimestamp,
    ),
  };
}

function assertSnapshotIntegrity(snapshotPath: string): void {
  const snapshot = new Database(snapshotPath, {
    readonly: true,
    fileMustExist: true,
  });
  try {
    const result = snapshot.pragma("integrity_check", {
      simple: true,
    });
    if (result !== "ok") {
      throw new Error(`snapshot integrity_check failed: ${String(result)}`);
    }
  } finally {
    snapshot.close();
  }
}

/**
 * Create a transactionally consistent SQLite copy that includes committed WAL
 * pages. The destination is first built and verified under a unique temporary
 * name, then atomically renamed so an interrupted copy is never advertised as
 * a usable rollback point.
 */
export function createPreMigrationSnapshot(
  sqlite: SqliteHandle,
  snapshotDirectory: string,
): string {
  mkdirSync(snapshotDirectory, { recursive: true, mode: 0o700 });

  const timestamp = new Date().toISOString().replaceAll(":", "-");
  const id = randomUUID();
  const finalPath = path.join(
    snapshotDirectory,
    `capsule.pre-migration.${timestamp}.${id}.sqlite`,
  );
  const temporaryPath = `${finalPath}.partial`;

  if (existsSync(finalPath) || existsSync(temporaryPath)) {
    throw new Error("generated pre-migration snapshot path already exists");
  }

  try {
    // VACUUM INTO uses SQLite's own consistent read transaction. Unlike a raw
    // filesystem copy, it includes committed pages that still live in -wal.
    sqlite.prepare("VACUUM INTO ?").run(temporaryPath);
    assertSnapshotIntegrity(temporaryPath);
    chmodSync(temporaryPath, 0o600);

    // Flush the completed database file before publishing its final name.
    // Windows rejects FlushFileBuffers for a read-only handle (EPERM), even
    // when the file itself is writable. Open the completed private copy for
    // read/write solely for this durability flush.
    const fd = openSync(temporaryPath, "r+");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temporaryPath, finalPath);
    return finalPath;
  } catch (error) {
    rmSync(temporaryPath, { force: true });
    throw error;
  }
}

/**
 * Run Drizzle's synchronous migration callback with a verified rollback point.
 * Fresh databases do not need a snapshot; established databases get exactly
 * one snapshot only when the checked-in journal contains pending migrations.
 */
export function runMigrationsWithPreMigrationSnapshot(options: {
  sqlite: SqliteHandle;
  migrationsFolder: string;
  snapshotDirectory: string;
  runMigrations: () => void;
}): MigrationSafetyResult {
  const migrations = readMigrationFiles({
    migrationsFolder: options.migrationsFolder,
  });
  const state = inspectMigrationState(options.sqlite, migrations);

  let snapshotPath: string | null = null;
  if (state.establishedDatabase && state.pending.length > 0) {
    snapshotPath = createPreMigrationSnapshot(
      options.sqlite,
      options.snapshotDirectory,
    );
    console.info(
      `[database] created WAL-consistent pre-migration snapshot: ${snapshotPath}`,
    );
  }

  try {
    options.runMigrations();
  } catch (error) {
    throw new DatabaseMigrationError(error, snapshotPath);
  }

  return {
    pendingMigrations: state.pending.length,
    snapshotPath,
  };
}
