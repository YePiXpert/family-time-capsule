/**
 * 性能基准用的合成资料库：确定性（种子随机），能通过 validateLibrary。
 * 形状按真实使用估：每段时光平均约 1.5 份素材（照片为主，少量视频/录音/文件），
 * 6 位家人，每 250 段一本相册（每本 50 段），少量时光系列，每 500 段一封信，
 * 3 份草稿，5% 的记录删过（墓碑），约 30% 的记录改过（带世系），5% 的长文（2000–4000 字）。
 * 日期横跨 2 年（1k）/ 5 年（10k）/ 10 年（50k），三成日期是照片拍摄的本地时间（不带 Z）。
 */
import { lineage } from "../../src/local/hash";
import {
  emptyLibrary,
  type Library,
  type LocalAlbum,
  type LocalLetter,
  type LocalMedia,
  type LocalRecord,
  type LocalSeries,
  type MediaKind,
  type RecordDraft,
} from "../../src/local/model";

export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SENTENCES = [
  "今天她第一次自己扶着沙发站了起来，晃了两下又坐回去，笑得特别开心。",
  "早上去公园看鸽子，她追着跑了好远，回来的路上在车里睡着了。",
  "外婆做了南瓜粥，她吃了小半碗，剩下的全抹在了脸上。",
  "晚上洗澡的时候一直拍水，溅了爸爸一身，还咯咯地笑。",
  "第一次说出了「妈妈」，声音很小，可是我们都听见了。",
  "下午下了一场雨，她趴在窗边看了很久，说雨在跳舞。",
  "幼儿园老师说她今天主动把玩具分给了新来的小朋友。",
  "睡前要听三遍同一个故事，少一遍都不行，讲到最后她自己先睡着了。",
  "In the park she said \"bird\" for the first time and pointed at every pigeon.",
];
const PLACES = ["上海市徐汇区", "杭州西湖", "外婆家", "", "", "北京市朝阳区", "31.2304, 121.4737"];
const TITLES = ["", "", "第一次站起来", "公园", "南瓜粥", "雨天", "", "洗澡", "睡前故事", "新朋友"];
const BYS = ["爸爸", "妈妈", "外婆", "奶奶", undefined];

export const hex64 = (n: number, salt = 0) =>
  (n.toString(16).padStart(12, "0") + salt.toString(16).padStart(4, "0")).padEnd(64, "a").slice(0, 64);
export const pad = (prefix: string, i: number) => `${prefix}${i.toString().padStart(6, "0")}`;

function text(r: () => number): string {
  const long = r() < 0.05;
  const target = long ? 2000 + Math.floor(r() * 2000) : 50 + Math.floor(r() * 350);
  let out = "";
  while (out.length < target) {
    out += SENTENCES[Math.floor(r() * SENTENCES.length)]!;
    if (r() < 0.15) out += "\n\n";
  }
  return out.slice(0, target);
}

export type FixtureOptions = {
  /** 素材 / 记录 的平均比例，默认约 1.5。 */
  mediaPerRecord?: number;
  seed?: number;
};

/** span 天数：1k → 2 年，10k → 5 年，50k → 10 年。 */
export const spanDays = (n: number) => (n <= 1000 ? 730 : n <= 10000 ? 1825 : 3650);
export const START = Date.UTC(2017, 0, 1);

