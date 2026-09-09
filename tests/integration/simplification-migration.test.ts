import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { expect, it } from "vitest";
import { runMigrationsWithPreMigrationSnapshot } from "@/db/migration-safety";

it("retires modules without losing the populated core/work graph, and cancels old AI leases", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "ftc-simplification-upgrade-"));
  const db = new Database(path.join(directory, "capsule.sqlite"));
  try {
    const migrationsFolder = path.join(process.cwd(), "db/migrations");
    const journal = JSON.parse(readFileSync(path.join(migrationsFolder, "meta/_journal.json"), "utf8")) as { entries: { tag: string; when: number }[] };
    db.exec('CREATE TABLE "__drizzle_migrations" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)');
    for (const entry of journal.entries.slice(0, -1)) {
      const sql = readFileSync(path.join(migrationsFolder, `${entry.tag}.sql`), "utf8");
      for (const statement of sql.split("--> statement-breakpoint")) if (statement.trim()) db.exec(statement);
      db.prepare('INSERT INTO "__drizzle_migrations" (hash,created_at) VALUES (?,?)').run(createHash("sha256").update(sql).digest("hex"), entry.when);
    }
    db.pragma("foreign_keys=ON");
    const insert = (table: string, values: Record<string, string | number | null>) => {
      const keys = Object.keys(values);
      db.prepare(`INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`).run(...Object.values(values));
    };
    const now = Math.floor(Date.now() / 1000);
    insert("family", { id: "family", name: "保留的家庭", timezone: "Pacific/Auckland", child_later_unlock_age: 21, created_at: now, updated_at: now });
    insert("user", { id: "owner", family_id: "family", name: "记录者", email: "migration@fixture.invalid", role: "admin", created_at: now, updated_at: now });
    insert("memory_event", { id: "memory", family_id: "family", title: "原始记忆", occurred_at: 0, occurred_at_precision: "unknown", created_by_user_id: "owner", visibility: "private", created_at: now, updated_at: now });
    insert("book_project", { id: "book", family_id: "family", owner_user_id: "owner", title: "手工排版", template: "growth", audience: "personal", created_at: now, updated_at: now });
    insert("book_chapter", { id: "chapter", family_id: "family", project_id: "book", title: "一章", position: 0 });
    insert("book_block", { id: "block", family_id: "family", project_id: "book", chapter_id: "chapter", position: 0, kind: "text", text: "手工文字", layout_json: "{}" });
    insert("book_source_ref", { id: "source", family_id: "family", project_id: "book", kind: "memory", memory_event_id: "memory", fingerprint: "original-fingerprint", label: "原始记忆", created_at: now });
    insert("book_block_source", { id: "join", family_id: "family", project_id: "book", block_id: "block", source_ref_id: "source", position: 0 });
    insert("book_revision", { id: "version", family_id: "family", project_id: "book", revision: 1, snapshot_json: '{"text":"手工版本"}', created_at: now });
    for (const status of ["pending", "running"]) {
      insert("ai_job", { id: status, family_id: "family", job_type: "generate.story.v1", entity_type: "story", entity_id: "retired", required_capability: "text", provider_id: "fake", model: "fixture", provider_external: 0, trigger_mode: "manual", content_visibility: "family", status, lease_generation: status === "running" ? 1 : 0, attempts: status === "running" ? 1 : 0, started_at: status === "running" ? now : null, payload_json: "{}", idempotency_key: createHash("sha256").update(status).digest("hex"), available_at: now, requested_by_user_id: "owner", created_at: now, updated_at: now, lease_owner: status === "running" ? "worker" : null, lease_expires_at: status === "running" ? now + 60 : null });
    }
    insert("ai_job_attempt", { id: "attempt", job_id: "running", attempt_number: 1, lease_generation: 1, worker_id: "worker", status: "running", provider_id: "fake", model: "fixture", started_at: now });
    const coreTables = ["user", "memory_event", "book_project", "book_chapter", "book_block", "book_block_source", "book_revision"];
    const before = coreTables.map(table => db.prepare(`SELECT * FROM ${table}`).all());
    const result = runMigrationsWithPreMigrationSnapshot({ sqlite: db, migrationsFolder, snapshotDirectory: path.join(directory, "snapshots"), runMigrations: () => migrate(drizzle(db), { migrationsFolder }) });
    expect(result.snapshotPath).toBeTruthy();
    expect(coreTables.map(table => db.prepare(`SELECT * FROM ${table}`).all())).toEqual(before);
    expect(db.prepare("SELECT * FROM family").get()).toMatchObject({ name: "保留的家庭", timezone: "Pacific/Auckland", child_later_unlock_age: 21 });
    expect(db.prepare("SELECT * FROM book_source_ref").get()).toMatchObject({ id: "source", memory_event_id: "memory", fingerprint: "original-fingerprint" });
    expect(db.pragma("table_info(book_source_ref)")).not.toContainEqual(expect.objectContaining({ name: "story_id" }));
    for (const table of ["story", "capsule", "review_period", "contribution_request", "contribution_portal_submission"]) expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table)).toBeUndefined();
    expect(db.prepare("SELECT status,lease_owner,finished_at,last_error_code FROM ai_job").all()).toEqual(Array(2).fill({ status: "cancelled", lease_owner: null, finished_at: expect.any(Number), last_error_code: "feature_retired" }));
    expect(db.prepare("SELECT status FROM ai_job_attempt").get()).toEqual({ status: "cancelled" });
    const sequence = (db.prepare("SELECT max(seq) n FROM sync_change").get() as { n: number }).n;
    db.prepare("UPDATE family SET name='已更新' WHERE id='family'").run();
    db.prepare("UPDATE book_source_ref SET label='来源更新' WHERE id='source'").run();
    expect((db.prepare("SELECT max(seq) n FROM sync_change").get() as { n: number }).n).toBe(sequence + 2);
    expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(db.pragma("foreign_key_check")).toEqual([]);
    expect(db.pragma("integrity_check", { simple: true })).toBe("ok");
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});
