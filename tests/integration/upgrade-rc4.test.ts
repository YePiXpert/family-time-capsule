import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";

type Journal = { entries: Array<{ idx: number; when: number; tag: string }> };
const migrationsDir = path.join(process.cwd(), "db", "migrations");

function applyPrefix(sqlite: InstanceType<typeof Database>, entries: Journal["entries"]) {
  sqlite.exec('CREATE TABLE "__drizzle_migrations" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)');
  const ledger = sqlite.prepare('INSERT INTO "__drizzle_migrations" (hash, created_at) VALUES (?, ?)');
  for (const entry of entries) {
    const migrationSql = readFileSync(path.join(migrationsDir, `${entry.tag}.sql`), "utf8");
    for (const statement of migrationSql.split("--> statement-breakpoint")) {
      if (statement.trim()) sqlite.exec(statement);
    }
    ledger.run(createHash("sha256").update(migrationSql).digest("hex"), entry.when);
  }
}

describe("real v1.0.0-rc.4 database upgrade", () => {
  it("preserves oral-history rows and their foreign keys through 1.1 migrations", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "ftc-upgrade-rc4-"));
    const databasePath = path.join(directory, "capsule.sqlite");
    const sqlite = new Database(databasePath);
    try {
      sqlite.pragma("foreign_keys = ON");
      const journal = JSON.parse(readFileSync(path.join(migrationsDir, "meta", "_journal.json"), "utf8")) as Journal;
      const rc4 = journal.entries.filter((entry) => entry.idx <= 30);
      expect(rc4.at(-1)?.tag).toBe("0030_resurfacing_milestones");
      applyPrefix(sqlite, rc4);
      const now = 1_788_500_000;
      sqlite.prepare("INSERT INTO family(id,name,timezone,created_at,updated_at) VALUES(?,?,?,?,?)")
        .run("family-rc4", "rc.4 family", "Asia/Shanghai", now, now);
      sqlite.prepare("INSERT INTO person(id,family_id,display_name,relation_to_child,is_child,is_guardian,birth_date,avatar_asset_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
        .run("person-rc4", "family-rc4", "妈妈", "妈妈", 0, 1, null, null, now, now);
      sqlite.prepare("INSERT INTO user(id,name,email,email_verified,image,role,family_id,person_id,disabled_at,disabled_by_user_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)")
        .run("user-rc4", "妈妈", "rc4@example.test", 1, null, "admin", "family-rc4", "person-rc4", null, null, now, now);
      sqlite.prepare("INSERT INTO inbox_item(id,family_id,kind,status,raw_text,draft_title,draft_occurred_at,draft_location_text,memory_event_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
        .run("inbox-rc4", "family-rc4", "text", "new", "old answer", null, null, null, null, now, now);
      sqlite.prepare("INSERT INTO contribution_request(id,family_id,token_hash,recipient_label,recipient_person_id,prompt_text,topic_key,status,expires_at,closed_at,closed_by_user_id,created_by_user_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
        .run("request-rc4", "family-rc4", "a".repeat(64), "妈妈", "person-rc4", "小时候最喜欢什么？", "childhood", "open", now + 100_000, null, null, "user-rc4", now, now);
      sqlite.prepare("INSERT INTO contribution_request_submission(id,family_id,request_id,inbox_item_id,created_at) VALUES(?,?,?,?,?)")
        .run("submission-rc4", "family-rc4", "request-rc4", "inbox-rc4", now);

      migrate(drizzle(sqlite), { migrationsFolder: migrationsDir });

      expect(sqlite.pragma("integrity_check", { simple: true })).toBe("ok");
      expect(sqlite.pragma("foreign_key_check")).toEqual([]);
      expect(sqlite.prepare("SELECT kind,title,status,max_submissions,allow_documents FROM contribution_request WHERE id=?").get("request-rc4"))
        .toEqual({ kind: "request", title: null, status: "open", max_submissions: 5, allow_documents: 0 });
      expect(sqlite.prepare("SELECT request_id,inbox_item_id FROM contribution_request_submission WHERE id=?").get("submission-rc4"))
        .toEqual({ request_id: "request-rc4", inbox_item_id: "inbox-rc4" });
      expect(sqlite.prepare('SELECT created_at FROM "__drizzle_migrations" ORDER BY created_at DESC LIMIT 1').pluck().get())
        .toBe(journal.entries.at(-1)?.when);
    } finally {
      sqlite.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
