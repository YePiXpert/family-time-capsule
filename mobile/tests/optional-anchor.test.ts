import { expect, it, vi } from "vitest";
import { MOBILE_LOCAL_SCHEMA_SQL, TIMELINE_SCHEMA_SQL } from "../src/storage/schema";
import { initializeLocalStore } from "../src/storage/database";
import { getRawMockDatabase } from "../../tests/mocks/expo-sqlite";

vi.mock("expo-sqlite", async () => await import("../../tests/mocks/expo-sqlite"));

/**
 * 旧安装的表结构：timeline 的 child_person_id 为 NOT NULL，且 timeline/people
 * 没有逐行 scope 列（memory_detail 的 scope 自始就有，必须保留）。
 */
const LEGACY_SCHEMA_SQL = MOBILE_LOCAL_SCHEMA_SQL
  .replace(
    TIMELINE_SCHEMA_SQL,
    TIMELINE_SCHEMA_SQL
      .replace(/^[ \t]*scope TEXT NOT NULL,\r?\n/gm, "")
      .replace(/^[ \t]*CREATE INDEX IF NOT EXISTS timeline_scope_idx\r?\n[^\n]*\r?\n/gm, "")
      .replace("child_person_id TEXT,", "child_person_id TEXT NOT NULL,"),
  )
  .replace(
    /CREATE TABLE IF NOT EXISTS people \(\r?\n\s*id TEXT PRIMARY KEY NOT NULL,\r?\n\s*scope TEXT NOT NULL,\r?\n/,
    "CREATE TABLE IF NOT EXISTS people (\n    id TEXT PRIMARY KEY NOT NULL,\n",
  )
  .replace(/^[ \t]*CREATE INDEX IF NOT EXISTS people_scope_idx[^\n]*\r?\n/gm, "");

it("rebuilds the old timeline cache without losing cached files, outbox or existing anchors", async () => {
  const db = getRawMockDatabase();
  db.exec(LEGACY_SCHEMA_SQL);
  db.exec(`INSERT INTO timeline_event(id,title,occurred_at,occurred_at_precision,child_person_id,updated_at,asset_count,participant_names_json,local_cover_uri)
    VALUES ('old','旧记录','2026-01-01','date_only','child','2026-01-01',1,'[]','file:///saved.jpg')`);
  await initializeLocalStore();
  // 业务列原样保留；scope 按迁移规则回填为「不可归属」。
  expect(db.prepare("SELECT id,title,occurred_at,child_person_id,local_cover_uri FROM timeline_event WHERE id='old'").get())
    .toEqual({ id: "old", title: "旧记录", occurred_at: "2026-01-01", child_person_id: "child", local_cover_uri: "file:///saved.jpg" });
  expect(db.prepare("SELECT scope FROM timeline_event WHERE id='old'").get()).toEqual({ scope: "" });
  db.exec(`INSERT INTO timeline_event(id,scope,title,occurred_at,occurred_at_precision,child_person_id,updated_at,asset_count,participant_names_json)
    VALUES ('grandparent','x','祖辈记忆','1980-01-01','date_only',NULL,'2026-01-01',0,'[]')`);
  await initializeLocalStore();
  expect(db.prepare("SELECT child_person_id FROM timeline_event WHERE id='grandparent'").get()).toEqual({ child_person_id: null });
  expect(db.prepare('SELECT count(*) n FROM timeline_event').get()).toEqual({ n: 2 });
});

it("backfills unattributable legacy cache rows to an invisible scope instead of guessing an owner", async () => {
  const db = getRawMockDatabase();
  // mock 库在同一文件内共享：先回到旧结构再验证迁移。
  db.exec("DROP TABLE IF EXISTS timeline_event; DROP TABLE IF EXISTS people;");
  db.exec(LEGACY_SCHEMA_SQL);
  db.exec(`INSERT INTO timeline_event(id,title,occurred_at,occurred_at_precision,child_person_id,updated_at,asset_count,participant_names_json)
    VALUES ('legacy','来历不明的旧缓存','2026-01-01','date_only','child','2026-01-01',0,'[]')`);
  db.exec(`INSERT INTO people(id,display_name,relation_to_child,is_child,birth_date,updated_at)
    VALUES ('p1','旧人物',NULL,0,NULL,'2026-01-01')`);
  await initializeLocalStore();
  // 归属不明的行保留在库里（可被下一次全量同步清理），但任何 scope 都读不到。
  expect(db.prepare("SELECT scope FROM timeline_event WHERE id='legacy'").get()).toEqual({ scope: "" });
  expect(db.prepare("SELECT scope FROM people WHERE id='p1'").get()).toEqual({ scope: "" });
});
