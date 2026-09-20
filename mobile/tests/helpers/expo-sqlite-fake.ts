import * as path from "node:path";
import { DatabaseSync } from "node:sqlite";
/** vitest 里的 expo-sqlite 假件：node:sqlite 真库，env.database 让测试能直接改库或关库。 */
export type SqliteEnv = { root: string; database: DatabaseSync | null };
export function createExpoSqliteFake(env: SqliteEnv) {
  return {
    openDatabaseAsync: async (name: string) => {
      const db = new DatabaseSync(path.join(env.root, name));
      env.database = db;
      const driver = {
        execAsync: async (sql: string) => {
          db.exec(sql);
        },
        getFirstAsync: async (sql: string) => db.prepare(sql).get(),
        getAllAsync: async (sql: string) => db.prepare(sql).all(),
        runAsync: async (sql: string, ...args: (string | number)[]) =>
          db.prepare(sql).run(...args),
        closeAsync: async () => {
          db.close();
          if (env.database === db) env.database = null;
        },
        withExclusiveTransactionAsync: async (
          fn: (tx: unknown) => Promise<void>,
        ) => {
          db.exec("BEGIN IMMEDIATE");
          try {
            await fn(driver);
            db.exec("COMMIT");
          } catch (e) {
            db.exec("ROLLBACK");
            throw e;
          }
        },
      };
      return driver;
    },
  };
}
