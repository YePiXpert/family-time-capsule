import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
const source = readFileSync(new URL("../src/sync/FamilyCard.tsx", import.meta.url), "utf8");
const buttons = [...source.matchAll(/<Button\s[\s\S]*?\/>/g)].map((match) => match[0]);
it("keeps automation IDs and only the family action in the signed-out card", () => {
  expect(source).toContain('testID="remote-card"');
  const signedOut = source.split(") : signedIn === false ? (")[1]!.split(") : !remote?.enabled")[0]!;
  expect(signedOut.match(/<Button\s/g)).toHaveLength(1);
  expect(signedOut).toContain('title="去加入家庭"');
  expect(signedOut).toContain('nav.navigate("Family")');
});
it("never shows or accepts a recovery code: joining and leaving live on the family page", () => {
  for (const forbidden of ["RecoveryCode", "查看恢复码", "remote-join", "remote-disable", "leaveFamily(", "newMasterKey", "forgetKey("])
    expect(source).not.toContain(forbidden);
  expect(buttons.find((b) => b.includes('testID={status.manifests > 0 ? "remote-resume" : "remote-enable"}'))).toContain("onPress={share}");
});
it("routes sync through the family engine, with admin-only family deletion", () => {
  for (const forbidden of ["从远端恢复", "remote-restore", "保留远端，只关闭", 'text: "只撤下这台手机"', 'title="只撤下这台手机"', "开启远端备份", "runRemoteBackup", ".wipe(", ".getManifest(", ".deleteManifest("])
    expect(source).not.toContain(forbidden);
  for (const required of ["startSharing(", "runFamilySync(", ".wipeFamily(", "{isOwner && ("])
    expect(source).toContain(required);
});
