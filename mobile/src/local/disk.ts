import { openDatabaseAsync } from "expo-sqlite";
import { LocalStore } from "./store";
import type { Library } from "./model";
let store: LocalStore | null = null;
export async function openLocalStore(): Promise<LocalStore> {
  if (store) return store;
  const db = await openDatabaseAsync("xiaomei-local-v1.sqlite");
  try {
    await db.execAsync(
      "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS library (id INTEGER PRIMARY KEY CHECK(id=1), snapshot TEXT NOT NULL);",
    );
    const candidate = new LocalStore({
      read: async () => {
        const row = await db.getFirstAsync<{ snapshot: string }>(
          "SELECT snapshot FROM library WHERE id=1",
        );
        return row ? (JSON.parse(row.snapshot) as unknown) : null;
      },
      write: async (state: Library) => {
        await db.withExclusiveTransactionAsync(async (tx) => {
          await tx.runAsync(
            "INSERT INTO library(id,snapshot) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET snapshot=excluded.snapshot",
            JSON.stringify(state),
          );
        });
      },
    });
    await candidate.open();
    store = candidate;
    return candidate;
  } catch (e) {
    await db.closeAsync();
    throw e;
  }
}
