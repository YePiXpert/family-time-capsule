import { openDatabaseAsync } from "expo-sqlite";
import { activeLibraryName, librarySchema } from "./activation";
import { LocalStore } from "./store";
import type { Library } from "./model";
import { healthFile } from "./health-file";
let store: LocalStore | null = null;
export async function openLocalStore(): Promise<LocalStore> {
  if (store) return store;
  const health = healthFile();
  await health.load();
  const started = Date.now();
  const db = await openDatabaseAsync(await activeLibraryName());
  try {
    await db.execAsync(
      `PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; ${librarySchema}`,
    );
    const candidate = new LocalStore(
      {
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
      },
      {
        onChange: (ms) => healthFile().change(ms),
        onWriteFailure: (message) => healthFile().diskFailure(message),
      },
    );
    await candidate.open();
    health.launch(Date.now() - started);
    store = candidate;
    return candidate;
  } catch (e) {
    await db.closeAsync();
    throw e;
  }
}
