import { expect, it } from "vitest";
import { idleSyncStatus } from "../src/local/context";
import { backupLine, familyLine } from "../src/local/settings-lines";

const sync = (patch: Partial<typeof idleSyncStatus>) => ({ ...idleSyncStatus, ...patch });

it("家庭与同步只用一套说法：没加入、已加入没同步、同步中、冲突、失败、上次时间", () => {
  expect(familyLine(undefined, sync({}))).toBeUndefined();
  expect(familyLine(false, sync({ joined: true, conflicts: 2 }))).toBe("还没加入家庭");
  expect(familyLine(true, sync({}))).toBe("已加入，还没完成第一次同步");
  // 第一次同步半路断网：已标成加入，但还没有一次完整同步，不能只说「已加入」。
  expect(familyLine(true, sync({ joined: true }))).toBe("已加入，还没完成第一次同步");
  expect(familyLine(true, sync({ joined: true, running: true }))).toBe("正在同步…");
  expect(familyLine(true, sync({ joined: true, conflicts: 2, running: true }))).toBe("有 2 段两台手机都改过");
  expect(familyLine(true, sync({ joined: true, lastError: "离线" }))).toBe("上次同步没成功，点开看看");
  expect(familyLine(true, sync({ joined: true, lastSyncAt: "2026-09-24T13:40:00.000Z" }))).toMatch(/^上次同步 /);
  for (const line of [familyLine(true, sync({})), familyLine(false, sync({}))])
    expect(line).not.toMatch(/一起写|家庭与设备/);
});
it("数据与备份一行带上次完整备份与本机占用", () => {
  expect(backupLine(null, 0)).toBe("还没保存过完整备份 · 本机 0.0\u00a0MB");
  expect(backupLine(0, 1048576 * 3)).toBe("今天保存过完整备份 · 本机 3.0\u00a0MB");
  expect(backupLine(12, 1048576 * 45.8)).toBe("上次完整备份 12 天前 · 本机 45.8\u00a0MB");
});
