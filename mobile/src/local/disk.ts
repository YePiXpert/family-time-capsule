import { openDatabaseAsync } from "expo-sqlite";
import { activeLibraryName, librarySchema } from "./activation";
import { LocalStore, type LibraryDisk } from "./store";
import { ENTITY_KINDS, rootOf, validateLibrary } from "./model";
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
    const disk: LibraryDisk = {
      legacy: false,
      read: async () => {
        const row = await db.getFirstAsync<{ json: string }>(
          "SELECT json FROM root WHERE id=1",
        );
        if (row) {
          const state = JSON.parse(row.json) as Record<string, unknown>;
          for (const kind of ENTITY_KINDS) state[kind] = {};
          const rows = await db.getAllAsync<{
            kind: string;
            id: string;
            json: string;
          }>("SELECT kind,id,json FROM entity");
          for (const entity of rows) {
            const collection = state[entity.kind] as
              | Record<string, unknown>
              | undefined;
            if (collection) collection[entity.id] = JSON.parse(entity.json);
          }
          return state;
        }
        // 旧版把整库存在 library 单行里。照常读出来开库，校验通过后由 store 触发切代。
        const legacy = await db.getFirstAsync<{ snapshot: string }>(
          "SELECT snapshot FROM library WHERE id=1",
        );
        if (!legacy) return null;
        disk.legacy = true;
        return JSON.parse(legacy.snapshot) as unknown;
      },
      write: async (state, delta) => {
        await db.withExclusiveTransactionAsync(async (tx) => {
          await tx.runAsync(
            "INSERT INTO root(id,json) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json",
            JSON.stringify(rootOf(state)),
          );
          if (delta) {
            for (const { kind, id } of delta.removed)
              await tx.runAsync(
                "DELETE FROM entity WHERE kind=? AND id=?",
                kind,
                id,
              );
            for (const { kind, id } of delta.changed)
              await tx.runAsync(
                "INSERT INTO entity(kind,id,json) VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET json=excluded.json",
                kind,
                id,
                JSON.stringify((state[kind] as Record<string, unknown>)[id]),
              );
            return;
          }
          await tx.runAsync("DELETE FROM entity");
          for (const kind of ENTITY_KINDS)
            for (const [id, entity] of Object.entries(state[kind]))
              await tx.runAsync(
                "INSERT INTO entity(kind,id,json) VALUES(?,?,?)",
                kind,
                id,
                JSON.stringify(entity),
              );
          // 清掉旧快照是一道单向门：先把刚写进去的整库读回来、按开库同一套规则校验，
          // 过了才删。任何一步不对就抛出去，整笔回滚，旧快照原样留着，下次启动重来。
          if (disk.legacy) {
            const rootRow = await tx.getFirstAsync<{ json: string }>(
              "SELECT json FROM root WHERE id=1",
            );
            const reread = JSON.parse(rootRow?.json ?? "null") as Record<
              string,
              unknown
            > | null;
            if (!reread) throw new Error("本机资料换代失败，原有资料已保留。");
            for (const kind of ENTITY_KINDS) reread[kind] = {};
            const rows = await tx.getAllAsync<{
              kind: string;
              id: string;
              json: string;
            }>("SELECT kind,id,json FROM entity");
            for (const entity of rows) {
              const collection = reread[entity.kind] as
                | Record<string, unknown>
                | undefined;
              if (collection) collection[entity.id] = JSON.parse(entity.json);
            }
            validateLibrary(reread);
            const written = ENTITY_KINDS.reduce(
              (n, kind) => n + Object.keys(reread[kind] ?? {}).length,
              0,
            );
            const expected = ENTITY_KINDS.reduce(
              (n, kind) => n + Object.keys(state[kind]).length,
              0,
            );
            if (written !== expected)
              throw new Error("本机资料换代失败，原有资料已保留。");
            await tx.runAsync("DELETE FROM library");
          }
        });
        disk.legacy = false;
      },
    };
    const candidate = new LocalStore(disk, {
      onChange: (ms) => healthFile().change(ms),
      onWriteFailure: (message) => healthFile().diskFailure(message),
    });
    await candidate.open();
    health.launch(Date.now() - started);
    store = candidate;
    return candidate;
  } catch (e) {
    await db.closeAsync();
    throw e;
  }
}
