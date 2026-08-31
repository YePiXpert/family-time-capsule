import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const fixtureDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(fixtureDir, "../../..");
const migrationsDir = path.join(projectRoot, "db", "migrations");
const journal = JSON.parse(
  readFileSync(path.join(migrationsDir, "meta", "_journal.json"), "utf8"),
);
const v013Entries = journal.entries.filter((entry) => entry.idx <= 10);
const expectedV013Migrations = [
  ["0000_warm_anita_blake", 1788012103109, "01e60808194aff03ece61bb1b417b2b22f8178a470ab6b6bd5a11db209806538"],
  ["0001_curly_grey_gargoyle", 1788013461094, "6e3bef22bac07c25edd8a78e81ba13f0e5cda41ad55bb5cef16745ca9a2ee602"],
  ["0002_plain_lockjaw", 1788014113167, "62bcbdae1e6cfa5c80036e2fac035900262f4fa9dfe9df4a2c13066593b5e3f2"],
  ["0003_motionless_lake", 1788015035265, "aff3241de93ac2842fad01a99933d4c8a67902ad7fa4153554112027ec2ccc4e"],
  ["0004_curvy_pepper_potts", 1788015214644, "d8bc29af2f7defc8a5c1ae8d55084f93b303c9193da8553ea77195754ff07772"],
  ["0005_shiny_blue_blade", 1788016667670, "5e33ad19506946cb1c98db2a6fe1033828432858da6d78981ec41f140eb9937c"],
  ["0006_spooky_bug", 1788017095210, "c35cff9ba4e1dfb7a253404d8dd77484712e9820f8135c5943d86cf1688fe04b"],
  ["0007_thick_cassandra_nova", 1788098094395, "591edd844a6cff1ae3896ff61cfda60bf7e3b4742104350151d385047b7787b3"],
  ["0008_mute_matthew_murdock", 1788105194944, "61b528dc54144aa06f995f8e296e63cbd707481c850a0ff8e28d7e6b9c9f17f8"],
  ["0009_numerous_thor", 1788105575922, "1509bc02cd09b716fcb088ed657c59366b35947f68fd9325a1800f217b54fac2"],
  ["0010_massive_veda", 1788106357031, "c7da36cf6f4ae031be77ccb75673811fd089633ed71b6f860950858327b8c4b4"],
];
if (v013Entries.length !== expectedV013Migrations.length) {
  throw new Error("v0.1.3 migration prefix length changed");
}
for (const [index, entry] of v013Entries.entries()) {
  const [expectedTag, expectedWhen, expectedHash] =
    expectedV013Migrations[index];
  const sql = readFileSync(
    path.join(migrationsDir, `${entry.tag}.sql`),
    "utf8",
  );
  const normalizedHash = createHash("sha256")
    .update(sql.replaceAll("\r\n", "\n"))
    .digest("hex");
  if (
    entry.tag !== expectedTag ||
    entry.when !== expectedWhen ||
    normalizedHash !== expectedHash
  ) {
    throw new Error(`historical migration changed: ${entry.tag}`);
  }
}
const workDir = mkdtempSync(path.join(tmpdir(), "ftc-v013-fixture-"));
const databasePath = path.join(workDir, "capsule.sqlite");
const sqlite = new Database(databasePath);

