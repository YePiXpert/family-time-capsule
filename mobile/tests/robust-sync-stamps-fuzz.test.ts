/**
 * 家人同步的随机测试：3–4 台手机随机改名字、格言、头像、年度寄语与封面、人物、记录，改来改去（自然有改回），
 * 随机同步（也有几台同时同步）、随机恢复备份（含升级前没有时刻的旧备份），时钟各有快慢（±3 小时）。
 * 有的配置里最后一台先在家外面自己填资料，中途用新钥匙加入（头一轮可能读了清单就断掉）：它头一轮不能盖掉家里已有的值。
 * 最后大家轮流同步：必须安静下来（谁也不再拉、不再发布）；全是新版手机时必须完全一致。
 * 家里还有 1.1.6 手机时，新版手机之间也必须一致；全家不一致的比例与全是 1.1.6 的家庭对照（FUZZ_LOG）。
 * 默认每种配置跑 FUZZ_N=30 次（几秒）；FUZZ_N=500 跑大规模，FUZZ_LOG=文件 记下统计。
 */
import { appendFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { deletePerson, type Library } from "../src/local/model";
import {
  abort,
  begin,
  copy,
  edit,
  end,
  nowOf,
  join,
  phone,
  photo,
  record,
  recordView,
  renamePerson,
  resetClock,
  restore,
  rootView,
  seedLib,
  setAvatar,
  setCover,
  setMotto,
  setName,
  setNote,
  sync,
  tick,
  unstamped,
  type Phone,
  type Server,
} from "./helpers/family-phones";
import { lineage } from "../src/local/hash";

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0), s / 2 ** 32);
}
const NAMES = ["桉桉", "安安", "清洛"];
const PERSONS = ["奶奶", "外婆", "姥姥"];
const TEXTS = ["原文", "改一", "改二"];
const MOTTOS = [undefined, "入淮清洛渐漫漫", "一句话"];
const AVATARS = [null, "m1", "m2"];
const NOTES = ["", "第一年", "第一年，会走了"];
const COVERS = ["m1", "m2", "m1"];
const H = 3600_000;
const KINDS = ["name", "motto", "avatar", "note", "cover", "person", "addPerson", "dropPerson", "text", "first"];

/** joins：最后一台先在家外面自己填资料（加入前的设置），中途用新钥匙加入；头一轮同步可能读了清单就断掉。 */
type Opts = { phones: number; steps: number; old: boolean[]; offsets: number[]; restores: boolean; kinds?: string[]; joins?: boolean };
type Action =
  | { t: "edit"; p: number; k: string; v: number }
  | { t: "sync" | "begin" | "end" | "abort"; p: number }
  | { t: "restore"; p: number; snap: number; bare: boolean };

function script(seed: number, o: Opts): Action[] {
  const r = rng(seed);
  const out: Action[] = [];
  for (let i = 0; i < o.steps; i++) {
    const p = Math.floor(r() * o.phones);
    const x = r();
    if (x < 0.4) out.push({ t: "edit", p, k: (o.kinds ?? KINDS)[Math.floor(r() * (o.kinds ?? KINDS).length)]!, v: Math.floor(r() * 3) });
    else if (x < 0.75) out.push({ t: "sync", p });
    else if (x < 0.85) out.push({ t: "begin", p });
    else if (o.joins && x < 0.88) out.push({ t: "abort", p });
    else if (x < 0.95 || !o.restores) out.push({ t: "end", p });
    else out.push({ t: "restore", p, snap: Math.floor(r() * 1000), bare: r() < 0.5 });
  }
  return out;
}
let made = 0;
function applyEdit(p: Phone, k: string, v: number) {
  const lib = p.lib;
  if (k === "name") setName(p, NAMES[v]!);
  else if (k === "motto") setMotto(p, MOTTOS[v]);
  else if (k === "avatar") setAvatar(p, AVATARS[v]!);
  else if (k === "note") setNote(p, "2026", NOTES[v]!);
  else if (k === "cover") setCover(p, "2026", COVERS[v]!);
  else if (k === "person") {
    const id = Object.keys(lib.persons).sort()[0];
    if (id) renamePerson(p, id, PERSONS[v]!);
  } else if (k === "addPerson") {
    // createPerson：同名的已有就复用，没有才新建。
    if (!Object.values(lib.persons).some((x) => x.name === PERSONS[v]))
      edit(p, (l) => { const id = `q${++made}`; l.persons[id] = { id, name: PERSONS[v]! }; });
  } else if (k === "dropPerson") {
    const id = Object.keys(lib.persons).sort()[v % Math.max(1, Object.keys(lib.persons).length)];
    if (id)
      edit(p, (l) => {
        deletePerson(l, id, nowOf(p));
        if (p.old) l.tombstones = { ...l.tombstones, [`persons:${id}`]: nowOf(p) };
      });
  } else if (k === "text" || k === "first") {
    const x = lib.records.x;
    if (!x) return;
    if (k === "text" ? x.text === TEXTS[v] : x.first === (v === 1)) return;
    edit(p, (l) => {
      l.records.x = {
        ...copy(x),
        ...(k === "text" ? { text: TEXTS[v]! } : { first: v === 1 }),
        updatedAt: nowOf(p),
        ancestors: lineage(x),
        revision: x.revision + 1,
      };
    });
  }
}

