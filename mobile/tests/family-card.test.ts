import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
const source = readFileSync(new URL("../src/sync/FamilyCard.tsx", import.meta.url), "utf8");
const buttons = [...source.matchAll(/<Button\s[\s\S]*?\/>/g)].map((match) => match[0]);
it("keeps automation IDs and only the login action in the signed-out card", () => {
  expect(source).toContain('testID="remote-card"');
  const signedOut = source.split(") : signedIn === false ? (")[1]!.split(") : !remote?.enabled")[0]!;
  expect(signedOut.match(/<Button\s/g)).toHaveLength(1);
  expect(signedOut).toContain('title="去登录"');
  expect(signedOut).toContain('kind="text"');
});
it("offers join, start or resume with the specified navigation", () => {
  expect(buttons.find((b) => b.includes('testID="remote-join"'))).toContain('nav.navigate("RecoveryCode", { mode: "join" })');
  expect(buttons.find((b) => b.includes('testID="remote-enable"'))).toContain('title="开始一起写"');
  expect(buttons.find((b) => b.includes('testID="remote-resume"'))).toContain('title="继续一起写"');
});
it("routes sync and exit through the family engine, with owner-only family deletion", () => {
  for (const forbidden of ["从远端恢复", "remote-restore", "保留远端，只关闭", 'text: "只撤下这台手机"', 'title="只撤下这台手机"', "开启远端备份", "runRemoteBackup", ".wipe(", ".getManifest(", ".deleteManifest("])
    expect(source).not.toContain(forbidden);
  // 退出确认说明按规格仍写「远端只撤下这台手机发布的那一份」，不能把这句误判为旧动作。
  for (const required of ["leaveFamily(", "runFamilySync(", ".wipeFamily(", "{isOwner && ("])
    expect(source).toContain(required);
});
