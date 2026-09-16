import { Directory, File, Paths } from "expo-file-system";
import { randomUUID } from "expo-crypto";
import { openDatabaseAsync } from "expo-sqlite";
import { validateLibrary, type Library } from "./model";
export const defaultLibraryName = "xiaomei-local-v1.sqlite";
export const librarySchema =
  "CREATE TABLE IF NOT EXISTS library (id INTEGER PRIMARY KEY CHECK(id=1), snapshot TEXT NOT NULL);";
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
      "INSERT INTO library(id,snapshot) VALUES(1,?)",
      JSON.stringify(state),
    );
    const integrity = await db.getFirstAsync<{ integrity_check: string }>(
      "PRAGMA integrity_check",
    );
    if (integrity?.integrity_check !== "ok")
      throw new Error("恢复文件校验失败，原有资料已保留。");
    const row = await db.getFirstAsync<{ snapshot: string }>(
      "SELECT snapshot FROM library WHERE id=1",
    );
    validateLibrary(JSON.parse(row?.snapshot ?? "null"));
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
