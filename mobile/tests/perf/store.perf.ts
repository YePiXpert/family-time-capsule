/**
 * 本机资料库：开库（真 SQLite 假件 + 真 disk.ts）、一次 change() 的写路径与各段拆分。
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it, vi } from "vitest";
import {
  ENTITY_KINDS,
  clone,
  deleteRecord,
  diffLibrary,
  forkLibrary,
  freezeLibrary,
  normalizeLibrary,
  patchRecord,
  rootOf,
  saveRecord,
  validateChange,
  validateLibrary,
  type Library,
  type RecordDraft,
} from "../../src/local/model";
import { LocalStore, type LibraryDisk } from "../../src/local/store";
import { bench, reportTo } from "./harness";
import { fresh, makeLibrary, pad, sizes } from "./fixtures";

const env = vi.hoisted(() => ({
  root: "",
  free: Number.POSITIVE_INFINITY,
  rejectActivation: false,
  database: null as import("node:sqlite").DatabaseSync | null,
}));
vi.mock("expo-crypto", async () => ({ randomUUID: (await import("node:crypto")).randomUUID }));
vi.mock("expo-file-system", async () =>
  (await import("../helpers/expo-file-system-fake")).createExpoFileSystemFake(env),
);
vi.mock("expo-sqlite", async () =>
  (await import("../helpers/expo-sqlite-fake")).createExpoSqliteFake(env),
);

reportTo(__filename);
const G = "store";

/** 按 disk.ts 的表结构把一座库写进 SQLite 文件（不计时）。 */
async function seed(state: Library): Promise<string> {
  const { LIBRARY_FILE } = await import("../../src/local/brand");
  const { librarySchema } = await import("../../src/local/activation");
  const file = path.join(env.root, LIBRARY_FILE);
  for (const f of [file, `${file}-wal`, `${file}-shm`]) if (fs.existsSync(f)) fs.rmSync(f);
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA journal_mode=WAL; ${librarySchema}`);
  db.exec("BEGIN");
  db.prepare("INSERT INTO root(id,json) VALUES(1,?)").run(JSON.stringify(rootOf(state)));
  const put = db.prepare("INSERT INTO entity(kind,id,json) VALUES(?,?,?)");
  for (const kind of ENTITY_KINDS)
    for (const [id, e] of Object.entries(state[kind])) put.run(kind, id, JSON.stringify(e));
  db.exec("COMMIT");
  db.close();
  return file;
}

async function openReal(): Promise<LocalStore> {
  env.database?.close();
  env.database = null;
  vi.resetModules();
  const { openLocalStore } = await import("../../src/local/disk");
  return openLocalStore();
}

const memoryDisk = (state: Library): LibraryDisk => ({
  read: async () => fresh(state),
  write: async (s, delta) => {
    // 与 disk.ts 同样的序列化量：根 + 动过的实体。
    JSON.stringify(rootOf(s));
    for (const { kind, id } of delta?.changed ?? []) JSON.stringify((s[kind] as Record<string, unknown>)[id]);
  },
});

describe("LocalStore", () => {
  for (const n of sizes()) {
    it(`open + change @ ${n}`, async () => {
      env.root = fs.mkdtempSync(path.join(process.env.TMPDIR ?? "/var/tmp", "perf-store-"));
      const lib = makeLibrary(n);
      const entities = ENTITY_KINDS.reduce((k, kind) => k + Object.keys(lib[kind]).length, 0);
      const mb = (JSON.stringify(lib).length / 1048576).toFixed(1);
      const note = `${entities} entities, ${mb} MB JSON`;
      const file = await seed(lib);

      // 1) 真开库：SQLite 读全部行 + 逐行 JSON.parse + normalize + validate + freeze。
      await bench(G, "open: openLocalStore (sqlite read+parse+validate+freeze)", n, openReal, { note, runs: n >= 50000 ? 3 : 5 });
      // 1a) 只读盘：SELECT + JSON.parse。
      await bench(G, "open/a: sqlite SELECT + JSON.parse rows", n, () => {
        const db = new DatabaseSync(file);
        const root = JSON.parse((db.prepare("SELECT json FROM root WHERE id=1").get() as { json: string }).json) as Record<string, Record<string, unknown>>;
        for (const kind of ENTITY_KINDS) root[kind] = {};
        for (const row of db.prepare("SELECT kind,id,json FROM entity").all() as { kind: string; id: string; json: string }[])
          root[row.kind]![row.id] = JSON.parse(row.json);
        db.close();
      });
      // 1b) 只算 normalize + validateLibrary + freezeLibrary。
      let copy: Library = fresh(lib);
      await bench(G, "open/b: normalizeLibrary", n, () => normalizeLibrary(copy), { setup: () => { copy = fresh(lib); } });
      await bench(G, "open/c: validateLibrary (full)", n, () => validateLibrary(copy));
      await bench(G, "open/d: freezeLibrary", n, () => freezeLibrary(copy), { setup: () => { copy = fresh(lib); } });

      // 2) 写路径：真 SQLite。
      const store = await openReal();
      const lastId = pad("r", n - 1);
      let tick = 0;
      await bench(G, "change: keystroke draft update (updateDraft, sqlite)", n, () =>
        store.change((s) => {
          const d = s.drafts.d1!;
          // model.updateDraft 的本体：整份草稿换成新副本。
          s.drafts.d1 = clone({ ...d, content: { ...d.content, text: `${d.content.text}啊` }, updatedAt: new Date(Date.now() + tick++).toISOString() } as RecordDraft);
        }), { runs: 15 });
      await bench(G, "change: patchRecord toggle first (sqlite)", n, () =>
        store.change((s) => patchRecord(s, lastId, { first: !s.records[lastId]!.first }, new Date().toISOString())), { runs: 9 });
      let draftId = "";
      await bench(G, "change: saveRecord new record (removes draft -> full validate)", n, () =>
        store.change((s) => saveRecord(s, draftId, `new${tick++}`, new Date().toISOString())), {
        runs: 7,
        setup: async () => {
          draftId = `bench${tick++}`;
          await store.change((s) => {
            s.drafts[draftId] = { id: draftId, recordId: null, baseRevision: 0, content: { title: "", text: "新的一段", date: new Date().toISOString(), location: "", first: false, mediaIds: [], coverId: null }, updatedAt: new Date().toISOString() };
          });
        },
      });
      let victim = 0;
      await bench(G, "change: deleteRecord (tombstone + album scan + full validate)", n, () =>
        store.change((s) => deleteRecord(s, pad("r", victim++), new Date().toISOString())), { runs: 7 });
      await bench(G, "change: close a nudge (root-only change)", n, () =>
        store.change((s) => { s.nudgeClosedAt = { ...s.nudgeClosedAt, rhythm: new Date().toISOString() }; }), { runs: 9 });

      // 3) 同一 keystroke 的内存盘版本：扣掉 SQLite 看纯 JS 成本。
      const mem = new LocalStore(memoryDisk(lib));
      await mem.open();
      await bench(G, "change: keystroke draft update (memory disk)", n, () =>
        mem.change((s) => {
          const d = s.drafts.d1!;
          s.drafts.d1 = clone({ ...d, content: { ...d.content, text: `${d.content.text}啊` } } as RecordDraft);
        }), { runs: 15 });

      // 4) 拆分：change() 里每段各多少。
      const current = mem.get();
      let next = forkLibrary(current);
      await bench(G, "change/a: forkLibrary", n, () => { next = forkLibrary(current); }, { runs: 15 });
      next.drafts.d1 = { ...next.drafts.d1!, updatedAt: new Date().toISOString() };
      let delta = diffLibrary(current, next);
      await bench(G, "change/b: diffLibrary", n, () => { delta = diffLibrary(current, next); }, { runs: 15 });
      await bench(G, "change/c: validateChange (1 changed, no removal)", n, () => validateChange(next, delta), { runs: 15 });
      await bench(G, "change/d: validateChange with a removal (= full validateLibrary)", n, () =>
        validateChange(next, { changed: delta.changed, removed: [{ kind: "drafts", id: "gone" }] }), { runs: 5 });
      await bench(G, "change/e: JSON.stringify(rootOf) (written every change)", n, () => JSON.stringify(rootOf(next)), { runs: 15 });
      await bench(G, "reference: JSON.stringify(whole library)", n, () => JSON.stringify(current), { runs: 3 });
    });
  }
});
