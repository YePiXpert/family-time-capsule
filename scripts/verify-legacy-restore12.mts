import { readFileSync, copyFileSync } from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
async function main() {
  const dir = process.env.FTC_FIXTURE_OUTPUT;
  if (!dir || !process.env.DATA_DIR)
    throw Error("isolated fixture paths required");
  const expected = JSON.parse(
      readFileSync(path.join(dir, "expected.json"), "utf8"),
    ),
    { performSetup } = await import("../lib/auth/setup"),
    { getDb, closeDatabase } = await import("../db/index"),
    { user } = await import("../db/schema/auth"),
    { restoreFromZipFile } = await import("../lib/restore/service");
  await performSetup({
    token: process.env.INITIAL_SETUP_TOKEN!,
    displayName: "虚构新安装管理员",
    email: "restore12@example.test",
    password: "fictional-restore12-password",
  });
  const admin = getDb().select().from(user).get()!;
  const restored = await restoreFromZipFile(
    path.join(dir, "legacy11.zip"),
    admin.id,
  );
  assert.equal(restored.events, 5);
  assert.equal(restored.assets, 5);
  const zip = await (
    await import("../lib/export/service")
  ).buildFamilyExport(expected.familyId);
  copyFileSync(zip.filePath, path.join(dir, "restored12.zip"));
  closeDatabase();
  console.log(
    JSON.stringify({ restore: restored.events, assets: restored.assets }),
  );
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
