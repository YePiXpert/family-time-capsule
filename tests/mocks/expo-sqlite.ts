import Database from "better-sqlite3";

type SqlValue = string | number | null | Uint8Array;

export type SQLiteRunResult = {
  changes: number;
  lastInsertRowId: number | bigint;
};

export type SQLiteDatabase = {
  execAsync: (sql: string) => Promise<void>;
  runAsync: (sql: string, ...params: SqlValue[]) => Promise<SQLiteRunResult>;
  getFirstAsync: <T>(sql: string, ...params: SqlValue[]) => Promise<T | null>;
  getAllAsync: <T>(sql: string, ...params: SqlValue[]) => Promise<T[]>;
  withExclusiveTransactionAsync: (
    operation: (transaction: SQLiteDatabase) => Promise<void>,
  ) => Promise<void>;
};

const raw = new Database(":memory:");

const adapter: SQLiteDatabase = {
  execAsync: async (sql: string) => {
    raw.exec(sql);
  },
  runAsync: async (sql: string, ...params: SqlValue[]) => {
    const result = raw.prepare(sql).run(...params);
    return {
      changes: result.changes,
      lastInsertRowId: result.lastInsertRowid,
    };
  },
  getFirstAsync: async <T,>(sql: string, ...params: SqlValue[]) =>
    (raw.prepare(sql).get(...params) as T | undefined) ?? null,
  getAllAsync: async <T,>(sql: string, ...params: SqlValue[]) =>
    raw.prepare(sql).all(...params) as T[],
  withExclusiveTransactionAsync: async (
    operation: (transaction: SQLiteDatabase) => Promise<void>,
  ) => {
    raw.exec("BEGIN IMMEDIATE");
    try {
      await operation(adapter);
      raw.exec("COMMIT");
    } catch (error) {
      raw.exec("ROLLBACK");
      throw error;
    }
  },
};

export async function openDatabaseAsync(_name?: string): Promise<SQLiteDatabase> {
  void _name;
  return adapter;
}

export function getRawMockDatabase(): Database.Database {
  return raw;
}
