import type { SyncStatus } from "./context";
import { dateTimeLabel } from "./dates";

/**
 * 「设置」里家庭与同步一行的副题：本机有没有家庭令牌加上同步状态，只用一套说法，不联网。
 * undefined 表示令牌还没读出来，副题先空着。
 */
export function familyLine(
  signedIn: boolean | undefined,
  sync: SyncStatus,
): string | undefined {
  if (signedIn === undefined) return undefined;
  if (!signedIn) return "还没加入家庭";
  if (sync.conflicts > 0) return `有 ${sync.conflicts} 段两台手机都改过`;
  if (sync.running) return "正在同步…";
  if (sync.lastError) return "上次同步没成功，点开看看";
  if (!sync.joined) return "已加入，还没完成第一次同步";
  return sync.lastSyncAt ? `上次同步 ${dateTimeLabel(sync.lastSyncAt)}` : "已加入";
}

/** 数据与备份一行的副题：上次完整备份与本机照片录音占用。 */
export function backupLine(exportedDays: number | null, bytes: number): string {
  const last =
    exportedDays === null
      ? "还没保存过完整备份"
      : exportedDays === 0
        ? "今天保存过完整备份"
        : `上次完整备份 ${exportedDays} 天前`;
  return `${last} · 本机 ${(bytes / 1048576).toFixed(1)}\u00a0MB`;
}
