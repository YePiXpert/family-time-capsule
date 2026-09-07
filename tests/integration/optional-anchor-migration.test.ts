import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { expect, it } from "vitest";
import { openDatabaseConnection } from "@/db";

it("upgrades a real 0050 database without cascading away references, defaults or indexes; restart is idempotent", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ftc-anchor-upgrade-"));
  const databasePath = path.join(dir, "capsule.sqlite");
  let db = new Database(databasePath);
  try {
    db.exec('CREATE TABLE __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)');
    const folder = path.join(process.cwd(), "db/migrations");
    const journal = JSON.parse(readFileSync(path.join(folder, "meta/_journal.json"), "utf8"));
    for (const entry of journal.entries.filter((e: { idx: number }) => e.idx <= 50)) {
      const source = readFileSync(path.join(folder, `${entry.tag}.sql`), "utf8");
      for (const statement of source.split("--> statement-breakpoint")) if (statement.trim()) db.exec(statement);
      db.prepare('INSERT INTO __drizzle_migrations(hash,created_at) VALUES (?,?)').run(createHash("sha256").update(source).digest("hex"), entry.when);
    }
    db.pragma("foreign_keys = ON");
    db.exec(`
      INSERT INTO family(id,name,timezone,created_at,updated_at) VALUES ('family','旧家庭','UTC',0,0);
      INSERT INTO person(id,family_id,display_name,is_child,birth_date,created_at,updated_at) VALUES ('child','family','孩子',1,'2020-01-01',0,0);
      INSERT INTO memory_event(id,family_id,child_person_id,title,occurred_at,created_at,updated_at,age_days) VALUES ('event','family','child','旧故事',100,2,3,0);
      INSERT INTO memory_event_participant(id,family_id,memory_event_id,person_id,created_at) VALUES ('participant','family','event','child',0);
      INSERT INTO memory_event_revision(id,family_id,memory_event_id,snapshot_json,created_at) VALUES ('revision','family','event','{}',0);
      INSERT INTO contribution(id,memory_event_id,author_person_id,raw_text,visibility,created_at,updated_at) VALUES ('voice','event','child','旧的原话','family',0,0);
      INSERT INTO fact(id,memory_event_id,statement,status,created_at,updated_at) VALUES ('fact','event','旧的事实','user_confirmed',0,0);
      INSERT INTO memory_event_tag(id,family_id,memory_event_id,tag,created_at) VALUES ('tag','family','event','旧标签',0);
    `);
    const tables = ["memory_event", "memory_event_participant", "memory_event_revision", "contribution", "fact", "memory_event_tag"];
    const before = tables.map(t => db.prepare(`SELECT * FROM ${t}`).all());
    const indexes = db.prepare("SELECT name,sql FROM sqlite_schema WHERE type='index' AND tbl_name='memory_event' ORDER BY name").all();
    const foreignKeys = db.pragma("foreign_key_list(memory_event)");
    const columns = db.pragma("table_info(memory_event)") as Array<{name:string;notnull:number}>;
    db.close();
    const options = { databasePath, migrationsFolder: folder, snapshotDirectory: path.join(dir, "snapshots") };
    db = openDatabaseConnection(options).sqlite;
    expect(tables.map(t => db.prepare(`SELECT * FROM ${t}`).all())).toEqual(before);
    expect(db.prepare("SELECT name,sql FROM sqlite_schema WHERE type='index' AND tbl_name='memory_event' ORDER BY name").all()).toEqual(indexes);
    expect(db.pragma("foreign_key_list(memory_event)")).toEqual(foreignKeys);
    expect(db.pragma("table_info(memory_event)")).toEqual(columns.map(c => c.name === "child_person_id" ? {...c,notnull:0} : c));
    expect(db.pragma("foreign_keys", {simple:true})).toBe(1);
    expect(db.pragma("foreign_key_check")).toEqual([]);
    db.exec(`INSERT INTO memory_event(id,family_id,child_person_id,title,occurred_at,created_at,updated_at) VALUES ('grandparent','family',NULL,'祖辈记忆',100,2,3)`);
    expect(() => db.exec(`UPDATE memory_event SET child_person_id='missing' WHERE id='grandparent'`)).toThrow();
    db.close(); db = openDatabaseConnection(options).sqlite;
    expect(db.prepare("SELECT child_person_id FROM memory_event WHERE id='grandparent'").get()).toEqual({child_person_id:null});
    expect(tables.map(t => db.prepare(`SELECT * FROM ${t} ${t === 'memory_event' ? "WHERE id='event'" : ''}`).all())).toEqual(before);
  } finally { if (db.open) db.close(); rmSync(dir, {recursive:true,force:true}); }
});
