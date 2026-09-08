import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { expect, it } from "vitest";
import { openDatabaseConnection } from "@/db";

it("upgrades populated 0060 drafts without losing items, intake references, values or foreign keys", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ftc-reader-upgrade-"));
  const databasePath = path.join(dir, "capsule.sqlite"), folder = path.join(process.cwd(), "db/migrations");
  let db = new Database(databasePath);
  try {
    db.exec("CREATE TABLE __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)");
    const journal = JSON.parse(readFileSync(path.join(folder, "meta/_journal.json"), "utf8"));
    for (const entry of journal.entries.filter((e: { idx: number }) => e.idx <= 60)) {
      const source = readFileSync(path.join(folder, `${entry.tag}.sql`), "utf8");
      for (const statement of source.split("--> statement-breakpoint")) if (statement.trim()) db.exec(statement);
      db.prepare("INSERT INTO __drizzle_migrations(hash,created_at) VALUES (?,?)").run(createHash("sha256").update(source).digest("hex"), entry.when);
    }
    db.pragma("foreign_keys = ON");
    db.exec(`INSERT INTO family(id,name,timezone,created_at,updated_at) VALUES ('family','旧家庭','Asia/Shanghai',0,0);
      INSERT INTO user(id,name,email,role,family_id,created_at,updated_at) VALUES ('user','旧作者','migration@fixture.invalid','owner','family',0,0);
      INSERT INTO draft(id,family_id,author_user_id,title,text,occurred_at_precision,visibility,revision,mutation_id,created_at,updated_at)
        VALUES ('draft','family','user','旧草稿','不能丢失的正文','unknown','private',7,'old-mutation','2026-09-01','2026-09-02');
      INSERT INTO draft_item(id,draft_id,local_capture_ref,sort_order,caption) VALUES ('item','draft','original-device',0,'唯一原件在旧设备');
      INSERT INTO import_session(id,family_id,source,created_by_user_id,created_at,updated_at,intake_destination,intake_draft_id,intake_revision)
        VALUES ('intake','family','native','user',0,0,'draft','draft',3);`);
    const before = Object.fromEntries(["draft", "draft_item", "import_session"].map(table => [table, db.prepare(`select * from ${table}`).all()]));
    const foreignKeys = db.pragma("foreign_key_list(draft)");
    expect(() => db.exec("update draft set visibility='members',reader_user_ids_json='[\"user\"]'")).toThrow(/CHECK/);
    db.close();
    const options = { databasePath, migrationsFolder: folder, snapshotDirectory: path.join(dir, "snapshots") };
    db = openDatabaseConnection(options).sqlite;
    for (const table of Object.keys(before)) expect(db.prepare(`select * from ${table}`).all()).toEqual(before[table]);
    expect(db.pragma("foreign_key_list(draft)")).toEqual(foreignKeys);
    db.exec("update draft set visibility='members',reader_user_ids_json='[\"user\"]'");
    expect(db.prepare("select visibility,reader_user_ids_json from draft").get()).toEqual({ visibility: "members", reader_user_ids_json: '["user"]' });
    expect(() => db.exec("update draft set visibility='public'")).toThrow(/CHECK/);
    expect(db.pragma("foreign_key_check")).toEqual([]);
    db.close(); db = openDatabaseConnection(options).sqlite;
    expect(db.prepare("select count(*) count from draft_item").get()).toEqual({ count: 1 });
    expect(db.prepare("select intake_draft_id from import_session").get()).toEqual({ intake_draft_id: "draft" });
    expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
  } finally { if (db.open) db.close(); rmSync(dir, { recursive: true, force: true }); }
});