function run(seed: number, o: Opts) {
  resetClock();
  made = 0;
  const lib = seedLib((s) => {
    s.media.m1 = photo("m1", "a");
    s.media.m2 = photo("m2", "b");
    s.records.x = { ...record("x", "原文"), mediaIds: ["m1", "m2"], coverId: "m1" };
    s.profile = { ...s.profile, name: "桉桉", avatarId: "m1", motto: "入淮清洛渐漫漫" };
    s.yearNotes["2026"] = "第一年";
    s.persons.p = { id: "p", name: "奶奶" };
  });
  const server: Server = {};
  const ps = Array.from({ length: o.phones }, (_, i) =>
    phone(String.fromCharCode(65 + i), lib, o.old[i % o.old.length], o.offsets[i % o.offsets.length]),
  );
  // 加入的那台：装好应用、还没加入，库里只有自己的两张照片。
  const outsider = o.joins ? ps[ps.length - 1]! : undefined;
  if (outsider) {
    outsider.old = false;
    outsider.lib = seedLib((s) => {
      s.media.m1 = photo("m1", "a");
      s.media.m2 = photo("m2", "b");
    });
    outsider.history = [copy(outsider.lib)];
  }
  const inside = (p: Phone) => p !== outsider || joined;
  let joined = false;
  for (let i = 0; i < 2; i++) for (const p of ps) if (inside(p)) sync(p, server);
  const actions = script(seed, o);
  const joinAt = Math.floor(rng(seed * 7 + 1)() * actions.length * 0.6);
  actions.forEach((a, step) => {
    if (outsider && step === joinAt) {
      // 加入前在设置里又填了名字和今年的寄语：时刻比家里的都新。
      tick(60_000);
      applyEdit(outsider, "name", seed % 3);
      applyEdit(outsider, "note", 1 + (seed % 2));
      join(outsider);
      joined = true;
    }
    const p = ps[a.p]!;
    tick(60_000);
    if (a.t !== "edit" && !inside(p)) return;
    if (a.t === "edit") applyEdit(p, a.k, a.v);
    else if (a.t === "abort") abort(p);
    else if (a.t === "sync") { if (!p.pending) sync(p, server); }
    else if (a.t === "begin") { if (!p.pending) begin(p, server); }
    else if (a.t === "end") { if (p.pending) end(p, server); }
    else if (a.t === "restore" && !p.pending && !p.joining) {
      const snap = p.history[a.snap % p.history.length]!;
      restore(p, a.bare && !p.old ? unstamped(snap) : snap);
    }
  });
  if (outsider && !joined) join(outsider);
  for (const p of ps) if (p.pending) end(p, server);
  let quiet = 0;
  for (let round = 0; round < 20; round++) {
    let busy = false;
    for (const p of ps) {
      const r = sync(p, server);
      if (r.pulled || r.published) busy = true;
    }
    if (!busy && ++quiet >= 2) {
      const same = (view: (lib: Library) => string) => new Set(ps.map((p) => view(p.lib))).size === 1;
      const fresh = ps.filter((p) => !p.old);
      return {
        joinViolations: ps.reduce((n, p) => n + (p.joinViolations ?? 0), 0),
        quiet: true,
        same: same(rootView),
        records: same(recordView),
        newSame: new Set(fresh.map((p) => rootView(p.lib))).size <= 1,
      };
    }
    if (busy) quiet = 0;
  }
  return { joinViolations: ps.reduce((n, p) => n + (p.joinViolations ?? 0), 0), quiet: false, same: false, records: false, newSame: false };
}

