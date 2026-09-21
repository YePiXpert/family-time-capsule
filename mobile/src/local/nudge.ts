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
export type BookNudge = { year: string };

/** 一二月里，去年有记录且还没装订过纪念册 → 提一句「可以装订了」。其余时候不打扰。 */
export function bookNudgeOf(
  today: Date,
  yearsWithRecords: readonly string[],
  boundYears: readonly string[],
): BookNudge | null {
  if (today.getMonth() > 1) return null;
  const year = String(today.getFullYear() - 1);
  if (!yearsWithRecords.includes(year) || boundYears.includes(year)) return null;
  return { year };
}

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

/** 书架同屏只放一张提醒卡：合并冲突 > 落款 > 里程碑 > 装订 > 备份 > 节奏（记录／草稿）。 */
export type NudgeKind =
  | "conflict"
  | "by"
  | "milestone"
  | "book"
  | "backup"
  | "rhythm";
export const NUDGE_ORDER: readonly NudgeKind[] = [
  "conflict",
  "by",
  "milestone",
  "book",
  "backup",
  "rhythm",
];

/**
 * 关掉一张卡后它沉默多久：里程碑与节奏当天、备份 7 天、装订本季（装订只在一二月提，
 * 关一次等于今年不再提）、落款卡关一次永远不再问；冲突卡不靠关闭时间——它随冲突留底
 * 一起消失（「知道了」清掉留底）。关闭时间读不出来当没关过。
 */
export function nudgeClosed(
  kind: NudgeKind,
  closedAt: string | undefined,
  today = new Date(),
): boolean {
  if (kind === "conflict") return false;
  if (!closedAt || !Number.isFinite(Date.parse(closedAt))) return false;
  if (kind === "by") return true;
  const at = new Date(closedAt);
  if (kind === "book")
    return (
      at.getFullYear() === today.getFullYear() &&
      Math.floor(at.getMonth() / 3) === Math.floor(today.getMonth() / 3)
    );
  const days = daysSince(closedAt, today);
  return days < (kind === "backup" ? 7 : 1);
}

/** 候选里优先级最高且没被关掉的一张；都关了就不打扰。 */
export function pickNudge(
  candidates: readonly NudgeKind[],
  closed: Readonly<Record<string, string>> | undefined,
  today = new Date(),
): NudgeKind | null {
  for (const kind of NUDGE_ORDER)
    if (candidates.includes(kind) && !nudgeClosed(kind, closed?.[kind], today))
      return kind;
  return null;
}
