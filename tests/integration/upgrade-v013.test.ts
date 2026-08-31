import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import Database from "better-sqlite3";
import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

const V013_LAST_MIGRATION = 1_788_106_357_031;
const ORIGINAL_ASSET_SHA =
  "721a062f6f73db9df973f46b4d803375bdebd733e8dc66903763e1a17d4a96df";
const ORIGINAL_STORAGE_KEY = "originals/v0/13/asset-v013.png";

const dataDir = mkdtempSync(path.join(tmpdir(), "ftc-upgrade-v013-"));
const databasePath = path.join(dataDir, "db", "capsule.sqlite");
mkdirSync(path.dirname(databasePath), { recursive: true });

// The generator creates a real SQLite 0.1.3 archive through migrations
// 0000-0010 and refuses to run if any normalized historical migration hash or
// timestamp changes. Keeping generation out of the test process also proves
// startup against a closed, independently-created database file.
const fixtureGenerator = path.join(
  process.cwd(),
  "tests",
  "fixtures",
  "v0.1.3",
  "generate-fixture.mjs",
);
const fixture = JSON.parse(
  execFileSync(process.execPath, [fixtureGenerator], {
    cwd: process.cwd(),
    encoding: "utf8",
    windowsHide: true,
  }),
) as { databaseSha256: string; compressedBase64: string };
const fixtureDatabase = gunzipSync(
  Buffer.from(fixture.compressedBase64, "base64"),
);
expect(createHash("sha256").update(fixtureDatabase).digest("hex")).toBe(
  fixture.databaseSha256,
);
writeFileSync(databasePath, fixtureDatabase);

const originalPath = path.join(dataDir, ...ORIGINAL_STORAGE_KEY.split("/"));
mkdirSync(path.dirname(originalPath), { recursive: true });
copyFileSync(
  path.join(process.cwd(), "tests", "fixtures", "sample.png"),
  originalPath,
);

const beforeUpgrade = new Database(databasePath, {
  readonly: true,
  fileMustExist: true,
});
try {
  expect(beforeUpgrade.pragma("integrity_check", { simple: true })).toBe("ok");
  expect(
    beforeUpgrade
      .prepare(
        'SELECT created_at FROM "__drizzle_migrations" ORDER BY created_at DESC LIMIT 1',
      )
      .pluck()
      .get(),
  ).toBe(V013_LAST_MIGRATION);
  expect(
    beforeUpgrade
      .prepare("PRAGMA table_info(inbox_item)")
      .all()
      .some((column) =>
        (column as { name: string }).name === "memory_event_id",
      ),
  ).toBe(false);
} finally {
  beforeUpgrade.close();
}

process.env.DATA_DIR = dataDir;
process.env.AUTH_SECRET = "upgrade-v013-test-secret";

const { closeDatabase, getDb } = await import("@/db");
const { getMemoryEventDetail, getTimelinePage } = await import(
  "@/lib/memories/service"
);
const { buildFamilyExport } = await import("@/lib/export/service");
const JSZip = (await import("jszip")).default;
const db = getDb();

afterAll(() => {
  closeDatabase();
  rmSync(dataDir, { recursive: true, force: true });
});