export function makeLibrary(n: number, options: FixtureOptions = {}): Library {
  const r = rng(options.seed ?? n);
  const s = emptyLibrary();
  s.welcome = true;
  s.revision = n;
  s.profile = { name: "桉桉", fullName: "李清洛", motto: "入淮清洛渐漫漫", birthday: "2017-01-01", avatarId: null };
  s.settings = { theme: "auto", largeText: false, by: "妈妈", lockEnabled: false };
  const persons = 6;
  for (let i = 0; i < persons; i++) s.persons[`p${i}`] = { id: `p${i}`, name: ["爸爸", "妈妈", "外婆", "外公", "奶奶", "表哥"][i]! };
  const span = spanDays(n);
  let mediaIndex = 0;
  const addMedia = (kind: MediaKind, day: number): string => {
    const id = pad("m", mediaIndex);
    const ext = kind === "image" ? "jpg" : kind === "video" ? "mp4" : kind === "audio" ? "m4a" : "pdf";
    const at = new Date(START + day * 86400000 + Math.floor(r() * 86400000));
    const m: LocalMedia = {
      id,
      file: `${id}.${ext}`,
      name: `IMG_${mediaIndex}.${ext}`,
      kind,
      bytes: kind === "video" ? 30_000_000 + mediaIndex : kind === "image" ? 2_400_000 + mediaIndex : 400_000 + mediaIndex,
      sha256: hex64(mediaIndex),
      ...(kind === "image" || kind === "video" ? { thumb: `${id}_t.jpg` } : {}),
      ...(kind === "image"
        ? {
            width: 4032,
            height: 3024,
            photoMetadata: {
              capturedAt: at.toISOString().slice(0, 19),
              latitude: 31.2304 + (mediaIndex % 100) / 10000,
              longitude: 121.4737 + (mediaIndex % 100) / 10000,
            },
          }
        : {}),
    };
    s.media[id] = m;
    mediaIndex++;
    return id;
  };
  const ratio = options.mediaPerRecord ?? 1.5;
  for (let i = 0; i < n; i++) {
    const id = pad("r", i);
    const day = Math.floor((i / n) * span);
    const at = new Date(START + day * 86400000 + Math.floor(r() * 86400000));
    // 三成日期来自照片拍摄时间：本地时间、不带 Z。
    const date = r() < 0.3 ? at.toISOString().slice(0, 19) : at.toISOString();
    const mediaIds: string[] = [];
    const roll = r();
    const photos = roll < 0.3 ? 0 : roll < 0.6 ? 1 : roll < 0.8 ? 2 : Math.max(1, Math.round(ratio * 2.5));
    for (let k = 0; k < photos; k++) mediaIds.push(addMedia("image", day));
    if (r() < 0.08) mediaIds.push(addMedia("video", day));
    if (r() < 0.05) mediaIds.push(addMedia("audio", day));
    if (r() < 0.01) mediaIds.push(addMedia("document", day));
    const by = BYS[Math.floor(r() * BYS.length)];
    const personIds = r() < 0.5 ? [...new Set([`p${Math.floor(r() * persons)}`, `p${Math.floor(r() * persons)}`])] : undefined;
    const record: LocalRecord = {
      id,
      title: TITLES[Math.floor(r() * TITLES.length)]!,
      text: text(r),
      date,
      location: PLACES[Math.floor(r() * PLACES.length)]!,
      first: r() < 0.02,
      ...(r() < 0.05 ? { quote: true } : {}),
      mediaIds,
      coverId: mediaIds.length ? mediaIds[0]! : null,
      ...(personIds ? { personIds } : {}),
      ...(by ? { by } : {}),
      revision: 1,
      updatedAt: at.toISOString(),
    };
    if (r() < 0.3) {
      const previous: LocalRecord = { ...record, text: `${record.text}旧` };
      record.ancestors = lineage(previous);
      record.revision = 2;
    }
    s.records[id] = record;
  }
  const recordIds = Object.keys(s.records);
  const imageOf = (rid: string) => s.records[rid]!.mediaIds.find((m) => s.media[m]!.kind === "image");
  const albums = Math.max(2, Math.floor(n / 250));
  for (let a = 0; a < albums; a++) {
    const items: LocalAlbum["items"] = [];
    const used = new Set<string>();
    while (items.length < 50 && used.size < recordIds.length) {
      const rid = recordIds[Math.floor(r() * recordIds.length)]!;
      if (used.has(rid)) continue;
      used.add(rid);
      items.push({ id: `a${a}-i${items.length}`, recordId: rid });
    }
    const coverRecord = items.find((i) => imageOf(i.recordId));
    s.albums[`a${a}`] = {
      id: `a${a}`,
      name: `相册 ${a}`,
      items,
      coverId: coverRecord ? imageOf(coverRecord.recordId)! : null,
      updatedAt: new Date(START + a * 86400000).toISOString(),
      ...(a % 3 === 0 ? { note: "这一本给你长大以后看。" } : {}),
    };
  }
  // 两个时光系列，每月一张。
  for (let t = 0; t < 2; t++) {
    const items: LocalSeries["items"] = [];
    const months = new Set<string>(), seenRecords = new Set<string>(), seenMedia = new Set<string>();
    for (const rid of recordIds) {
      const mid = imageOf(rid);
      if (!mid || seenRecords.has(rid) || seenMedia.has(mid)) continue;
      const month = new Date(s.records[rid]!.date).toISOString().slice(0, 7);
      if (months.has(month) || r() < 0.5) continue;
      months.add(month);
      seenRecords.add(rid);
      seenMedia.add(mid);
      items.push({ recordId: rid, mediaId: mid, month });
    }
    s.series[`t${t}`] = { id: `t${t}`, name: `系列 ${t}`, items, updatedAt: new Date(START).toISOString() };
  }
  const letters = Math.max(5, Math.floor(n / 500));
  for (let l = 0; l < letters; l++) {
    const written = new Date(START + Math.floor(r() * span) * 86400000).toISOString();
    const mediaIds = r() < 0.4 ? [addMedia("audio", 0)] : [];
    const letter: LocalLetter = {
      id: pad("l", l),
      title: `给十八岁的你 ${l}`,
      text: text(r).slice(0, 4900),
      from: ["爸爸", "妈妈"][l % 2]!,
      openAt: "2035-01-01",
      writtenAt: written,
      sealed: l % 2 === 0,
      ...(l % 5 === 0 ? { openedAt: written } : {}),
      mediaIds,
      coverId: null,
      updatedAt: written,
    };
    s.letters[letter.id] = letter;
  }
  for (let d = 0; d < 3; d++) {
    const draft: RecordDraft = {
      id: `d${d}`,
      recordId: d === 0 ? recordIds[recordIds.length - 1]! : null,
      baseRevision: d === 0 ? s.records[recordIds[recordIds.length - 1]!]!.revision : 0,
      content: {
        title: "",
        text: text(r),
        date: new Date(START + span * 86400000).toISOString(),
        location: "",
        first: false,
        mediaIds: [],
        coverId: null,
        by: "妈妈",
      },
      updatedAt: new Date(START + span * 86400000).toISOString(),
    };
    s.drafts[draft.id] = draft;
  }
  s.tombstones = {};
  for (let i = 0; i < Math.floor(n / 20); i++)
    s.tombstones[`records:${pad("x", i)}`] = new Date(START + i * 3600000).toISOString();
  const years = Math.ceil(span / 365);
  for (let y = 0; y < years; y++) {
    const year = String(2017 + y);
    s.yearNotes[year] = `${year} 年，你学会了很多事。`.repeat(10);
  }
  // 一年的目录：每月挑一两段。
  const firstYear = "2017";
  const months: NonNullable<Library["yearPicks"]>[string]["months"] = {};
  for (const rid of recordIds) {
    const d = new Date(s.records[rid]!.date);
    if (String(d.getFullYear()) !== firstYear) continue;
    const key = `${firstYear}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    if (months[key]) continue;
    months[key] = { recordIds: [rid] };
  }
  s.yearPicks = { [firstYear]: { title: "第一年的书", months, updatedAt: new Date(START).toISOString() } };
  const avatar = Object.values(s.media).find((m) => m.kind === "image");
  s.profile.avatarId = avatar?.id ?? null;
  s.lastExportAt = new Date(START + span * 86400000).toISOString();
  return s;
}

/** 深拷贝：模拟从磁盘/网络刚解析出来、尚未冻结的库。 */
export const fresh = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/**
 * 另一台手机的清单：先深拷贝，再改 fraction 比例的记录（正文加一句、updatedAt 更新、世系指向本机版）。
 * 这是「对方改了、本机没动」的正常拉取路径。
 */
export function remoteOf(local: Library, fraction: number, seed: number, device = "phone-b"): Library {
  const remote = fresh(local);
  remote.drafts = {};
  const r = rng(seed);
  const ids = Object.keys(remote.records);
  const count = Math.round(ids.length * fraction);
  const later = new Date(START + 4000 * 86400000).toISOString();
  for (let i = 0; i < count; i++) {
    const id = ids[Math.floor(r() * ids.length)]!;
    const before = remote.records[id]!;
    remote.records[id] = {
      ...before,
      text: `${before.text}（${device} 补了一句）`,
      updatedAt: later,
      ancestors: lineage(local.records[id]!),
    };
  }
  return remote;
}

export const sizes = (): number[] =>
  (process.env.PERF_SIZES ?? "1000,10000,50000").split(",").map(Number).filter((x: number) => x > 0);

/** 挑一个记录最多的年份（Year / 年册 / 回顾都按年）。 */
export function busiestYear(s: Library): string {
  const counts = new Map<string, number>();
  for (const r of Object.values(s.records)) {
    const y = String(new Date(r.date).getFullYear());
    counts.set(y, (counts.get(y) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0]![0];
}
