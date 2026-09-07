import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { expect, it } from "vitest";
import { openDatabaseConnection } from "@/db";
it("upgrades a 0052 database with adopted/rejected naming history and preserves all old values/defaults/FKs", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ftc-library-upgrade-"));
  const databasePath = path.join(dir, "capsule.sqlite"), folder = path.join(process.cwd(), "db/migrations");
  let db = new Database(databasePath);
  try {
    db.exec('CREATE TABLE __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)');
    const journal = JSON.parse(readFileSync(path.join(folder, "meta/_journal.json"), "utf8"));
    for (const entry of journal.entries.filter((e: { idx: number }) => e.idx <= 52)) {
      const source = readFileSync(path.join(folder, `${entry.tag}.sql`), "utf8");
      for (const statement of source.split("--> statement-breakpoint")) if (statement.trim()) db.exec(statement);
      db.prepare('INSERT INTO __drizzle_migrations(hash,created_at) VALUES (?,?)').run(createHash("sha256").update(source).digest("hex"), entry.when);
    }
    db.pragma("foreign_keys = ON");
    db.exec(`INSERT INTO family(id,name,timezone,created_at,updated_at) VALUES ('family','旧家庭','Asia/Shanghai',0,0);
      INSERT INTO user(id,name,email,role,family_id,created_at,updated_at) VALUES ('user','旧作者','migration@fixture.invalid','owner','family',0,0);
      INSERT INTO asset(id,family_id,type,original_filename,mime_type,bytes,sha256,storage_key,imported_at,time_source,created_by_user_id,created_at,display_name,name_source,name_revision) VALUES ('asset','family','image','IMG_001.jpg','image/jpeg',123,'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','originals/test.jpg',10,'import_time','user',10,'家里窗边','user',2);
      INSERT INTO ai_suggestion(id,family_id,entity_type,entity_id,suggestion_type,value_json,provider,model,status,source_fingerprint,created_at,resolved_at,resolved_by_user_id,revision,target_revision,applied_revision,previous_name_json) VALUES ('accepted','family','memory_event','legacy-event','title','{"title":"旧建议"}','fake','fake','accepted','old-fingerprint',10,11,'user',1,1,2,'{"text":"旧名字","source":"user"}');
      INSERT INTO ai_suggestion(id,family_id,entity_type,entity_id,suggestion_type,value_json,provider,model,status,source_fingerprint,created_at,resolved_at,revision) VALUES ('rejected','family','inbox_item','legacy-inbox','title','{"title":"保留拒绝历史"}','fake','fake','rejected','old-fingerprint',10,12,1);`);
    const assetBefore = db.prepare("select * from asset").get()!;
    const reviewsBefore = db.prepare("select * from ai_suggestion order by id").all();
    const keys = db.pragma("foreign_key_list(ai_suggestion)");
    const indexes = db.prepare("select name from sqlite_schema where type='index' and tbl_name='ai_suggestion' order by name").all();
    db.close();
    const options = { databasePath, migrationsFolder: folder, snapshotDirectory: path.join(dir, "snapshots") };
    db = openDatabaseConnection(options).sqlite;
    expect(db.prepare("select * from asset").get()).toEqual({ ...assetBefore, participant_ids_json: "[]", metadata_revision: 0 });
    expect(db.prepare("select * from ai_suggestion order by id").all()).toEqual(reviewsBefore);
    expect(db.pragma("foreign_key_list(ai_suggestion)")).toEqual(keys);
    expect(db.prepare("select name from sqlite_schema where type='index' and tbl_name='ai_suggestion' order by name").all()).toEqual(indexes);
    db.exec("update ai_suggestion set entity_type='asset',entity_id='asset' where id='accepted'");
    expect(() => db.exec("update ai_suggestion set entity_type='unexpected'")).toThrow();
    expect(db.pragma("foreign_key_check")).toEqual([]);
    db.close(); db = openDatabaseConnection(options).sqlite;
    expect(db.prepare("select count(*) count from ai_suggestion").get()).toEqual({ count: 2 });
    expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
  } finally { if (db.open) db.close(); rmSync(dir, { recursive: true, force: true }); }
});
