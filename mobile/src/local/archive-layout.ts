/**
 * 开放归档的版面：把一座 Library 变成一列「路径 + 内容」的条目，纯函数，不碰磁盘。
 *
 * 目标读者是多年后没有这个 App 的人：每条记录一个文件夹，正文是 Markdown，
 * 素材按原样复制并起人能读的名字；相册、系列、寄语、信、人物各一份 Markdown；
 * 另附整库 JSON 与一个离线网页（index.html + library.js）。
 */
import { APP_NAME, CHILD_FALLBACK } from "./brand";
import { toDayKey } from "./dates";
import {
  recordTitle,
  sortedRecords,
  type Library,
  type LocalLetter,
  type LocalMedia,
  type MediaKind,
  type Stored,
} from "./model";

export type ArchiveEntry =
  | { kind: "text"; path: string; text: string }
  | { kind: "media"; path: string; mediaId: string; bytes: number };

export type ArchiveOptions = {
  /** 四位年份；缺省为全部。 */
  year?: string;
  /** 默认不带还没拆的信：归档里的信是明文。 */
  includeSealedLetters?: boolean;
  /** 离线网页的 HTML；缺省则不放 index.html。 */
  viewerHtml?: string;
  now?: Date;
};

export type ArchiveMedia = {
  id: string;
  /** 相对归档根目录的路径，index.html 直接按它引用。 */
  path: string;
  kind: MediaKind;
  name: string;
  bytes: number;
};
export type ArchiveRecord = {
  id: string;
  date: string;
  day: string;
  title: string;
  text: string;
  location: string;
  first: boolean;
  quote: boolean;
  persons: string[];
  folder: string;
  media: ArchiveMedia[];
};
export type ArchiveLetter = {
  id: string;
  title: string;
  from: string;
  openAt: string;
  writtenAt: string;
  openedAt?: string;
  sealed: boolean;
  text: string;
  folder: string;
  media: ArchiveMedia[];
};
/** library.json / library.js 的形状：给离线网页与将来的任何程序读。 */
export type ArchiveLibrary = {
  format: "anan-open-archive";
  version: 1;
  app: string;
  createdAt: string;
  year: string | null;
  child: { name: string; birthday: string; avatar?: string };
  records: ArchiveRecord[];
  albums: { id: string; name: string; note: string; recordIds: string[] }[];
  series: {
    id: string;
    name: string;
    items: { month: string; recordId: string; path: string }[];
  }[];
  yearNotes: Record<string, string>;
  letters: ArchiveLetter[];
  persons: { id: string; name: string; records: number }[];
};

export type ArchivePlan = {
  root: string;
  /** 文字在前、素材在后，顺序固定。 */
  entries: ArchiveEntry[];
  library: ArchiveLibrary;
  mediaBytes: number;
  mediaCount: number;
};

/** 文件名净化：去掉各系统不许的字符与控制字符，NFC，最多 60 个字，Windows 保留名加前缀。 */
export function safeName(raw: string, fallback = "未命名"): string {
  let name = raw
    .normalize("NFC")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  name = Array.from(name).slice(0, 60).join("").replace(/[. ]+$/g, "");
  if (!name) return fallback;
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name)) return `_${name}`;
  return name;
}

const KIND_LABEL: Record<MediaKind, string> = {
  image: "照片",
  video: "视频",
  audio: "录音",
  document: "文件",
};
const DEFAULT_EXT: Record<MediaKind, string> = {
  image: "jpg",
  video: "mp4",
  audio: "m4a",
  document: "bin",
};
const extensionOf = (m: Stored<LocalMedia>) =>
  m.file.match(/\.([a-z0-9]{1,8})$/i)?.[1]?.toLowerCase() ?? DEFAULT_EXT[m.kind];

