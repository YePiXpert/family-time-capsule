/** Run only inside an isolated v1.1 source export, to create authentic old-schema/old-export fixtures. */
import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
async function main() {
  const output = process.env.FTC_FIXTURE_OUTPUT;
  if (!output || !process.env.DATA_DIR)
    throw Error("isolated fixture paths required");
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(pkg.version, "1.1.0-alpha.1");
  const { getDb, closeDatabase } = await import("../db/index"),
    { performSetup } = await import("../lib/auth/setup"),
    { user } = await import("../db/schema/auth"),
    families = await import("../lib/family/service"),
    inbox = await import("../lib/inbox/service"),
    memories = await import("../lib/memories/service"),
    ingest = await import("../lib/assets/ingest"),
    sharp = (await import("sharp")).default;
  await performSetup({
    token: process.env.INITIAL_SETUP_TOKEN!,
    displayName: "虚构旧版管理员",
    email: "legacy11@example.test",
    password: "fictional-legacy11-password",
  });
  const admin = getDb().select().from(user).get()!;
  const on = await families.completeOnboarding(admin.id, {
    familyName: "虚构 1.1 迁移家庭",
    timezone: "America/New_York",
    childDisplayName: "小雨",
    childBirthDate: "2024-02-29",
    selfDisplayName: "爸爸",
    selfRelationToChild: "爸爸",
    selfIsGuardian: true,
  });
  assert(on.ok);
  const assets = [],
    events = [];
  for (let i = 0; i < 5; i++) {
    const original = await sharp({
      create: {
        width: 640,
        height: 480,
        channels: 3,
        background: { r: 170 + i * 10, g: 140, b: 100 },
      },
    })
      .jpeg()
      .toBuffer();
    const stored = await ingest.ingestImage({
      familyId: on.familyId,
      createdByUserId: admin.id,
      filename: `fictional-old-${i}.jpg`,
      declaredMime: "image/jpeg",
      buffer: original,
    });
    assert.equal(stored.status, "stored");
    if (stored.status !== "stored") throw Error("ingest");
    const item = await inbox.createInboxItemForAsset(on.familyId, stored.asset),
      entry = await inbox.getInboxEntry(on.familyId, item.id);
    assert(entry);
    const result = await memories.confirmInboxEntry(on.familyId, entry, {
      title: `虚构旧版第一周 ${i + 1}`,
      occurredAt: new Date(`2024-03-0${i + 1}T04:30:00Z`),
    });
    assert(result.ok);
    events.push(result.eventId);
    assets.push({
      id: stored.asset.id,
      sha256: stored.asset.sha256,
      storageKey: stored.asset.storageKey,
      bytes: stored.asset.bytes,
    });
  }
  const exported = await (
    await import("../lib/export/service")
  ).buildFamilyExport(on.familyId);
  mkdirSync(output, { recursive: true });
  const archive = path.join(output, "legacy11.zip");
  copyFileSync(exported.filePath, archive);
  closeDatabase();
  writeFileSync(
    path.join(output, "expected.json"),
    JSON.stringify(
      {
        version: pkg.version,
        familyId: on.familyId,
        adminId: admin.id,
        events,
        assets,
        archiveSha256: createHash("sha256")
          .update(readFileSync(archive))
          .digest("hex"),
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      version: pkg.version,
      events: events.length,
      assets: assets.length,
      archive,
    }),
  );
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
