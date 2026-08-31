import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";

type MigrationJournal = {
  entries: Array<{
    idx: number;
    when: number;
    tag: string;
  }>;
};

type SnapshotTable = {
  columns: Record<string, unknown>;
  indexes: Record<
    string,
    { name: string; isUnique: boolean; where?: string }
  >;
  foreignKeys: Record<
    string,
    {
      tableTo: string;
      columnsFrom: string[];
      columnsTo: string[];
      onDelete?: string;
      onUpdate?: string;
    }
  >;
  checkConstraints: Record<string, { name: string }>;
};

type MigrationSnapshot = {
  id: string;
  prevId: string;
  tables: Record<string, SnapshotTable>;
};

type SqliteHandle = InstanceType<typeof Database>;

const PROJECT_ROOT = process.cwd();
const MIGRATIONS_DIR = path.join(PROJECT_ROOT, "db", "migrations");
const META_DIR = path.join(MIGRATIONS_DIR, "meta");

function applyMigrationPrefix(
  sqlite: SqliteHandle,
  entries: MigrationJournal["entries"],
): void {
  sqlite.exec(`
    CREATE TABLE "__drizzle_migrations" (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at numeric
    )
  `);
  const insertLedger = sqlite.prepare(
    'INSERT INTO "__drizzle_migrations" (hash, created_at) VALUES (?, ?)',
  );
  for (const entry of entries) {
    const migrationSql = readFileSync(
      path.join(MIGRATIONS_DIR, `${entry.tag}.sql`),
      "utf8",
    );
    for (const statement of migrationSql.split("--> statement-breakpoint")) {
      if (statement.trim()) sqlite.exec(statement);
    }
    insertLedger.run(
      createHash("sha256").update(migrationSql).digest("hex"),
      entry.when,
    );
  }
}

