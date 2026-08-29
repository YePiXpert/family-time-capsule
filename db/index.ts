import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { DATA_DIR } from "@/lib/paths";
import * as authSchema from "./schema/auth";
import * as familySchema from "./schema/family";

/**
 * SQLite 单例：数据库文件位于 $DATA_DIR/db/capsule.sqlite（PRD §11）。
 * 迁移在首次连接时自动执行（幂等），不使用内存数据库。
 */

export type AppDatabase = ReturnType<typeof createDatabase>;

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
  const dbDir = path.join(DATA_DIR, "db");
  mkdirSync(dbDir, { recursive: true });

  const sqlite = new Database(path.join(dbDir, "capsule.sqlite"));
  sqliteHandle = sqlite;
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  const db = drizzle(sqlite, {
    schema: { ...authSchema, ...familySchema },
  });
  migrate(db, {
    migrationsFolder: path.join(process.cwd(), "db", "migrations"),
  });
  return db;
}
