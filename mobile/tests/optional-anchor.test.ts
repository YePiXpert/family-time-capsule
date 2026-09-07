import { expect, it, vi } from "vitest";
import { MOBILE_LOCAL_SCHEMA_SQL } from "../src/storage/schema";
import { initializeLocalStore } from "../src/storage/database";
import { getRawMockDatabase } from "../../tests/mocks/expo-sqlite";

vi.mock("expo-sqlite", async () => await import("../../tests/mocks/expo-sqlite"));

it("rebuilds the old timeline cache without losing cached files, outbox or existing anchors", async () => {
  const db = getRawMockDatabase();
  db.exec(MOBILE_LOCAL_SCHEMA_SQL.replace('child_person_id TEXT,', 'child_person_id TEXT NOT NULL,'));
  db.exec(`INSERT INTO timeline_event(id,title,occurred_at,occurred_at_precision,child_person_id,updated_at,asset_count,participant_names_json,local_cover_uri)
    VALUES ('old','旧记录','2026-01-01','date_only','child','2026-01-01',1,'[]','file:///saved.jpg')`);
  const before = db.prepare('SELECT * FROM timeline_event').all();
  await initializeLocalStore();
  expect(db.prepare('SELECT * FROM timeline_event').all()).toEqual(before);
  db.exec(`INSERT INTO timeline_event(id,title,occurred_at,occurred_at_precision,child_person_id,updated_at,asset_count,participant_names_json)
    VALUES ('grandparent','祖辈记忆','1980-01-01','date_only',NULL,'2026-01-01',0,'[]')`);
  await initializeLocalStore();
  expect(db.prepare("SELECT child_person_id FROM timeline_event WHERE id='grandparent'").get()).toEqual({ child_person_id: null });
  expect(db.prepare('SELECT count(*) n FROM timeline_event').get()).toEqual({ n: 2 });
});