/** 同一目录里重名就加 (2)、(3)；大小写不敏感，Windows 与 macOS 默认都不分。 */
class Namer {
  private used = new Set<string>();
  claim(name: string): string {
    let candidate = name,
      n = 2;
    while (this.used.has(candidate.toLowerCase()))
      candidate = `${name} (${n++})`;
    this.used.add(candidate.toLowerCase());
    return candidate;
  }
}

/** Markdown 链接目标里有空格与中文，用尖括号包起来最省事，主流渲染器都认。 */
const link = (label: string, target: string) => `[${label}](<${target}>)`;
const yearOf = (iso: string) => String(new Date(iso).getFullYear());

export function archiveRootName(state: Library, now = new Date()): string {
  const child = safeName(state.profile.name.trim() || CHILD_FALLBACK);
  return `${child}成长记归档-${toDayKey(now).replace(/-/g, "")}`;
}

function frontMatter(pairs: [string, string | undefined][]): string {
  const lines = pairs
    .filter((p): p is [string, string] => !!p[1])
    .map(([k, v]) => `${k}: ${v.replace(/\s*\n\s*/g, " ")}`);
  return `---\n${lines.join("\n")}\n---\n`;
}

/** 一条记录（或一封信）附带的素材：复制到它自己的文件夹，按种类编号。 */
function placeMedia(
  state: Library,
  ids: readonly string[],
  folder: string,
): ArchiveMedia[] {
  const counters: Record<MediaKind, number> = {
    image: 0,
    video: 0,
    audio: 0,
    document: 0,
  };
  const placed: ArchiveMedia[] = [];
  for (const id of ids) {
    const m = state.media[id];
    if (!m) continue;
    const file = `${KIND_LABEL[m.kind]}${++counters[m.kind]}.${extensionOf(m)}`;
    placed.push({
      id: m.id,
      path: `${folder}/${file}`,
      kind: m.kind,
      name: m.name,
      bytes: m.bytes,
    });
  }
  return placed;
}

function mediaLinks(media: ArchiveMedia[], folder: string): string {
  return media
    .map((m) => {
      const file = m.path.slice(folder.length + 1);
      return m.kind === "image" ? `![${file}](<${file}>)` : link(file, file);
    })
    .join("\n");
}

const readme = (state: Library, year: string | null, now: Date) =>
  [
    `${state.profile.name.trim() || CHILD_FALLBACK}的成长记录 · 开放归档`,
    "",
    `这是从「${APP_NAME}」导出的普通文件${year ? `（只含 ${year} 年）` : ""}，不需要任何特定软件：`,
    "",
    "- 记录/ 里每一天一个文件夹：正文.md 是文字（任何文本编辑器都能打开），照片、视频、录音按原样保存。",
    "- 相册/、时光系列/、寄语/、信/ 与 人物.md 是各自的清单与文字。",
    "- index.html 用浏览器打开，可以按年月翻看全部记录、播放录音与视频；离线可用，不连网。",
    "- library.json 是整份资料的结构化数据，给程序读；library.js 是同一份数据，供 index.html 使用。",
    "",
    "「.xmb」备份文件是 App 自己的格式，用来恢复到 App 里；这份归档是给人看的，两者内容一致、用途不同。",
    "",
    `导出于 ${toDayKey(now)}。`,
    "",
  ].join("\n");