describe("real v0.1.3 (0010) archive upgrade", () => {
  it("upgrades through HEAD while preserving core rows, hashes, relations, timeline, and export", async () => {
    expect((await db.all(sql`PRAGMA integrity_check`))[0]).toEqual({
      integrity_check: "ok",
    });
    expect(await db.all(sql`PRAGMA foreign_key_check`)).toEqual([]);

    const journal = JSON.parse(
      readFileSync(
        path.join(process.cwd(), "db", "migrations", "meta", "_journal.json"),
        "utf8",
      ),
    ) as { entries: Array<{ when: number }> };
    const headMigration = journal.entries.at(-1)!.when;
    const ledger = (await db.all(
      sql.raw(
        'SELECT created_at FROM "__drizzle_migrations" ORDER BY created_at',
      ),
    )) as Array<{ created_at: number }>;
    expect(ledger.at(-1)!.created_at).toBe(headMigration);
    expect(ledger).toHaveLength(journal.entries.length);

    const snapshotDirectory = path.join(
      dataDir,
      "backups",
      "pre-migration",
    );
    const snapshots = readdirSync(snapshotDirectory);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatch(/^capsule\.pre-migration\..+\.sqlite$/);
    const snapshot = new Database(
      path.join(snapshotDirectory, snapshots[0]!),
      { readonly: true, fileMustExist: true },
    );
    try {
      expect(snapshot.pragma("integrity_check", { simple: true })).toBe("ok");
      expect(
        snapshot
          .prepare(
            'SELECT created_at FROM "__drizzle_migrations" ORDER BY created_at DESC LIMIT 1',
          )
          .pluck()
          .get(),
      ).toBe(V013_LAST_MIGRATION);
      expect(
        snapshot
          .prepare("SELECT sha256 FROM asset WHERE id = 'asset-v013'")
          .pluck()
          .get(),
      ).toBe(ORIGINAL_ASSET_SHA);
      expect(
        snapshot
          .prepare("PRAGMA table_info(inbox_item)")
          .all()
          .some((column) =>
            (column as { name: string }).name === "memory_event_id",
          ),
      ).toBe(false);
    } finally {
      snapshot.close();
    }

    const counts = Object.fromEntries(
      await Promise.all(
        [
          "family",
          "person",
          "asset",
          "inbox_item",
          "memory_event",
          "memory_event_asset",
          "memory_event_participant",
          "contribution",
          "fact",
          "capsule",
          "capsule_event",
        ].map(async (table) => {
          const rows = (await db.all(
            sql.raw(`SELECT count(*) AS count FROM "${table}"`),
          )) as Array<{ count: number }>;
          return [table, rows[0]!.count] as const;
        }),
      ),
    );
    expect(counts).toMatchObject({
      family: 1,
      person: 2,
      asset: 1,
      inbox_item: 2,
      memory_event: 2,
      memory_event_asset: 1,
      memory_event_participant: 3,
      contribution: 1,
      fact: 1,
      capsule: 1,
      capsule_event: 1,
    });

    const userBinding = (await db.all(
      sql`SELECT family_id, person_id FROM user WHERE id = 'user-v013'`,
    )) as Array<{ family_id: string; person_id: string }>;
    expect(userBinding[0]).toEqual({
      family_id: "family-v013",
      person_id: "parent-v013",
    });
    const userIndexes = (await db.all(
      sql.raw("PRAGMA index_list('user')"),
    )) as Array<{ name: string; unique: number; partial: number }>;
    expect(
      userIndexes.find((candidate) => candidate.name === "user_person_uidx"),
    ).toMatchObject({ unique: 1, partial: 1 });
    const userPersonIndexSql = (await db.all(
      sql`SELECT sql
            FROM sqlite_schema
           WHERE type = 'index'
             AND name = 'user_person_uidx'`,
    )) as Array<{ sql: string }>;
    expect(userPersonIndexSql[0]!.sql).toMatch(
      /WHERE\s+"user"\."person_id"\s+is\s+not\s+null$/i,
    );
    let duplicatePersonBindingError: unknown;
    try {
      await db.run(sql`
        INSERT INTO user (
          id, name, email, email_verified, role, family_id, person_id,
          created_at, updated_at
        ) VALUES (
          'duplicate-person-user-v013', '不得创建的重复账号',
          'duplicate-person-v013@example.com', 0, 'viewer', 'family-v013',
          'parent-v013', 0, 0
        )
      `);
    } catch (error) {
      duplicatePersonBindingError = error;
    }
    expect(duplicatePersonBindingError).toMatchObject({
      cause: { code: "SQLITE_CONSTRAINT_UNIQUE" },
    });
    const upgradedInbox = (await db.all(
      sql`SELECT id, raw_text, memory_event_id FROM inbox_item ORDER BY id`,
    )) as Array<{
      id: string;
      raw_text: string | null;
      memory_event_id: string | null;
    }>;
    expect(upgradedInbox).toEqual([
      {
        id: "inbox-media-v013",
        raw_text: null,
        memory_event_id: null,
      },
      {
        id: "inbox-text-v013",
        raw_text: "这是 0.1.3 中尚未整理的完整文字。",
        memory_event_id: null,
      },
    ]);

    const assetRow = (await db.all(
      sql`SELECT sha256, captured_at, imported_at, storage_key FROM asset WHERE id = 'asset-v013'`,
    )) as Array<{
      sha256: string;
      captured_at: number;
      imported_at: number;
      storage_key: string;
    }>;
    expect(assetRow[0]).toMatchObject({
      sha256: ORIGINAL_ASSET_SHA,
      storage_key: ORIGINAL_STORAGE_KEY,
    });
    expect(assetRow[0]!.captured_at).not.toBe(assetRow[0]!.imported_at);
    expect(
      createHash("sha256").update(readFileSync(originalPath)).digest("hex"),
    ).toBe(assetRow[0]!.sha256);

    const assetIndexes = (await db.all(
      sql.raw("PRAGMA index_list('asset')"),
    )) as Array<{ name: string; unique: number; partial: number }>;
    expect(
      assetIndexes.find((candidate) => candidate.name === "asset_family_sha_idx"),
    ).toMatchObject({ unique: 1, partial: 1 });
    const assetIndexSql = (await db.all(
      sql`SELECT sql
            FROM sqlite_schema
           WHERE type = 'index'
             AND name = 'asset_family_sha_idx'`,
    )) as Array<{ sql: string }>;
    expect(assetIndexSql[0]!.sql).toMatch(
      /WHERE\s+"asset"\."original_asset_id"\s+is\s+null$/i,
    );

    let duplicateOriginalError: unknown;
    try {
      await db.run(sql`
        INSERT INTO asset (
          id, family_id, type, original_filename, mime_type, bytes, sha256,
          storage_key, captured_at, imported_at, time_source, width, height,
          duration_ms, metadata_json, created_by_user_id, original_asset_id,
          derivative_type, created_at
        )
        SELECT
          'asset-v013-duplicate-probe', family_id, type,
          '不得写入的重复原件.png', mime_type, bytes, sha256,
          'originals/v0/13/duplicate-probe.png', captured_at, imported_at,
          time_source, width, height, duration_ms, metadata_json,
          created_by_user_id, NULL, NULL, created_at
        FROM asset
        WHERE id = 'asset-v013'
      `);
    } catch (error) {
      duplicateOriginalError = error;
    }
    expect(duplicateOriginalError).toMatchObject({
      cause: { code: "SQLITE_CONSTRAINT_UNIQUE" },
    });
    expect(
      (await db.all(
        sql`SELECT count(*) AS count
              FROM asset
             WHERE family_id = 'family-v013'
               AND sha256 = ${ORIGINAL_ASSET_SHA}
               AND original_asset_id IS NULL`,
      ))[0],
    ).toEqual({ count: 1 });

    const detail = await getMemoryEventDetail(
      "family-v013",
      "event-old-v013",
    );
    expect(detail?.event.title).toBe("第一次看雪");
    expect(detail?.assets.map((asset) => asset.id)).toEqual(["asset-v013"]);
    expect(detail?.participants.map((person) => person.displayName).sort()).toEqual(
      ["妈妈", "小星"],
    );

    const timeline = (await getTimelinePage("family-v013")).entries;
    expect(timeline.map((entry) => entry.event.id)).toEqual([
      "event-new-v013",
      "event-old-v013",
    ]);
    expect(timeline[1]).toMatchObject({
      coverAssetId: "asset-v013",
      assetCount: 1,
    });
    expect(timeline[1]!.participantNames.sort()).toEqual(["妈妈", "小星"]);

    const exported = await buildFamilyExport("family-v013", {
      actorUserId: "user-v013",
    });
    expect(exported.assetCount).toBe(1);
    const zip = await JSZip.loadAsync(readFileSync(exported.filePath));
    const root = "family-time-capsule-export";
    const manifest = JSON.parse(
      await zip.file(`${root}/manifest.json`)!.async("string"),
    ) as {
      familyId: string;
      assets: Array<{ assetId: string; relativePath: string; sha256: string }>;
    };
    const memories = JSON.parse(
      await zip.file(`${root}/memories.json`)!.async("string"),
    ) as Array<{
      id: string;
      assetIds: string[];
      participantPersonIds: string[];
    }>;
    const contributions = JSON.parse(
      await zip.file(`${root}/contributions.json`)!.async("string"),
    ) as Array<{ id: string; memoryEventId: string }>;
    const facts = JSON.parse(
      await zip.file(`${root}/facts.json`)!.async("string"),
    ) as Array<{ id: string; memoryEventId: string }>;
    const capsules = JSON.parse(
      await zip.file(`${root}/capsules.json`)!.async("string"),
    ) as Array<{ id: string; memoryEventIds: string[]; assetIds: string[] }>;
    const inboxItems = JSON.parse(
      await zip.file(`${root}/inbox-items.json`)!.async("string"),
    ) as Array<{ id: string; rawText: string | null }>;
    const timelineMarkdown = await zip
      .file(`${root}/timeline.md`)!
      .async("string");

    expect(manifest.familyId).toBe("family-v013");
    expect(manifest.assets).toEqual([
      expect.objectContaining({
        assetId: "asset-v013",
        sha256: ORIGINAL_ASSET_SHA,
      }),
    ]);
    const exportedOriginal = await zip
      .file(`${root}/${manifest.assets[0]!.relativePath}`)!
      .async("nodebuffer");
    expect(createHash("sha256").update(exportedOriginal).digest("hex")).toBe(
      ORIGINAL_ASSET_SHA,
    );
    expect(memories.find((event) => event.id === "event-old-v013")).toEqual(
      expect.objectContaining({
        assetIds: ["asset-v013"],
        participantPersonIds: ["child-v013", "parent-v013"],
      }),
    );
    expect(contributions).toContainEqual(
      expect.objectContaining({
        id: "contribution-v013",
        memoryEventId: "event-old-v013",
      }),
    );
    expect(facts).toContainEqual(
      expect.objectContaining({
        id: "fact-v013",
        memoryEventId: "event-old-v013",
      }),
    );
    expect(capsules).toContainEqual(
      expect.objectContaining({
        id: "capsule-v013",
        memoryEventIds: ["event-old-v013"],
        assetIds: ["asset-v013"],
      }),
    );
    expect(inboxItems).toContainEqual(
      expect.objectContaining({
        id: "inbox-text-v013",
        rawText: "这是 0.1.3 中尚未整理的完整文字。",
      }),
    );
    expect(timelineMarkdown).toContain("第一次看雪");
    expect(timelineMarkdown).toContain("春节团圆饭");
  }, 20_000);
});
