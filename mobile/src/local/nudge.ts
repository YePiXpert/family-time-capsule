/** 记录节奏的温和提示：纯日历差，无推送无弹窗，会话内可关。 */

export type Nudge =
  | { kind: "draft" }
  | { kind: "days"; days: number };

const dayStart = (d: Date) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

export function daysSince(iso: string, today = new Date()): number {
  return Math.round((dayStart(today) - dayStart(new Date(iso))) / 86400000);
}

/**
 * 草稿优先：有草稿且最近 3 天没动过 → 提醒接着写（新鲜草稿交给既有草稿入口）；
 * 否则有过记录且距上次记录 ≥3 天 → 提醒有 N 天没记。其余不打扰。
 */
export function nudgeOf(
  lastRecordAt: string | null,
  lastDraftEditAt: string | null,
  draftsCount: number,
  today = new Date(),
): Nudge | null {
  if (draftsCount > 0) {
    if (!lastDraftEditAt) return { kind: "draft" };
    return daysSince(lastDraftEditAt, today) >= 3
      ? { kind: "draft" }
      : null;
  }
  if (!lastRecordAt) return null;
  const days = daysSince(lastRecordAt, today);
  return days >= 3 ? { kind: "days", days } : null;
}
