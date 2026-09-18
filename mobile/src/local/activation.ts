import { Directory, File, Paths } from "expo-file-system";
import { randomUUID } from "expo-crypto";
import { openDatabaseAsync } from "expo-sqlite";
import { ENTITY_KINDS, rootOf, validateLibrary, type Library } from "./model";
export const defaultLibraryName = "xiaomei-local-v1.sqlite";
export const librarySchema = [
  // library 是 Build 62 及更早的整库单行快照，只在开库切代时读一次。
  "CREATE TABLE IF NOT EXISTS library (id INTEGER PRIMARY KEY CHECK(id=1), snapshot TEXT NOT NULL);",
  "CREATE TABLE IF NOT EXISTS root (id INTEGER PRIMARY KEY CHECK(id=1), json TEXT NOT NULL);",
  "CREATE TABLE IF NOT EXISTS entity (kind TEXT NOT NULL, id TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY(kind,id));",
].join(" ");
const registry = new Directory(Paths.document, "xiaomei-v1", "libraries");
function generations(): File[] {
  if (!registry.exists) return [];
  return registry
    .list()
    .filter(
      (f): f is File =>
        f instanceof File &&
        /^generation-\d+-[a-zA-Z0-9-]+\.json$/.test(f.name),
    )
    .sort(
      (a, b) => Number(b.name.split("-")[1]) - Number(a.name.split("-")[1]),
    );
}
export async function activeLibraryName(): Promise<string> {
  const marker = generations()[0];
  if (!marker) return defaultLibraryName;
  const data = JSON.parse(await marker.text()) as {
    version?: number;
    database?: string;
  };
  if (
    data.version !== 1 ||
    !/^xiaomei-recovered-[a-zA-Z0-9-]+\.sqlite$/.test(data.database ?? "")
  )
    throw new Error("本机资料索引无法读取，请从完整备份恢复。");
  return data.database!;
}
/** Append-only activation: old databases and complete media directories are never overwritten.
 * A marker is exposed only after the new database is closed and verified. Interrupted
 * preparation leaves the former library active; a committed marker selects the full replacement.
 */
export async function activateRecoveredLibrary(state: Library): Promise<void> {
  validateLibrary(state);
  registry.create({ intermediates: true, idempotent: true });
  const database = `xiaomei-recovered-${randomUUID()}.sqlite`;
  const db = await openDatabaseAsync(database);
  try {
    await db.execAsync(
      `PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; ${librarySchema}`,
    );
    await db.runAsync(
      "INSERT INTO root(id,json) VALUES(1,?)",
      JSON.stringify(rootOf(state)),
    );
    for (const kind of ENTITY_KINDS)
      for (const [id, entity] of Object.entries(state[kind]))
        await db.runAsync(
          "INSERT INTO entity(kind,id,json) VALUES(?,?,?)",
          kind,
          id,
          JSON.stringify(entity),
        );
    const integrity = await db.getFirstAsync<{ integrity_check: string }>(
      "PRAGMA integrity_check",
    );
    if (integrity?.integrity_check !== "ok")
      throw new Error("恢复文件校验失败，原有资料已保留。");
    const row = await db.getFirstAsync<{ json: string }>(
      "SELECT json FROM root WHERE id=1",
    );
    const reread = JSON.parse(row?.json ?? "null") as Record<string, unknown>;
    if (reread) for (const kind of ENTITY_KINDS) reread[kind] = {};
    const rows = await db.getAllAsync<{
      kind: string;
      id: string;
      json: string;
    }>("SELECT kind,id,json FROM entity");
    for (const entity of rows) {
      const collection = reread?.[entity.kind] as
        | Record<string, unknown>
        | undefined;
      if (collection) collection[entity.id] = JSON.parse(entity.json);
    }
    validateLibrary(reread);
  } finally {
    await db.closeAsync();
  }
  const generation = Number(generations()[0]?.name.split("-")[1] ?? 0) + 1;
  const name = `generation-${generation}-${randomUUID()}`;
  const temporary = new File(registry, `${name}.part`),
    target = new File(registry, `${name}.json`);
  temporary.write(JSON.stringify({ version: 1, database }));
  if (JSON.parse(await temporary.text()).database !== database)
    throw new Error("恢复索引写入失败，原有资料已保留。");
  await temporary.move(target, { overwrite: false });
}
