import "server-only";

import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { DATA_DIR } from "@/lib/paths";
import { runMigrationsWithPreMigrationSnapshot } from "./migration-safety";
import * as assetSchema from "./schema/asset";
import * as aiJobSchema from "./schema/ai-job";
import * as auditSchema from "./schema/audit";
import * as authSchema from "./schema/auth";
import * as capsuleSchema from "./schema/capsule";
import * as contributionSchema from "./schema/contribution";
import * as familySchema from "./schema/family";
import * as inboxSchema from "./schema/inbox";
import * as invitationSchema from "./schema/invitation";
import * as memorySchema from "./schema/memory";
import * as transcriptSchema from "./schema/transcript";
import * as analysisSchema from "./schema/analysis";
import * as suggestionSchema from "./schema/suggestion";
import * as clusterSchema from "./schema/clusters";
import * as storySchema from "./schema/story";
import * as oralHistorySchema from "./schema/oral-history";
import * as backupSchema from "./schema/backup";
import * as importSchema from "./schema/import";

/**
 * SQLite 单例：数据库文件位于 $DATA_DIR/db/capsule.sqlite（PRD §11）。
 * 迁移在首次连接时自动执行（幂等），不使用内存数据库。
 */

export type DatabaseConnectionOptions = {
  databasePath: string;
  migrationsFolder: string;
  snapshotDirectory: string;
};

/**
 * Open one database connection and apply all pending migrations safely.
 *
 * This lower-level entry point is also used by upgrade tests so a deliberately
 * broken migration can prove that startup releases the SQLite file handle.
 */
export function openDatabaseConnection(options: DatabaseConnectionOptions) {
  mkdirSync(path.dirname(options.databasePath), { recursive: true });

  const sqlite = new Database(options.databasePath);
  try {
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");
    // Multi-process app/worker writes wait briefly for the current IMMEDIATE
    // transaction instead of surfacing transient SQLITE_BUSY to users.
    sqlite.pragma("busy_timeout = 5000");

    const db = drizzle(sqlite, {
      schema: {
        ...authSchema,
        ...familySchema,
        ...assetSchema,
        ...aiJobSchema,
        ...inboxSchema,
        ...invitationSchema,
        ...memorySchema,
        ...contributionSchema,
        ...capsuleSchema,
        ...transcriptSchema,
        ...analysisSchema,
        ...suggestionSchema,
        ...clusterSchema,
        ...storySchema,
        ...oralHistorySchema,
        ...backupSchema,
        ...importSchema,
        ...auditSchema,
      },
    });
    runMigrationsWithPreMigrationSnapshot({
      sqlite,
      migrationsFolder: options.migrationsFolder,
      snapshotDirectory: options.snapshotDirectory,
      runMigrations: () =>
        migrate(db, { migrationsFolder: options.migrationsFolder }),
    });

    return { db, sqlite };
  } catch (error) {
    // A failed startup must not retain a locked handle. Drizzle wraps migration
    // statements in one transaction; closing here also rolls back any
    // transaction left open by an unexpected driver-level failure.
    sqlite.close();
    throw error;
  }
}

export type AppDatabase = ReturnType<typeof openDatabaseConnection>["db"];

let dbInstance: AppDatabase | undefined;
let sqliteHandle: ReturnType<typeof Database> | undefined;

export function getDb(): AppDatabase {
  dbInstance ??= createDatabase();
  return dbInstance;
}

/** 显式关闭连接（Windows 下删除数据目录前必须先释放文件句柄） */
export function closeDatabase(): void {
  sqliteHandle?.close();
  sqliteHandle = undefined;
  dbInstance = undefined;
}

function createDatabase() {
  const connection = openDatabaseConnection({
    databasePath: path.join(DATA_DIR, "db", "capsule.sqlite"),
    migrationsFolder: path.join(process.cwd(), "db", "migrations"),
    snapshotDirectory: path.join(DATA_DIR, "backups", "pre-migration"),
  });
  sqliteHandle = connection.sqlite;
  return connection.db;
}