const N = Number(process.env.FUZZ_N ?? 30);
const skew = [0, -3 * H, 3 * H, -5 * 60_000];
const configs: Record<string, Opts> = {
  "全是新版，三台，时钟准": { phones: 3, steps: 50, old: [false], offsets: [0], restores: false },
  "全是新版，四台，时钟 ±3 小时": { phones: 4, steps: 70, old: [false], offsets: skew, restores: false },
  "全是新版，三台，时钟不准，恢复备份": { phones: 3, steps: 60, old: [false], offsets: skew, restores: true },
  "全是新版，四台，时钟不准，恢复备份": { phones: 4, steps: 80, old: [false], offsets: skew, restores: true },
  "新旧混合，三台（一台 1.1.6），恢复备份": { phones: 3, steps: 60, old: [false, false, true], offsets: [0, 60_000, -60_000], restores: true },
  "新旧混合，四台，时钟不准": { phones: 4, steps: 70, old: [false, true], offsets: skew, restores: false },
  "新旧混合，四台，时钟不准，恢复备份": { phones: 4, steps: 80, old: [false, true], offsets: skew, restores: true },
  "全是新版，四台，一台带着自己的资料加入": { phones: 4, steps: 70, old: [false], offsets: skew, restores: false, joins: true },
  "全是新版，四台，一台带着自己的资料加入，恢复备份": { phones: 4, steps: 80, old: [false], offsets: skew, restores: true, joins: true },
  "新旧混合，四台，一台新版带着自己的资料加入": { phones: 4, steps: 70, old: [false, true, true, false], offsets: skew, restores: true, joins: true },
  "全是 1.1.6，三台，恢复备份": { phones: 3, steps: 60, old: [true], offsets: [0, 60_000, -60_000], restores: true },
  "全是 1.1.6，四台，时钟不准": { phones: 4, steps: 70, old: [true], offsets: skew, restores: false },
  "全是 1.1.6，四台，时钟不准，恢复备份": { phones: 4, steps: 80, old: [true], offsets: skew, restores: true },
};
describe("家人同步随机测试", () => {
  for (const [label, o] of Object.entries(configs))
    it(label, () => {
      // same：根值与人物全家一致；newSame：新版手机之间一致；records：记录也一致（记录走世系合并，不在这次改动里，只记下）。
      const s = { runs: N, quiet: 0, same: 0, records: 0, newSame: 0, joinViolations: 0, bad: [] as number[] };
      for (let seed = 1; seed <= N; seed++) {
        const r = run(seed, o);
        if (r.quiet) s.quiet++;
        if (r.same) s.same++;
        if (r.records) s.records++;
        if (r.newSame) s.newSame++;
        s.joinViolations += r.joinViolations;
        if (!r.same && s.bad.length < 8) s.bad.push(seed);
      }
      if (process.env.FUZZ_LOG) appendFileSync(process.env.FUZZ_LOG, `${JSON.stringify({ label, ...s })}\n`);
      // 谁都会停下来。
      expect(s.quiet).toBe(N);
      // 全是新版：根值与人物完全一致。有 1.1.6 手机时，新版手机之间也完全一致
      // （1.1.6 手机跟不上根值改回，与全是 1.1.6 的家庭一样；两者的不一致比例见 FUZZ_LOG）。
      if (!o.old.some(Boolean)) expect(s.bad).toEqual([]);
      expect(s.newSame).toBe(N);
      // 带着自己资料加入的那台，头一轮不会盖掉家里已有的名字、格言、头像、封面。
      expect(s.joinViolations).toBe(0);
    }, 600_000);
});