try {
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(`
    CREATE TABLE "__drizzle_migrations" (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at numeric
    )
  `);
  for (const entry of v013Entries) {
    const sql = readFileSync(
      path.join(migrationsDir, `${entry.tag}.sql`),
      "utf8",
    );
    for (const statement of sql.split("--> statement-breakpoint")) {
      sqlite.exec(statement);
    }
    sqlite
      .prepare(
        'INSERT INTO "__drizzle_migrations" (hash, created_at) VALUES (?, ?)',
      )
      .run(createHash("sha256").update(sql).digest("hex"), entry.when);
  }

  const now = 1_706_745_600;
  sqlite.exec(`
    INSERT INTO user (
      id, name, email, email_verified, image, role, family_id, person_id,
      created_at, updated_at
    ) VALUES (
      'user-v013', '档案管理员', 'v013@example.test', 1, NULL, 'admin', NULL,
      NULL, 1704067200, 1704067200
    );
    INSERT INTO family (id, name, timezone, created_at, updated_at)
      VALUES ('family-v013', '0.1.3 升级夹具家庭', 'Asia/Shanghai',
              1704067200, 1704067200);
    INSERT INTO person (
      id, family_id, display_name, relation_to_child, is_child, birth_date,
      avatar_asset_id, created_at, updated_at
    ) VALUES
      ('child-v013', 'family-v013', '小星', NULL, 1, '2020-01-02', NULL,
       1704067200, 1704067200),
      ('parent-v013', 'family-v013', '妈妈', '妈妈', 0, NULL, NULL,
       1704067201, 1704067201);
    UPDATE user
       SET family_id = 'family-v013', person_id = 'parent-v013'
     WHERE id = 'user-v013';
    INSERT INTO asset (
      id, family_id, type, original_filename, mime_type, bytes, sha256,
      storage_key, captured_at, imported_at, time_source, width, height,
      duration_ms, metadata_json, created_by_user_id, original_asset_id,
      derivative_type, created_at
    ) VALUES (
      'asset-v013', 'family-v013', 'image', '旧档案原图.png', 'image/png', 70,
      '721a062f6f73db9df973f46b4d803375bdebd733e8dc66903763e1a17d4a96df',
      'originals/v0/13/asset-v013.png', 1704067200, 1704153600,
      'embedded_metadata', 1, 1, NULL, '{"fixture":"v0.1.3"}',
      'user-v013', NULL, NULL, 1704153600
    );
    INSERT INTO inbox_item (
      id, family_id, kind, status, raw_text, created_at, updated_at
    ) VALUES
      ('inbox-media-v013', 'family-v013', 'asset', 'confirmed', NULL,
       1704153600, 1704153600),
      ('inbox-text-v013', 'family-v013', 'text', 'new',
       '这是 0.1.3 中尚未整理的完整文字。', 1706745600, 1706745600);
    INSERT INTO inbox_item_asset (
      id, inbox_item_id, asset_id, family_id, created_at
    ) VALUES (
      'inbox-asset-link-v013', 'inbox-media-v013', 'asset-v013',
      'family-v013', 1704153600
    );
    INSERT INTO memory_event (
      id, family_id, child_person_id, title, occurred_at,
      occurred_at_precision, location_text, cover_asset_id, status, age_days,
      last_edited_by_user_id, created_at, updated_at
    ) VALUES
      ('event-old-v013', 'family-v013', 'child-v013', '第一次看雪',
       1704067200, 'exact', '哈尔滨', 'asset-v013', 'confirmed', 1460,
       'user-v013', 1704153600, 1704153600),
      ('event-new-v013', 'family-v013', 'child-v013', '春节团圆饭',
       1706745600, 'date_only', '家里', NULL, 'confirmed', 1491,
       NULL, ${now}, ${now});
    INSERT INTO memory_event_asset (
      id, memory_event_id, asset_id, family_id, created_at
    ) VALUES (
      'event-asset-v013', 'event-old-v013', 'asset-v013', 'family-v013',
      1704153600
    );
    INSERT INTO memory_event_participant (
      id, memory_event_id, person_id, family_id, created_at
    ) VALUES
      ('participant-child-old-v013', 'event-old-v013', 'child-v013',
       'family-v013', 1704153600),
      ('participant-parent-old-v013', 'event-old-v013', 'parent-v013',
       'family-v013', 1704153600),
      ('participant-child-new-v013', 'event-new-v013', 'child-v013',
       'family-v013', ${now});
    INSERT INTO contribution (
      id, memory_event_id, author_person_id, raw_text, audio_asset_id,
      transcript, edited_text, visibility, created_at, updated_at
    ) VALUES (
      'contribution-v013', 'event-old-v013', 'parent-v013',
      '她伸手接住了一片雪。', NULL, NULL, NULL, 'family',
      1704153600, 1704153600
    );
    INSERT INTO fact (
      id, memory_event_id, statement, status, confidence, created_at, updated_at
    ) VALUES (
      'fact-v013', 'event-old-v013', '照片拍摄于 2024-01-01。',
      'user_confirmed', 100, 1704153600, 1704153600
    );
    INSERT INTO capsule (
      id, family_id, title, unlock_type, unlock_value, status, sealed_at,
      opened_at, created_at, updated_at
    ) VALUES (
      'capsule-v013', 'family-v013', '写给十岁的你', 'date', '2030-01-02',
      'sealed', 1706745600, NULL, 1704153600, 1706745600
    );
    INSERT INTO capsule_event (
      id, capsule_id, memory_event_id, family_id, created_at
    ) VALUES (
      'capsule-event-v013', 'capsule-v013', 'event-old-v013',
      'family-v013', 1706745600
    );
    INSERT INTO capsule_asset (
      id, capsule_id, asset_id, family_id, created_at
    ) VALUES (
      'capsule-asset-v013', 'capsule-v013', 'asset-v013',
      'family-v013', 1706745600
    );
    INSERT INTO capsule_contribution (
      id, capsule_id, contribution_id, family_id, created_at
    ) VALUES (
      'capsule-contribution-v013', 'capsule-v013', 'contribution-v013',
      'family-v013', 1706745600
    );
    INSERT INTO memory_event_revision (
      id, family_id, memory_event_id, edited_by_user_id, snapshot_json,
      created_at
    ) VALUES (
      'revision-v013', 'family-v013', 'event-old-v013', 'user-v013',
      '{"title":"还没改名时的雪天"}', 1704153500
    );
    INSERT INTO audit_log (
      id, family_id, kind, actor_user_id, detail_json, created_at
    ) VALUES (
      'audit-v013', 'family-v013', 'export.created', 'user-v013',
      '{"fixture":true}', 1706745600
    );
    INSERT INTO rate_limit (id, key, count, last_request)
      VALUES ('rate-v013', 'fixture-key', 2, 1706745600000);
  `);
  sqlite.pragma("wal_checkpoint(TRUNCATE)");
} finally {
  sqlite.close();
}

const database = readFileSync(databasePath);
const result = {
  databaseSha256: createHash("sha256").update(database).digest("hex"),
  compressedBase64: gzipSync(database, { level: 9, mtime: 0 }).toString(
    "base64",
  ),
};
console.log(JSON.stringify(result, null, 2));
rmSync(workDir, { recursive: true, force: true });
