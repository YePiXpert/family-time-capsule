import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { MOBILE_LOCAL_SCHEMA_SQL } from "../../mobile/src/storage/schema";

describe("native local-first schema", () => {
  it("migrates existing outbox captures into the local timeline idempotently", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE outbox (
        id TEXT PRIMARY KEY NOT NULL,
        kind TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        last_error TEXT
      );
    `);
    db.prepare(
      "INSERT INTO outbox(id, kind, payload_json, created_at) VALUES (?, ?, ?, ?)",
    ).run(
      "legacy-photo",
      "media_capture",
      JSON.stringify({
        localUri: "file:///captures/legacy-photo.heic",
        fileName: "宝宝.heic",
        mediaType: "image",
      }),
      "2026-09-03T20:00:00.000Z",
    );

    db.exec(MOBILE_LOCAL_SCHEMA_SQL);
    db.exec(MOBILE_LOCAL_SCHEMA_SQL);

    expect(
      db.prepare("SELECT * FROM local_capture").all(),
    ).toEqual([
      expect.objectContaining({
        id: "legacy-photo",
        title: "宝宝.heic",
        local_uri: "file:///captures/legacy-photo.heic",
        media_type: "image",
        sync_state: "pending",
      }),
    ]);
    expect(
      db.prepare("SELECT count(*) AS count FROM outbox").get(),
    ).toEqual({ count: 1 });
    db.close();
  });
});
