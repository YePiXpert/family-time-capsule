import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { expect, it } from "vitest";
import { openDatabaseConnection } from "@/db";
it("backfills ordered legacy bodies without doubling mirrored drafts or collapsing repeated source text", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ftc-body-upgrade-"));
  const databasePath = path.join(dir, "capsule.sqlite"), folder = path.join(process.cwd(), "db/migrations");
  let db = new Database(databasePath);
  try {
    db.exec("CREATE TABLE __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)");
    const journal = JSON.parse(readFileSync(path.join(folder, "meta/_journal.json"), "utf8"));
    for (const entry of journal.entries.filter((e: { idx: number }) => e.idx <= 65)) {
      const source = readFileSync(path.join(folder, `${entry.tag}.sql`), "utf8");
      for (const statement of source.split("--> statement-breakpoint")) if (statement.trim()) db.exec(statement);
      db.prepare("INSERT INTO __drizzle_migrations(hash,created_at) VALUES (?,?)").run(createHash("sha256").update(source).digest("hex"), entry.when);
    }
    db.pragma("foreign_keys = ON");
    db.exec(`INSERT INTO family(id,name,timezone,created_at,updated_at) VALUES ('family','旧家庭','UTC',0,0);
      INSERT INTO user(id,name,email,role,family_id,created_at,updated_at) VALUES ('user','作者','migration@fixture.invalid','editor','family',0,0);`);
    for (const id of ["shared", "private", "empty"]) db.prepare("INSERT INTO memory_event(id,family_id,title,occurred_at,created_at,updated_at,visibility,created_by_user_id) VALUES (?,'family','独立标题',0,0,0,?,'user')").run(id,id === "private" ? "private" : "family");
    for (const [id,eventId,text] of [["shared-draft","shared","镜像不应重复"],["private-draft","private","私密完整正文\n第二行"]]) db.prepare("INSERT INTO draft(id,family_id,author_user_id,title,text,occurred_at_precision,visibility,revision,mutation_id,created_at,updated_at,status,memory_event_id) VALUES (?,'family','user','标题',?,'unknown','private',1,'mutation','2026-09-01','2026-09-02','published',?)").run(id,text,eventId);
    for (const [id,text,time] of [["b","重复来源",2],["a","镜像不应重复",1],["c","重复来源",3]]) db.prepare("INSERT INTO inbox_item(id,family_id,kind,status,raw_text,memory_event_id,created_at,updated_at) VALUES (?,'family','text','confirmed',?,'shared',?,0)").run(id,text,time);
    db.exec(`insert into person(id,family_id,display_name,created_at,updated_at) values ('bound','family','已绑定人物',0,0),('unbound','family','同名人物',0,0);
      update user set person_id='bound' where id='user';
      insert into book_project(id,family_id,owner_person_id,title,template,audience,created_at,updated_at) values ('bound-book','family','bound','个人旧书','letters','personal',0,0),('unbound-book','family','unbound','无账号旧书','letters','personal',0,0);`);
    db.close();
    const options = { databasePath, migrationsFolder: folder, snapshotDirectory: path.join(dir, "snapshots") };
    db = openDatabaseConnection(options).sqlite;
    expect(db.prepare("select id,body_text from memory_event order by id").all()).toEqual([
      { id: "empty", body_text: "" }, { id: "private", body_text: "私密完整正文\n第二行" }, { id: "shared", body_text: "镜像不应重复\n\n重复来源\n\n重复来源" },
    ]);
    expect(db.pragma("foreign_key_check")).toEqual([]);
    expect(db.prepare("select id,owner_user_id from book_project order by id").all()).toEqual([{ id: "bound-book", owner_user_id: "user" }, { id: "unbound-book", owner_user_id: null }]);
    db.exec("insert into user(id,name,email,role,family_id,person_id,created_at,updated_at) values ('new-user','同名人物','new@fixture.invalid','editor','family','unbound',0,0)");
    db.exec("update memory_event set body_text='' where id='private'");
    db.close(); db = openDatabaseConnection(options).sqlite;
    expect(db.prepare("select body_text from memory_event where id='private'").get()).toEqual({ body_text: "" });
    expect(db.prepare("select owner_user_id from book_project where id='unbound-book'").get()).toEqual({ owner_user_id: null });
  } finally { if (db.open) db.close(); rmSync(dir, { recursive: true, force: true }); }
});
