import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("labels both family-join entrances with their actual action and the remote-join testID", () => {
  const source = readFileSync(
    new URL("../src/sync/RemoteBackupCard.tsx", import.meta.url),
    "utf8",
  );
  // 只核对入口文案与自动化标识，两个入口仍然前往原有的 join 页面。
  const buttons = [...source.matchAll(/<Button\s[\s\S]*?\/>/g)]
    .map((match) => match[0])
    .filter((button) =>
      button.includes('nav.navigate("RecoveryCode", { mode: "join" })'),
    );
  expect(buttons).toHaveLength(2);
  for (const button of buttons) {
    expect(button).toContain('title="加入家人一起写"');
    expect(button).toContain('testID="remote-join"');
  }
  expect(source).not.toContain("从远端恢复");
  expect(source).not.toContain('testID="remote-restore"');
});

it("A-16 撤下本机与主人清空全家的入口分别说明范围和恢复码", () => {
  const source = readFileSync(new URL("../src/sync/RemoteBackupCard.tsx", import.meta.url), "utf8");
  expect(source).toContain('text: "只撤下这台手机"');
  expect(source).toContain(".deleteManifest(");
  expect(source).not.toContain(".wipe(");
  expect(source).not.toContain(".getManifest(");
  expect(source).toContain(".wipeFamily(");
  expect(source).toContain("{isOwner && (");
  expect(source).toContain('title="删掉全家的远端备份"');
  expect(source).toContain("忘掉恢复码");
});