/** 规划整份归档；条目顺序固定（文字在前、素材在后），便于逐字比对与进度显示。 */
export function planArchive(
  state: Library,
  options: ArchiveOptions = {},
): ArchivePlan {
  const now = options.now ?? new Date();
  const root = archiveRootName(state, now);
  const year = options.year || null;
  const entries: ArchiveEntry[] = [];
  const text = (path: string, body: string) =>
    entries.push({ kind: "text", path: `${root}/${path}`, text: body });
  const folders = new Map<string, Namer>();
  const namerFor = (dir: string) => {
    let n = folders.get(dir);
    if (!n) folders.set(dir, (n = new Namer()));
    return n;
  };
  const personName = (id: string) => state.persons[id]?.name ?? "";
  const personCount = new Map<string, number>();

  const records = sortedRecords(state)
    .filter((r) => !year || yearOf(r.date) === year)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const included = new Set(records.map((r) => r.id));
  const archived: ArchiveRecord[] = records.map((r) => {
    const day = toDayKey(new Date(r.date));
    const dir = `记录/${day.slice(0, 4)}`;
    const folder = `${dir}/${namerFor(dir).claim(safeName(`${day} ${recordTitle(r)}`))}`;
    for (const id of r.personIds ?? [])
      if (personName(id)) personCount.set(id, (personCount.get(id) ?? 0) + 1);
    return {
      id: r.id,
      date: r.date,
      day,
      title: recordTitle(r),
      text: r.text,
      location: r.location,
      first: r.first,
      quote: (r as { quote?: boolean }).quote === true,
      persons: (r.personIds ?? []).map(personName).filter(Boolean),
      folder,
      media: placeMedia(state, r.mediaIds, folder),
    };
  });
  const byId = new Map(archived.map((r) => [r.id, r]));
  const recordPath = (id: string) => `${byId.get(id)!.folder}/正文.md`;

  for (const r of archived)
    text(
      `${r.folder}/正文.md`,
      [
        frontMatter([
          ["日期", r.day],
          ["标题", r.title],
          ["地点", r.location],
          ["人物", r.persons.join(", ")],
          ["第一次", r.first ? "是" : undefined],
          ["她说的话", r.quote ? "是" : undefined],
        ]),
        `# ${r.title}`,
        "",
        r.text.trim(),
        r.media.length ? `\n${mediaLinks(r.media, r.folder)}` : "",
        "",
      ].join("\n"),
    );

  const albums = Object.values(state.albums)
    .map((a) => ({
      id: a.id,
      name: a.name,
      note: a.note ?? "",
      recordIds: a.items.map((i) => i.recordId).filter((id) => included.has(id)),
    }))
    .filter((a) => a.recordIds.length)
    .sort((a, b) => a.name.localeCompare(b.name, "zh") || a.id.localeCompare(b.id));
  const albumNamer = new Namer();
  for (const a of albums) {
    const lines = [`# ${a.name}`, ""];
    if (a.note.trim()) lines.push(a.note.trim(), "");
    for (const id of a.recordIds) {
      const r = byId.get(id)!;
      lines.push(`- ${link(`${r.day} ${r.title}`, `../${recordPath(id)}`)}`);
    }
    text(`相册/${albumNamer.claim(safeName(a.name))}.md`, `${lines.join("\n")}\n`);
  }

  const series = Object.values(state.series)
    .map((t) => ({
      id: t.id,
      name: t.name,
      items: t.items
        .filter((i) => included.has(i.recordId))
        .sort((a, b) => a.month.localeCompare(b.month))
        .map((i) => ({
          month: i.month,
          recordId: i.recordId,
          path:
            byId.get(i.recordId)!.media.find((m) => m.id === i.mediaId)?.path ??
            recordPath(i.recordId),
        })),
    }))
    .filter((t) => t.items.length)
    .sort((a, b) => a.name.localeCompare(b.name, "zh") || a.id.localeCompare(b.id));
  const seriesNamer = new Namer();
  for (const t of series) {
    const lines = [`# ${t.name}`, ""];
    for (const i of t.items)
      lines.push(`- ${i.month} ${link(byId.get(i.recordId)!.title, `../${i.path}`)}`);
    text(`时光系列/${seriesNamer.claim(safeName(t.name))}.md`, `${lines.join("\n")}\n`);
  }

  const yearNotes: Record<string, string> = {};
  for (const [y, note] of Object.entries(state.yearNotes).sort())
    if (note.trim() && (!year || y === year)) yearNotes[y] = note;
  for (const [y, note] of Object.entries(yearNotes))
    text(`寄语/${y}.md`, `# ${y} 年的话\n\n${note.trim()}\n`);

  // 拆过的信总在；封存未拆的只在明确要求时带上；草稿从不归档。
  const letterKeep = (l: Stored<LocalLetter>) =>
    !!l.openedAt || (!!options.includeSealedLetters && l.sealed);
  const letters: ArchiveLetter[] = Object.values(state.letters)
    .filter((l) => letterKeep(l) && (!year || yearOf(l.writtenAt) === year))
    .sort((a, b) => a.writtenAt.localeCompare(b.writtenAt) || a.id.localeCompare(b.id))
    .map((l) => {
      const day = toDayKey(new Date(l.writtenAt));
      const folder = `信/${namerFor("信").claim(
        safeName(`${day} ${l.from.trim()} ${l.title.trim() || "一封信"}`),
      )}`;
      return {
        id: l.id,
        title: l.title,
        from: l.from,
        openAt: l.openAt,
        writtenAt: l.writtenAt,
        ...(l.openedAt ? { openedAt: l.openedAt } : {}),
        sealed: l.sealed,
        text: l.text,
        folder,
        media: placeMedia(state, l.mediaIds, folder),
      };
    });
  for (const l of letters)
    text(
      `${l.folder}/信.md`,
      [
        frontMatter([
          ["写于", toDayKey(new Date(l.writtenAt))],
          ["落款", l.from],
          ["拆封日", l.openAt],
          ["拆封于", l.openedAt ? toDayKey(new Date(l.openedAt)) : undefined],
          ["状态", l.openedAt ? "已拆封" : "还没拆封"],
        ]),
        `# ${l.title || "一封信"}`,
        "",
        l.text.trim(),
        l.from.trim() ? `\n—— ${l.from.trim()}` : "",
        l.media.length ? `\n${mediaLinks(l.media, l.folder)}` : "",
        "",
      ].join("\n"),
    );

  const persons = [...personCount]
    .map(([id, count]) => ({ id, name: personName(id), records: count }))
    .sort((a, b) => b.records - a.records || a.name.localeCompare(b.name, "zh"));
  if (persons.length)
    text(
      "人物.md",
      `# 人物\n\n${persons.map((p) => `- ${p.name}：${p.records} 条记录`).join("\n")}\n`,
    );

  const avatar = state.profile.avatarId
    ? state.media[state.profile.avatarId]
    : undefined;
  const child: ArchiveLibrary["child"] = {
    name: state.profile.name,
    birthday: state.profile.birthday,
    ...(avatar ? { avatar: `头像.${extensionOf(avatar)}` } : {}),
  };
  const library: ArchiveLibrary = {
    format: "anan-open-archive",
    version: 1,
    app: APP_NAME,
    createdAt: now.toISOString(),
    year,
    child,
    records: archived,
    albums,
    series,
    yearNotes,
    letters,
    persons,
  };
  text("README.txt", readme(state, year, now));
  if (options.viewerHtml) text("index.html", options.viewerHtml);
  const json = JSON.stringify(library, null, 1);
  text("library.json", `${json}\n`);
  text("library.js", `window.ANAN_LIBRARY = ${json};\n`);

  // 素材放在文字之后：小文件先写完，进度剩下的就全是素材。
  let mediaBytes = 0,
    mediaCount = 0;
  const media: ArchiveMedia[] = [
    ...(avatar
      ? [{ id: avatar.id, path: child.avatar!, kind: avatar.kind, name: avatar.name, bytes: avatar.bytes }]
      : []),
    ...archived.flatMap((r) => r.media),
    ...letters.flatMap((l) => l.media),
  ];
  for (const m of media) {
    entries.push({ kind: "media", path: `${root}/${m.path}`, mediaId: m.id, bytes: m.bytes });
    mediaBytes += m.bytes;
    mediaCount++;
  }
  return { root, entries, library, mediaBytes, mediaCount };
}
