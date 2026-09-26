/** 时间胶囊信的纯函数：状态判定、默认拆封日、标签与排序。界面不在这里。 */
import { nthBirthday, toDayKey } from "./dates";
import { contentHashOf, lineage } from "./hash";
import { clone, type Library, type LocalLetter, type Stored } from "./model";

export type LetterState = "draft" | "sealed" | "openable" | "opened";

/** 默认封存到 18 岁生日。 */
export const DEFAULT_OPEN_AGE = 18;

/** 草稿还没封；封了没到日子是 sealed；到了日子还没拆是 openable；拆过就是 opened。 */
export function letterState(
  letter: Pick<Stored<LocalLetter>, "sealed" | "openAt" | "openedAt">,
  today = new Date(),
): LetterState {
  if (!letter.sealed) return "draft";
  if (letter.openedAt) return "opened";
  return letter.openAt <= toDayKey(today) ? "openable" : "sealed";
}

/** 有生日就是 18 岁生日；没填生日就从今天往后数 18 年。 */
export function defaultOpenAt(birthday: string, today = new Date()): string {
  return (
    nthBirthday(birthday, DEFAULT_OPEN_AGE) ??
    toDayKey(
      new Date(
        today.getFullYear() + DEFAULT_OPEN_AGE,
        today.getMonth(),
        today.getDate(),
      ),
    )
  );
}

/** "2039-03-01" → 「2039年3月1日」；不合法的原样返回。 */
export function openAtLabel(openAt: string): string {
  const m = openAt.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return openAt;
  return `${m[1]}年${Number(m[2])}月${Number(m[3])}日`;
}

/** 书架封面下那一行：草稿／封存至某日·落款／可以拆了／已拆封。 */
export function letterCaption(
  letter: Stored<LocalLetter>,
  today = new Date(),
): string {
  const by = letter.from.trim() ? ` · ${letter.from.trim()}` : "";
  switch (letterState(letter, today)) {
    case "draft":
      return "还没封存的草稿";
    case "sealed":
      return `封存至 ${openAtLabel(letter.openAt)}${by}`;
    case "openable":
      return `可以拆了${by}`;
    case "opened":
      return `已拆封${by}`;
  }
}

/**
 * 书架小封面下那一行：一格只有 76 宽，放不下「封存至 2042年6月15日 · 妈妈」，只留状态与拆封年份。
 * 读屏仍念完整的 `letterCaption`。
 */
export function letterShortCaption(
  letter: Pick<Stored<LocalLetter>, "sealed" | "openAt" | "openedAt">,
  today = new Date(),
): string {
  switch (letterState(letter, today)) {
    case "draft":
      return "还没封存";
    case "sealed":
      return `封存至 ${letter.openAt.slice(0, 4)}`;
    case "openable":
      return "可以拆了";
    case "opened":
      return "已拆封";
  }
}

/** 草稿在前，然后未拆的按拆封日近到远，拆过的按拆封时间新到旧。 */
export function sortLetters(
  letters: Stored<LocalLetter>[],
  today = new Date(),
): Stored<LocalLetter>[] {
  const rank: Record<LetterState, number> = {
    draft: 0,
    openable: 1,
    sealed: 2,
    opened: 3,
  };
  return [...letters].sort((a, b) => {
    const sa = letterState(a, today),
      sb = letterState(b, today);
    if (sa !== sb) return rank[sa] - rank[sb];
    if (sa === "opened")
      return (b.openedAt ?? "").localeCompare(a.openedAt ?? "");
    return a.openAt.localeCompare(b.openAt) || a.id.localeCompare(b.id);
  });
}

export const PAST_OPEN_AT = "拆封的日子已经到了，换一个以后的日子再封存。";
/** 封存：正文不能是空的；拆封日要在封存那天之后；标题与落款去掉首尾空白。封存后 updateLetter 会拒绝改动。 */
export function sealLetterAt(
  letter: Stored<LocalLetter>,
  at: string,
): Stored<LocalLetter> {
  if (letter.sealed) throw new Error("这封信已经封存了。");
  if (!letter.text.trim()) throw new Error("信还是空的，先写点什么。");
  // 日期选择只挡得住新选的日子：草稿放久了，原先选的拆封日可能已经过了。
  if (letter.openAt <= toDayKey(new Date(at)))
    throw new Error(PAST_OPEN_AT);
  return {
    ...letter,
    title: letter.title.trim(),
    from: letter.from.trim(),
    sealed: true,
    writtenAt: at,
    updatedAt: at,
  };
}
/** 拆封：只对封存的信有效；已拆的原样返回，不改拆封时间。 */
export function openLetterAt(
  letter: Stored<LocalLetter>,
  at: string,
): Stored<LocalLetter> {
  if (!letter.sealed) throw new Error("信还没封存。");
  if (letter.openedAt) return letter;
  return { ...letter, openedAt: at, updatedAt: at };
}

/**
 * 写信页落盘：整封替换，返回库里的这一封。base 是编辑页这一份的来源版本（打开时的、上次写下的或并进来的）。
 * 世系记 base 而不是库里现在那封：同步在编辑途中并进了别人的一版时，这次写入与它并发，
 * 对方手机据此把自己那版留成冲突卡，不会被悄悄盖掉。
 * 这封信编辑途中在别的手机被删或封存了：这边没写新字就什么都不存（返回 null）；写了就另存成一封新信，一个字不丢。
 */
export function writeLetter(
  s: Library,
  letter: Stored<LocalLetter>,
  base: Stored<LocalLetter>,
  freshId: () => string,
): Stored<LocalLetter> | null {
  const existing = s.letters[letter.id];
  if (!existing || existing.sealed) {
    if (contentHashOf(letter) === contentHashOf(base)) return null;
    const { ancestors: _, ...rest } = clone(letter);
    const rescued = { ...rest, id: freshId(), sealed: false as const };
    s.letters[rescued.id] = rescued;
    return rescued;
  }
  const next = { ...clone(letter), ancestors: lineage(base) };
  s.letters[letter.id] = next;
  return next;
}