function seedRealV014State(sqlite: SqliteHandle): void {
  const now = 1_700_000_000;
  sqlite.transaction(() => {
    const insertFamily = sqlite.prepare(
      "INSERT INTO family(id, name, timezone, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    );
    insertFamily.run(
      "family-v014",
      "0014 existing family",
      "Asia/Shanghai",
      now,
      now,
    );
    // A restore has durable Family/Person rows before the new setup admin
    // chooses which Person they represent. It intentionally has no bound User.
    insertFamily.run(
      "family-restored-v014",
      "Unbound restored family",
      "Asia/Shanghai",
      now + 1,
      now + 1,
    );

    const insertPerson = sqlite.prepare(`
      INSERT INTO person(
        id, family_id, display_name, relation_to_child, is_child, birth_date,
        avatar_asset_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertPerson.run(
      "child-v014",
      "family-v014",
      "Child",
      null,
      1,
      "2020-02-29",
      null,
      now,
      now,
    );
    insertPerson.run(
      "parent-v014",
      "family-v014",
      "Parent",
      "parent",
      0,
      null,
      null,
      now,
      now,
    );
    insertPerson.run(
      "narrator-v014",
      "family-v014",
      "Narrator",
      "grandparent",
      0,
      null,
      null,
      now,
      now,
    );
    insertPerson.run(
      "restored-child-v014",
      "family-restored-v014",
      "Restored child",
      null,
      1,
      "2021-01-01",
      null,
      now + 1,
      now + 1,
    );
    insertPerson.run(
      "restored-adult-v014",
      "family-restored-v014",
      "Restored adult",
      "parent",
      0,
      null,
      null,
      now + 1,
      now + 1,
    );

    const insertUser = sqlite.prepare(`
      INSERT INTO user(
        id, name, email, email_verified, image, role, family_id, person_id,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertUser.run(
      "admin-v014",
      "Admin",
      "admin-v014@example.test",
      1,
      null,
      "admin",
      "family-v014",
      "parent-v014",
      now,
      now,
    );
    insertUser.run(
      "editor-v014",
      "Editor",
      "editor-v014@example.test",
      1,
      null,
      "editor",
      "family-v014",
      null,
      now,
      now,
    );
    // Durable crash receipt for the active invitation claim below.
    insertUser.run(
      "provisional-v014",
      "Provisional invite account",
      "provisional-v014@example.test",
      0,
      null,
      "viewer",
      null,
      null,
      now,
      now,
    );
    // The restore operator is deliberately unbound until post-restore binding.
    insertUser.run(
      "setup-v014",
      "Setup admin",
      "setup-v014@example.test",
      1,
      null,
      "admin",
      null,
      null,
      now,
      now,
    );

    sqlite
      .prepare(`
        INSERT INTO session(
          id, token, user_id, expires_at, ip_address, user_agent,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        "session-v014",
        "session-token-v014",
        "editor-v014",
        2_000_000_000,
        "127.0.0.1",
        "upgrade-v014-test",
        now,
        now,
      );

    sqlite
      .prepare(`
        INSERT INTO memory_event(
          id, family_id, child_person_id, title, occurred_at,
          occurred_at_precision, location_text, cover_asset_id, status,
          age_days, last_edited_by_user_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        "event-v014",
        "family-v014",
        "child-v014",
        "Existing 0014 event",
        now,
        "exact",
        "Home",
        null,
        "confirmed",
        1_000,
        "admin-v014",
        now,
        now,
      );

    sqlite
      .prepare(`
        INSERT INTO contribution(
          id, memory_event_id, author_person_id, raw_text, audio_asset_id,
          transcript, edited_text, visibility, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        "contribution-v014",
        "event-v014",
        "narrator-v014",
        "Legacy raw words",
        null,
        "Legacy transcript must survive",
        "Legacy edited words",
        "parents",
        now,
        now,
      );

    sqlite
      .prepare(`
        INSERT INTO family_invitation(
          id, token_hash, family_id, role, email, person_id, expires_at,
          claim_nonce, claim_expires_at, provisioned_user_id, used_at,
          used_by_user_id, revoked_at, revoked_by_user_id,
          created_by_user_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        "invitation-v014",
        "a".repeat(64),
        "family-v014",
        "contributor",
        "provisional-v014@example.test",
        "narrator-v014",
        2_000_000_000,
        "active-claim-nonce-v014",
        1_900_000_000,
        "provisional-v014",
        null,
        null,
        null,
        null,
        "admin-v014",
        now,
        now,
      );
  })();
}

function normalizedForeignKeys(sqlite: SqliteHandle, table: string) {
  return (
    sqlite.prepare(`PRAGMA foreign_key_list("${table}")`).all() as Array<{
      table: string;
      from: string;
      to: string;
      on_delete: string;
      on_update: string;
    }>
  )
    .map((foreignKey) => ({
      table: foreignKey.table,
      from: foreignKey.from,
      to: foreignKey.to,
      onDelete: foreignKey.on_delete.toLowerCase(),
      onUpdate: foreignKey.on_update.toLowerCase(),
    }))
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

function assertSnapshotParity(
  sqlite: SqliteHandle,
  snapshot: MigrationSnapshot,
  tableNames: string[],
): void {
  for (const tableName of tableNames) {
    const expected = snapshot.tables[tableName];
    expect(expected, `snapshot table ${tableName}`).toBeDefined();

    const actualColumns = (
      sqlite.prepare(`PRAGMA table_info("${tableName}")`).all() as Array<{
        name: string;
      }>
    )
      .map((column) => column.name)
      .sort();
    expect(actualColumns).toEqual(
      expect.arrayContaining(Object.keys(expected.columns).sort()),
    );

    const expectedForeignKeys = Object.values(expected.foreignKeys)
      .map((foreignKey) => ({
        table: foreignKey.tableTo,
        from: foreignKey.columnsFrom[0],
        to: foreignKey.columnsTo[0],
        onDelete: (foreignKey.onDelete ?? "no action").toLowerCase(),
        onUpdate: (foreignKey.onUpdate ?? "no action").toLowerCase(),
      }))
      .sort((left, right) =>
        JSON.stringify(left).localeCompare(JSON.stringify(right)),
      );
    expect(normalizedForeignKeys(sqlite, tableName)).toEqual(
      expect.arrayContaining(expectedForeignKeys),
    );

    const actualIndexes = (
      sqlite.prepare(`PRAGMA index_list("${tableName}")`).all() as Array<{
        name: string;
        unique: number;
        partial: number;
      }>
    )
      .filter((index) => !index.name.startsWith("sqlite_autoindex"))
      .map((index) => ({
        name: index.name,
        unique: Boolean(index.unique),
        partial: Boolean(index.partial),
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
    const expectedIndexes = Object.values(expected.indexes)
      .map((index) => ({
        name: index.name,
        unique: Boolean(index.isUnique),
        partial: Boolean(index.where),
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
    expect(actualIndexes).toEqual(expect.arrayContaining(expectedIndexes));

    const tableSql = (
      sqlite
        .prepare(
          "SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = ?",
        )
        .get(tableName) as { sql: string }
    ).sql;
    for (const checkName of Object.keys(expected.checkConstraints)) {
      expect(tableSql).toContain(checkName);
    }
  }
}

describe("real 0014 family invitation archive upgrade", () => {
  it("upgrades through HEAD without losing claims, sessions, legacy words, or restore state", () => {
    const workDir = mkdtempSync(path.join(tmpdir(), "ftc-upgrade-v014-"));
    const databasePath = path.join(workDir, "capsule.sqlite");
    let sqlite = new Database(databasePath);

    try {
      sqlite.pragma("foreign_keys = ON");
      const journal = JSON.parse(
        readFileSync(path.join(META_DIR, "_journal.json"), "utf8"),
      ) as MigrationJournal;
      const v014Entries = journal.entries.filter((entry) => entry.idx <= 14);
      expect(v014Entries).toHaveLength(15);
      expect(v014Entries.at(-1)?.tag).toBe("0014_family_invitations");

      applyMigrationPrefix(sqlite, v014Entries);
      seedRealV014State(sqlite);
      sqlite.pragma("wal_checkpoint(TRUNCATE)");
      sqlite.close();

      // Reopen exactly as a production restart would, then let the official
      // Drizzle migrator discover and apply 0015 from the real migration ledger.
      sqlite = new Database(databasePath);
      sqlite.pragma("foreign_keys = ON");
      migrate(drizzle(sqlite), { migrationsFolder: MIGRATIONS_DIR });

      expect(
        sqlite
          .prepare(
            'SELECT created_at FROM "__drizzle_migrations" ORDER BY created_at DESC LIMIT 1',
          )
          .get(),
      ).toEqual({ created_at: journal.entries.at(-1)?.when });

      expect(
        sqlite
          .prepare(`
            SELECT id, role, family_id, person_id, disabled_at,
                   disabled_by_user_id
            FROM user ORDER BY id
          `)
          .all(),
      ).toEqual([
        {
          id: "admin-v014",
          role: "admin",
          family_id: "family-v014",
          person_id: "parent-v014",
          disabled_at: null,
          disabled_by_user_id: null,
        },
        {
          id: "editor-v014",
          role: "editor",
          family_id: "family-v014",
          person_id: null,
          disabled_at: null,
          disabled_by_user_id: null,
        },
        {
          id: "provisional-v014",
          role: "viewer",
          family_id: null,
          person_id: null,
          disabled_at: null,
          disabled_by_user_id: null,
        },
        {
          id: "setup-v014",
          role: "admin",
          family_id: null,
          person_id: null,
          disabled_at: null,
          disabled_by_user_id: null,
        },
      ]);

      expect(
        sqlite
          .prepare(`
            SELECT id, token_hash, family_id, role, email, person_id,
                   expires_at, claim_nonce, claim_expires_at,
                   provisioned_user_id, used_at, revoked_at,
                   created_by_user_id, created_at, updated_at
            FROM family_invitation WHERE id = 'invitation-v014'
          `)
          .get(),
      ).toEqual({
        id: "invitation-v014",
        token_hash: "a".repeat(64),
        family_id: "family-v014",
        role: "contributor",
        email: "provisional-v014@example.test",
        person_id: "narrator-v014",
        expires_at: 2_000_000_000,
        claim_nonce: "active-claim-nonce-v014",
        claim_expires_at: 1_900_000_000,
        provisioned_user_id: "provisional-v014",
        used_at: null,
        revoked_at: null,
        created_by_user_id: "admin-v014",
        created_at: 1_700_000_000,
        updated_at: 1_700_000_000,
      });

      expect(
        sqlite
          .prepare(`
            SELECT id, raw_text, transcript, edited_text, visibility,
                   recorded_by_user_id, recorded_by_person_id,
                   recorded_by_name_snapshot, recording_mode,
                   created_at, updated_at
            FROM contribution WHERE id = 'contribution-v014'
          `)
          .get(),
      ).toEqual({
        id: "contribution-v014",
        raw_text: "Legacy raw words",
        transcript: "Legacy transcript must survive",
        edited_text: "Legacy edited words",
        visibility: "parents",
        recorded_by_user_id: null,
        recorded_by_person_id: null,
        recorded_by_name_snapshot: null,
        recording_mode: "legacy",
        created_at: 1_700_000_000,
        updated_at: 1_700_000_000,
      });

      expect(
        sqlite
          .prepare(
            "SELECT id, child_later_unlock_age FROM family ORDER BY id",
          )
          .all(),
      ).toEqual([
        { id: "family-restored-v014", child_later_unlock_age: 18 },
        { id: "family-v014", child_later_unlock_age: 18 },
      ]);
      expect(
        sqlite
          .prepare(`
            SELECT id, is_guardian, child_later_unlocked_at
            FROM person ORDER BY id
          `)
          .all(),
      ).toEqual([
        { id: "child-v014", is_guardian: 0, child_later_unlocked_at: null },
        {
          id: "narrator-v014",
          is_guardian: 0,
          child_later_unlocked_at: null,
        },
        { id: "parent-v014", is_guardian: 0, child_later_unlocked_at: null },
        {
          id: "restored-adult-v014",
          is_guardian: 0,
          child_later_unlocked_at: null,
        },
        {
          id: "restored-child-v014",
          is_guardian: 0,
          child_later_unlocked_at: null,
        },
      ]);
      expect(
        sqlite
          .prepare(
            "SELECT id, user_id, expires_at FROM session WHERE id = 'session-v014'",
          )
          .get(),
      ).toEqual({
        id: "session-v014",
        user_id: "editor-v014",
        expires_at: 2_000_000_000,
      });
      expect(
        sqlite
          .prepare(
            "SELECT count(*) AS count FROM user WHERE family_id = 'family-restored-v014'",
          )
          .get(),
      ).toEqual({ count: 0 });

      const snapshot = JSON.parse(
        readFileSync(path.join(META_DIR, "0015_snapshot.json"), "utf8"),
      ) as MigrationSnapshot;
      const previousSnapshot = JSON.parse(
        readFileSync(path.join(META_DIR, "0014_snapshot.json"), "utf8"),
      ) as MigrationSnapshot;
      expect(snapshot.prevId).toBe(previousSnapshot.id);
      assertSnapshotParity(sqlite, snapshot, [
        "user",
        "family",
        "person",
        "contribution",
      ]);

      const expectedTriggers = [
        "contribution_family_provenance_insert_guard",
        "contribution_family_provenance_update_guard",
        "contribution_visibility_insert_guard",
        "contribution_visibility_update_guard",
        "person_child_policy_insert_guard",
        "person_child_policy_update_guard",
        "person_family_immutable_guard",
        "session_enabled_user_insert_guard",
        "session_enabled_user_update_guard",
        "user_disable_revoke_sessions",
        "user_disabled_pair_update_guard",
        "user_last_enabled_admin_delete_guard",
        "user_last_enabled_admin_update_guard",
        "user_person_family_insert_guard",
        "user_person_family_update_guard",
        "user_role_insert_guard",
        "user_role_update_guard",
      ];
      expect(
        sqlite
          .prepare(
            "SELECT name FROM sqlite_schema WHERE type = 'trigger' ORDER BY name",
          )
          .all(),
      ).toEqual(
        expect.arrayContaining(expectedTriggers.map((name) => ({ name }))),
      );
      expect(
        sqlite
          .prepare(`
            SELECT name FROM sqlite_schema
            WHERE name LIKE '__new_%' OR tbl_name LIKE '__new_%'
          `)
          .all(),
      ).toEqual([]);
      expect(sqlite.pragma("integrity_check", { simple: true })).toBe("ok");
      expect(sqlite.pragma("foreign_key_check")).toEqual([]);

      // Representative trigger/CHECK probes prove this is more than schema
      // text: restored binding remains possible while policy bypasses fail.
      expect(() =>
        sqlite.exec(`
          UPDATE user
          SET family_id = 'family-restored-v014',
              person_id = 'restored-adult-v014'
          WHERE id = 'setup-v014'
        `),
      ).not.toThrow();
      expect(() =>
        sqlite.exec(`
          UPDATE family SET child_later_unlock_age = 18.5
          WHERE id = 'family-v014'
        `),
      ).toThrow(/family_child_later_unlock_age_check/);
      expect(() =>
        sqlite.exec(`
          UPDATE person SET child_later_unlocked_at = -1
          WHERE id = 'child-v014'
        `),
      ).toThrow(/invalid Person guardian or child unlock policy/);
      expect(() =>
        sqlite.exec(`
          UPDATE person SET family_id = 'family-restored-v014'
          WHERE id = 'parent-v014'
        `),
      ).toThrow(/Person family is immutable/);
      expect(() =>
        sqlite.exec(`
          UPDATE contribution
          SET recording_mode = 'self',
              recorded_by_person_id = NULL,
              recorded_by_name_snapshot = 'Narrator'
          WHERE id = 'contribution-v014'
        `),
      ).toThrow(/contribution_recording_provenance_check/);

      sqlite.exec(`
        INSERT INTO user(
          id, name, email, email_verified, role, family_id, disabled_at,
          created_at, updated_at
        ) VALUES (
          'disabled-v014-probe', 'Disabled probe',
          'disabled-v014-probe@example.test', 0, 'viewer', 'family-v014', 1,
          0, 0
        )
      `);
      expect(() =>
        sqlite.exec(`
          INSERT INTO session(
            id, token, user_id, expires_at, created_at, updated_at
          ) VALUES (
            'disabled-session-v014-probe', 'disabled-session-token-v014',
            'disabled-v014-probe', 2000000000, 0, 0
          )
        `),
      ).toThrow(/session requires enabled user/);
      sqlite.exec("DELETE FROM user WHERE id = 'disabled-v014-probe'");
      expect(sqlite.pragma("foreign_key_check")).toEqual([]);
    } finally {
      if (sqlite.open) sqlite.close();
      rmSync(workDir, { recursive: true, force: true });
    }
  });
});
