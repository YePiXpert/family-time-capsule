import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { openDatabaseConnection } from "@/db";
import { familyStoryPredicate } from "@/lib/authz/story-access";

it("upgrades real pre-input-manifest stories without guessing lost AI provenance or deleting any original prose", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ftc-story-input-upgrade-"));
  const databasePath = path.join(dir, "capsule.sqlite"), migrationsFolder = path.join(process.cwd(), "db/migrations");
  let sqlite = new Database(databasePath);
  try {
    sqlite.exec("create table __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)");
    const journal = JSON.parse(readFileSync(path.join(migrationsFolder, "meta/_journal.json"), "utf8"));
    for (const entry of journal.entries.filter((e: { idx: number }) => e.idx < 69)) {
      const source = readFileSync(path.join(migrationsFolder, `${entry.tag}.sql`), "utf8");
      for (const statement of source.split("--> statement-breakpoint")) if (statement.trim()) sqlite.exec(statement);
      sqlite.prepare("insert into __drizzle_migrations(hash,created_at) values (?,?)").run(createHash("sha256").update(source).digest("hex"), entry.when);
    }
    sqlite.exec("insert into family(id,name,timezone,created_at,updated_at) values ('family','旧家庭','UTC',0,0)");
    for (const [id, job] of [["known-ai", "old-job"], ["restored-or-manual", null]]) {
      sqlite.prepare("insert into story(id,family_id,kind,period_start,period_end,title,status,created_by_job_id,created_at,updated_at) values (?,'family','monthly',0,2678400,'旧标题','published',?,0,0)").run(id, job);
      sqlite.prepare("insert into story_paragraph(id,family_id,story_id,position,kind,text,created_at,updated_at) values (?,'family',?,0,'narrative','不可丢失的旧正文',0,0)").run(id, id);
    }
    const before = sqlite.prepare("select * from story_paragraph order by id").all();
    sqlite.close();
    const connection = openDatabaseConnection({ databasePath, migrationsFolder, snapshotDirectory: path.join(dir, "snapshots") });
    sqlite = connection.sqlite;
    expect(sqlite.prepare("select id,input_sources_json from story order by id").all()).toEqual([
      { id: "known-ai", input_sources_json: null }, { id: "restored-or-manual", input_sources_json: null },
    ]);
    expect(sqlite.prepare("select * from story_paragraph order by id").all()).toEqual(before);
    expect(connection.db.all(sql`select id from story where ${familyStoryPredicate("family", sql`story.id`)}`)).toEqual([]);
    expect(sqlite.pragma("foreign_key_check")).toEqual([]);
  } finally { if (sqlite.open) sqlite.close(); rmSync(dir, { recursive: true, force: true }); }
});
