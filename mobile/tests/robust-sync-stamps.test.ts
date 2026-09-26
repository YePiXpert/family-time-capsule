/**
 * 根值与人物带版本时刻（rootStamps、LocalPerson.updatedAt）：改回去的值也传得开，旧快照、旧备份传不开，
 * 几台手机怎么同步都安静下来。LocalStore.change 盖时刻；多台手机走 helpers/family-phones 的模拟
 * （真实的 mergeLibraries、只读变过的清单、没变不发布、各自的时钟）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalStore } from "../src/local/store";
import {
  deletePerson,
  emptyLibrary,
  stampChanges,
  diffLibrary,
  forkLibrary,
  validateLibrary,
  type Library,
} from "../src/local/model";
import { emptyBase, mergeLibraries } from "../src/sync/merge";
import {
  abort,
  begin,
  copy,
  edit,
  end,
  join,
  phone,
  photo,
  renamePerson,
  resetClock,
  restore,
  seedLib,
  setAvatar,
  setCover,
  setMotto,
  setName,
  setNote,
  settle,
  sync,
  tick,
  unstamped,
  type Phone,
  type Server,
} from "./helpers/family-phones";

const H = 3600_000;
const T1 = "2026-09-20T10:00:00.000Z",
  T3 = "2026-09-21T10:00:00.000Z";
function memoryStore(lib: Library = emptyLibrary()) {
  let disk: Library = copy(lib);
  return new LocalStore({ read: async () => copy(disk), write: async (next) => { disk = copy(next); } });
}
const at = (iso: string) => vi.setSystemTime(new Date(iso));

describe("LocalStore.change 给改动盖时刻", () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); });
  afterEach(() => { vi.useRealTimers(); });

  it("改名、清空格言、删掉一年的寄语都盖上时刻；改回原来的值是一次新改动", async () => {
    const store = memoryStore(seedLib((s) => { s.profile = { ...s.profile, name: "桉桉", motto: "入淮清洛渐漫漫" }; s.yearNotes["2026"] = "第一年"; }));
    await store.open();
    at("2026-09-20T10:00:00.000Z");
    await store.change((s) => { s.profile = { ...s.profile, name: "安安" }; });
    expect(store.get().rootStamps).toEqual({ "profile:name": "2026-09-20T10:00:00.000Z" });
    at("2026-09-20T11:00:00.000Z");
    await store.change((s) => {
      s.profile = { ...s.profile, name: "桉桉" };
      const { motto: _m, ...rest } = s.profile;
      s.profile = rest;
      delete s.yearNotes["2026"];
    });
    expect(store.get().rootStamps).toEqual({
      "profile:name": "2026-09-20T11:00:00.000Z",
      "profile:motto": "2026-09-20T11:00:00.000Z",
      "yearNotes:2026": "2026-09-20T11:00:00.000Z",
    });
  });

  it("没改共享的值（设置、草稿、原样保存资料）不动时刻，连对象都不换", async () => {
    const store = memoryStore(seedLib((s) => { s.profile = { ...s.profile, name: "桉桉" }; }));
    await store.open();
    at("2026-09-20T10:00:00.000Z");
    await store.change((s) => { s.profile = { ...s.profile, name: "安安" }; });
    const before = store.get();
    at("2026-09-20T12:00:00.000Z");
    await store.change((s) => { s.settings = { ...s.settings, largeText: true }; });
    await store.change((s) => { s.profile = { ...s.profile, name: "安安" }; });
    await store.change((s) => { s.persons.p = { id: "p", name: "奶奶" }; });
    const after = store.get();
    expect(after.rootStamps).toBe(before.rootStamps);
    expect(after.profile).toBe(before.profile);
    // 人物原样保存（换了对象、名字没变）不换时刻。
    const stamped = after.persons.p!.updatedAt;
    at("2026-09-20T13:00:00.000Z");
    await store.change((s) => { s.persons.p = { ...s.persons.p! }; });
    expect(store.get().persons.p!.updatedAt).toBe(stamped);
  });

  it("上一版来自时钟快的手机：新时刻至少晚它一毫秒", async () => {
    const store = memoryStore(seedLib((s) => {
      s.profile = { ...s.profile, name: "安安" };
      s.rootStamps = { "profile:name": "2026-09-20T13:00:00.000Z" };
      s.persons.p = { id: "p", name: "奶奶", updatedAt: "2026-09-20T13:00:00.000Z" };
    }));
    await store.open();
    at("2026-09-20T10:00:00.000Z");
    await store.change((s) => {
      s.profile = { ...s.profile, name: "桉桉" };
      s.persons.p = { ...s.persons.p!, name: "外婆" };
    });
    expect(store.get().rootStamps!["profile:name"]).toBe("2026-09-20T13:00:00.001Z");
    expect(store.get().persons.p!.updatedAt).toBe("2026-09-20T13:00:00.001Z");
  });

  it("新建、改名的人物盖上时刻；合并与恢复（versioned）自己写的时刻原样留下，不再盖", async () => {
    const store = memoryStore();
    await store.open();
    at("2026-09-20T10:00:00.000Z");
    await store.change((s) => { s.persons.p = { id: "p", name: "奶奶" }; });
    expect(store.get().persons.p!.updatedAt).toBe("2026-09-20T10:00:00.000Z");
    await store.change((s) => {
      s.profile = { ...s.profile, name: "桉桉" };
      s.rootStamps = { "profile:name": "2026-09-19T08:00:00.000Z" };
      s.persons.p = { id: "p", name: "外婆", updatedAt: "2026-09-19T08:00:00.000Z" };
    }, { versioned: true });
    expect(store.get().rootStamps).toEqual({ "profile:name": "2026-09-19T08:00:00.000Z" });
    expect(store.get().persons.p!.updatedAt).toBe("2026-09-19T08:00:00.000Z");
    // 恢复一份没有时刻的旧备份：值换了，也不盖——旧值比家里任何带时刻的都旧。
    await store.change((s) => {
      s.profile = { ...s.profile, name: "安安" };
      delete s.rootStamps;
      s.persons.p = { id: "p", name: "奶奶" };
    }, { versioned: true });
    expect(store.get().rootStamps).toBeUndefined();
    expect(store.get().persons.p!.updatedAt).toBeUndefined();
  });

  it("校验：时刻的键必须是带版本的根值，值必须是时刻；人物的 updatedAt 可缺省", () => {
    const ok = seedLib((s) => {
      s.rootStamps = { "profile:name": "2026-09-20T10:00:00.000Z", "yearNotes:2026": "2026-09-20T10:00:00.000Z", "yearCovers:2026": "2026-09-20T10:00:00.000Z" };
      s.persons.p = { id: "p", name: "奶奶", updatedAt: "2026-09-20T10:00:00.000Z" };
      s.persons.q = { id: "q", name: "外婆" };
    });
    expect(() => validateLibrary(copy(ok))).not.toThrow();
    for (const broken of [
      { "yearPicks:2026": "2026-09-20T10:00:00.000Z" },
      { "profile:settings": "2026-09-20T10:00:00.000Z" },
      { "yearNotes:26": "2026-09-20T10:00:00.000Z" },
      { "profile:name": "昨天" },
      { "profile:name": 1 },
    ]) expect(() => validateLibrary({ ...copy(ok), rootStamps: broken })).toThrow();
    const badPerson = copy(ok);
    (badPerson.persons.p as { updatedAt?: unknown }).updatedAt = "later";
    expect(() => validateLibrary(badPerson)).toThrow();
  });

  it("stampChanges 不碰选片、装订时刻这些自带时间的字段", () => {
    const prev = seedLib(() => {});
    const next = forkLibrary(prev);
    next.yearPicks = { "2026": { months: {}, updatedAt: "2026-09-20T10:00:00.000Z" } };
    next.yearBooksBoundAt = { "2026": "2026-09-20T10:00:00.000Z" };
    stampChanges(prev, next, diffLibrary(prev, next), "2026-09-20T10:00:00.000Z");
    expect(next.rootStamps).toBeUndefined();
  });
});

// ---- 几台手机 ----
beforeEach(resetClock);
function family(names: string[], fill: (s: Library) => void, opts: { old?: string[]; offsets?: Record<string, number> } = {}) {
  const lib = seedLib((s) => {
    s.media.m1 = photo("m1", "a");
    s.media.m2 = photo("m2", "b");
    fill(s);
  });
  const server: Server = {};
  const phones = names.map((n) => phone(n, lib, opts.old?.includes(n) ?? false, opts.offsets?.[n] ?? 0));
  settle(phones, server);
  return { server, phones };
}
const names = (ps: Phone[]) => ps.map((p) => p.lib.profile.name);

describe("改回去的值传得开", () => {
  const seed = (s: Library) => {
    s.profile = { ...s.profile, name: "桉桉", motto: "入淮清洛渐漫漫", avatarId: "m1" };
    s.yearNotes["2026"] = "第一年";
    s.yearCovers["2026"] = "m1";
    s.persons.p = { id: "p", name: "奶奶" };
  };
  const cases: [string, (p: Phone, v: 0 | 1) => void, (l: Library) => unknown][] = [
    ["名字", (p, v) => setName(p, ["桉桉", "清洛"][v]!), (l) => l.profile.name],
    ["格言（改回之前先清空）", (p, v) => setMotto(p, [ "入淮清洛渐漫漫", undefined][v]), (l) => l.profile.motto],
    ["头像（改回之前先清空）", (p, v) => setAvatar(p, ["m1", null][v]!), (l) => l.profile.avatarId],
    ["年度寄语", (p, v) => setNote(p, "2026", ["第一年", "第一年，会走了"][v]!), (l) => l.yearNotes["2026"]],
    ["年度封面", (p, v) => setCover(p, "2026", ["m1", "m2"][v]!), (l) => l.yearCovers["2026"]],
    ["人物名字", (p, v) => renamePerson(p, "p", ["奶奶", "外婆"][v]!), (l) => l.persons.p!.name],
  ];
  for (const [label, change, read] of cases)
    it(`${label}：B 改了、全家跟上，B 又改回：三台都改回去，之后安静`, () => {
      const { server, phones } = family(["A", "B", "C"], seed);
      const [, b] = phones as [Phone, Phone, Phone];
      const original = read(b.lib);
      change(b, 1);
      expect(settle(phones, server)).toBeGreaterThanOrEqual(0);
      expect(phones.map((p) => read(p.lib))).toEqual(phones.map(() => read(b.lib)));
      expect(read(b.lib)).not.toEqual(original);
      change(b, 0);
      expect(settle(phones, server)).toBeGreaterThanOrEqual(0);
      expect(phones.map((p) => read(p.lib))).toEqual([original, original, original]);
    });

  it("B 改名、同步，没等下一轮又改回：A、C 读到过改名的清单，也跟着改回，之后谁都不再发布", () => {
    const { server, phones } = family(["A", "B", "C"], seed);
    const [a, b, c] = phones as [Phone, Phone, Phone];
    setName(b, "清洛");
    sync(b, server);
    sync(a, server);
    setName(b, "桉桉");
    const rounds = settle([a, b, c], server);
    expect(rounds).toBeGreaterThanOrEqual(0);
    expect(names(phones)).toEqual(["桉桉", "桉桉", "桉桉"]);
    for (const p of phones) expect(sync(p, server)).toMatchObject({ pulled: 0, published: false });
  });

  it("丢了的手机的旧清单（改名之前那一版）不会把名字、人物带回去，恢复后也不会", () => {
    const { server, phones } = family(["A", "B", "丢了的手机"], seed);
    const [a, b, lost] = phones as [Phone, Phone, Phone];
    setName(a, "清洛");
    renamePerson(a, "p", "外婆");
    settle([a, b], server);
    expect(lost.lib.profile.name).toBe("桉桉");
    // 基忘了（恢复、清过同步状态）：全靠时刻判断。
    for (const base of [b.base, emptyBase()]) {
      const r = mergeLibraries(b.lib, [{ deviceId: "丢了的手机", deviceName: "丢了的手机", createdAt: "2026-09-21T00:00:00.000Z", library: copy(server["丢了的手机"]!.library) }], base, "2026-09-21T00:00:00.000Z");
      expect({ name: r.next.profile.name, person: r.next.persons.p!.name, pulled: r.pulled }).toEqual({ name: "清洛", person: "外婆", pulled: 0 });
    }
  });
});

describe("恢复备份", () => {
  const seed = (s: Library) => {
    s.profile = { ...s.profile, name: "桉桉", motto: "入淮清洛渐漫漫", avatarId: "m1" };
    s.yearNotes["2026"] = "第一年";
    s.persons.p = { id: "p", name: "奶奶" };
  };
  for (const bare of [true, false])
    it(`恢复一份${bare ? "升级前（没有时刻）" : "较早（时刻较旧）"}的备份：旧名字、旧人物、旧寄语不传给家人，这台跟上家里`, () => {
      const { server, phones } = family(["A", "B", "C"], seed);
      const [a, b, c] = phones as [Phone, Phone, Phone];
      setName(a, "清洛"); // 让 A 有一份带时刻的旧值
      settle(phones, server);
      const backup = copy(c.lib);
      setName(a, "安安");
      renamePerson(a, "p", "外婆");
      setNote(a, "2026", "第一年，会走了");
      settle(phones, server);
      restore(c, bare ? unstamped(backup) : backup);
      expect(settle(phones, server)).toBeGreaterThanOrEqual(0);
      for (const p of [a, b, c])
        expect({ name: p.lib.profile.name, person: p.lib.persons.p!.name, note: p.lib.yearNotes["2026"] }).toEqual({ name: "安安", person: "外婆", note: "第一年，会走了" });
    });
  for (const bare of [true, false])
    it(`家里清空了格言和头像，这台恢复${bare ? "升级前" : "较早"}的备份：清空的照样清空，旧格言、旧头像不回来`, () => {
      const { server, phones } = family(["A", "B", "C"], seed);
      const [a, b, c] = phones as [Phone, Phone, Phone];
      const backup = copy(c.lib);
      setMotto(a, undefined);
      setAvatar(b, null);
      settle(phones, server);
      restore(c, bare ? unstamped(backup) : backup);
      expect(c.lib.profile.motto).toBe("入淮清洛渐漫漫");
      expect(settle(phones, server)).toBeGreaterThanOrEqual(0);
      for (const p of [a, b, c]) expect({ motto: p.lib.profile.motto, avatar: p.lib.profile.avatarId }).toEqual({ motto: undefined, avatar: null });
    });
  it("忘了合并历史（空基）、本机没改过：直接听家里更新的版本，不需要另外的「新加入」规则", () => {
    const { server, phones } = family(["A", "B"], seed);
    const [a, b] = phones as [Phone, Phone];
    setName(a, "清洛");
    setMotto(a, undefined);
    settle(phones, server);
    setName(a, "安安");
    sync(a, server);
    // B 忘了合并历史，库还是上一轮的。
    b.base = emptyBase();
    b.seen = {};
    expect(settle(phones, server)).toBeGreaterThanOrEqual(0);
    expect(names(phones)).toEqual(["安安", "安安"]);
    expect(b.lib.profile.motto).toBeUndefined();
  });
});

describe("最新的清单不一定是最新的值（不看清单时刻，只看值的时刻）", () => {
  const seed = (s: Library) => { s.profile = { ...s.profile, name: "桉桉" }; s.persons.p = { id: "p", name: "奶奶" }; };
  it("时钟快三小时、一直离线的手机（清单时刻最新）：恢复了备份的手机不会拿它的旧名字，全家也不会", () => {
    const { server, phones } = family(["A", "B", "C", "快"], seed, { offsets: { 快: 3 * H } });
    const [a, b, c] = phones as [Phone, Phone, Phone, Phone];
    const backup = copy(c.lib);
    setName(a, "安安");
    renamePerson(a, "p", "外婆");
    settle([a, b, c], server);
    tick(H);
    restore(c, backup);
    expect(settle([a, b, c], server)).toBeGreaterThanOrEqual(0);
    expect([a, b, c].map((p) => [p.lib.profile.name, p.lib.persons.p!.name])).toEqual([["安安", "外婆"], ["安安", "外婆"], ["安安", "外婆"]]);
  });
  it("几台同时同步：B 读清单在 A 改名之前、发布在之后，它那份最新的清单还是旧名字；恢复的手机不受影响", () => {
    const { server, phones } = family(["A", "B", "C"], seed);
    const [a, b, c] = phones as [Phone, Phone, Phone];
    const backup = copy(c.lib);
    edit(b, (l) => { l.profile = { ...l.profile, birthday: "2025-01-01" }; });
    begin(b, server);
    setName(a, "安安");
    sync(a, server);
    end(b, server);
    tick();
    restore(c, backup);
    expect(settle(phones, server)).toBeGreaterThanOrEqual(0);
    expect(names(phones)).toEqual(["安安", "安安", "安安"]);
    expect(phones.map((p) => p.lib.profile.birthday)).toEqual(["2025-01-01", "2025-01-01", "2025-01-01"]);
  });
  it("合并历史丢了（base.json 读不出）、已读清单还在：本机还没发出去的改名照样传开", () => {
    const { server, phones } = family(["A", "B", "C"], seed);
    const [a, , c] = phones as [Phone, Phone, Phone];
    setName(c, "清洛");
    renamePerson(c, "p", "姥姥");
    c.base = emptyBase();
    edit(a, (l) => { l.profile = { ...l.profile, birthday: "2025-01-01" }; });
    sync(a, server);
    expect(settle(phones, server)).toBeGreaterThanOrEqual(0);
    expect(phones.map((p) => [p.lib.profile.name, p.lib.persons.p!.name, p.lib.profile.birthday])).toEqual(phones.map(() => ["清洛", "姥姥", "2025-01-01"]));
  });
});

describe("时钟不准的手机", () => {
  it("快三小时的手机改的名字，慢三小时的手机改回：改回的一版排在后面，全家跟上", () => {
    const { server, phones } = family(["快", "准", "慢"], (s) => { s.profile = { ...s.profile, name: "桉桉" }; s.persons.p = { id: "p", name: "奶奶" }; }, { offsets: { 快: 3 * H, 慢: -3 * H } });
    const [fast, , slow] = phones as [Phone, Phone, Phone];
    setName(fast, "清洛");
    renamePerson(fast, "p", "外婆");
    settle(phones, server);
    expect(names(phones)).toEqual(["清洛", "清洛", "清洛"]);
    setName(slow, "桉桉");
    renamePerson(slow, "p", "奶奶");
    expect(settle(phones, server)).toBeGreaterThanOrEqual(0);
    expect(names(phones)).toEqual(["桉桉", "桉桉", "桉桉"]);
    expect(phones.map((p) => p.lib.persons.p!.name)).toEqual(["奶奶", "奶奶", "奶奶"]);
  });
  it("两台同时改名（一快一慢，谁也没见过谁的）：全家收敛到同一个，不来回翻", () => {
    const { server, phones } = family(["快", "准", "慢"], (s) => { s.profile = { ...s.profile, name: "桉桉" }; }, { offsets: { 快: 3 * H, 慢: -3 * H } });
    const [fast, , slow] = phones as [Phone, Phone, Phone];
    setName(fast, "清洛");
    tick(H);
    setName(slow, "安安");
    expect(settle(phones, server)).toBeGreaterThanOrEqual(0);
    expect(new Set(names(phones)).size).toBe(1);
  });
});

describe("年度寄语", () => {
  it("两台同时写同一年的寄语：一个字不丢，全家同一段，之后安静", () => {
    const { server, phones } = family(["A", "B", "C"], (s) => { s.yearNotes["2026"] = "起点"; });
    const [a, b] = phones as [Phone, Phone, Phone];
    setNote(a, "2026", "爸爸写的");
    setNote(b, "2026", "妈妈写的");
    expect(settle(phones, server)).toBeGreaterThanOrEqual(0);
    const notes = phones.map((p) => p.lib.yearNotes["2026"]!);
    expect(new Set(notes).size).toBe(1);
    expect(notes[0]).toContain("爸爸写的");
    expect(notes[0]).toContain("妈妈写的");
  });
  it("一台删了这一年的寄语，另一台同时在写：写的字留下", () => {
    const { server, phones } = family(["A", "B"], (s) => { s.yearNotes["2026"] = "起点"; });
    const [a, b] = phones as [Phone, Phone];
    setNote(a, "2026", "");
    tick();
    setNote(b, "2026", "起点，会走了");
    expect(settle(phones, server)).toBeGreaterThanOrEqual(0);
    expect(phones.map((p) => p.lib.yearNotes["2026"])).toEqual(["起点，会走了", "起点，会走了"]);
  });
});

describe("人物", () => {
  it("两台各自加了同名的人：并成一个（id 小的留下），带着时刻，之后安静", () => {
    const { server, phones } = family(["A", "B"], () => {});
    const [a, b] = phones as [Phone, Phone];
    edit(a, (l) => { l.persons.q2 = { id: "q2", name: "外婆" }; });
    edit(b, (l) => { l.persons.q1 = { id: "q1", name: "外婆" }; });
    expect(a.lib.persons.q2!.updatedAt).toBeDefined();
    expect(settle(phones, server)).toBeGreaterThanOrEqual(0);
    for (const p of phones) {
      expect(Object.keys(p.lib.persons)).toEqual(["q1"]);
      expect(p.lib.tombstones!["persons:q2"]).toBeDefined();
    }
  });
  it("删人物：墓碑晚于快钟手机改名的那一版，全家都删掉", () => {
    const { server, phones } = family(["快", "慢"], (s) => { s.persons.p = { id: "p", name: "奶奶" }; }, { offsets: { 快: 3 * H, 慢: -3 * H } });
    const [fast, slow] = phones as [Phone, Phone];
    renamePerson(fast, "p", "外婆");
    settle(phones, server);
    edit(slow, (l) => deletePerson(l, "p", new Date(Date.parse(slow.lib.persons.p!.updatedAt!) - H).toISOString()));
    expect(Date.parse(slow.lib.tombstones!["persons:p"]!)).toBeGreaterThan(Date.parse(fast.lib.persons.p!.updatedAt!));
    expect(settle(phones, server)).toBeGreaterThanOrEqual(0);
    for (const p of phones) expect(p.lib.persons.p).toBeUndefined();
  });
});

describe("家里还有 1.1.6 手机", () => {
  const seed = (s: Library) => { s.profile = { ...s.profile, name: "桉桉", motto: "入淮清洛渐漫漫" }; s.persons.p = { id: "p", name: "奶奶" }; };
  it("旧手机改名、改人物：新手机照收并盖上时刻，之后安静", () => {
    const { server, phones } = family(["新甲", "旧", "新乙"], seed, { old: ["旧"] });
    const [x, old, y] = phones as [Phone, Phone, Phone];
    setName(old, "清洛");
    renamePerson(old, "p", "外婆");
    expect(old.lib.rootStamps).toBeUndefined();
    expect(settle(phones, server)).toBeGreaterThanOrEqual(0);
    for (const p of [x, old, y]) expect({ name: p.lib.profile.name, person: p.lib.persons.p!.name }).toEqual({ name: "清洛", person: "外婆" });
    expect(x.lib.rootStamps!["profile:name"]).toBeDefined();
    // 新手机再改回：新手机都跟上。旧手机按 1.1.6 的规则认得这个名字、不跟（旧的已知局限），但人物带着时刻，旧手机也跟得上。
    setName(x, "桉桉");
    renamePerson(x, "p", "奶奶");
    expect(settle(phones, server)).toBeGreaterThanOrEqual(0);
    expect([x.lib.profile.name, y.lib.profile.name]).toEqual(["桉桉", "桉桉"]);
    expect(phones.map((p) => p.lib.persons.p!.name)).toEqual(["奶奶", "奶奶", "奶奶"]);
  });
  it("新手机的改名与清空传到旧手机", () => {
    const { server, phones } = family(["新", "旧"], seed, { old: ["旧"] });
    const [fresh, old] = phones as [Phone, Phone];
    setName(fresh, "清洛");
    setMotto(fresh, undefined);
    expect(settle(phones, server)).toBeGreaterThanOrEqual(0);
    expect({ name: old.lib.profile.name, motto: old.lib.profile.motto }).toEqual({ name: "清洛", motto: undefined });
  });
  it("旧手机的旧清单不会让恢复了备份的新手机把全家改回旧名字", () => {
    const { server, phones } = family(["新甲", "新乙", "新丙", "旧"], seed, { old: ["旧"] });
    const [a, , c, old] = phones as [Phone, Phone, Phone, Phone];
    const backup = copy(c.lib);
    setName(a, "安安");
    settle(phones, server);
    setName(a, "桉桉");
    settle(phones, server);
    expect(old.lib.profile.name).toBe("安安"); // 旧手机跟不上改回（旧的已知局限）
    edit(old, (l) => { l.persons.q = { id: "q", name: "外婆" }; });
    sync(old, server); // 旧手机的清单现在是最新的一份，名字还是「安安」
    restore(c, unstamped(backup));
    expect(settle(phones, server)).toBeGreaterThanOrEqual(0);
    expect(phones.slice(0, 3).map((p) => p.lib.profile.name)).toEqual(["桉桉", "桉桉", "桉桉"]);
  });
});

describe("头一回加入（新钥匙加入后第一轮合并）", () => {
  const seed = (s: Library) => {
    s.profile = { ...s.profile, name: "桉桉", motto: "入淮清洛渐漫漫" };
    s.yearNotes["2026"] = "第一年";
    s.persons.p = { id: "p", name: "奶奶" };
  };
  /** 加入的那台：装好应用、自己填了些资料，时刻比家里的都新。 */
  function joiner(name: string, fill: (p: Phone) => void, offset = 0): Phone {
    const p = phone(name, seedLib((s) => { s.media.m1 = photo("m1", "a"); s.media.m2 = photo("m2", "b"); }), false, offset);
    tick(H);
    fill(p);
    join(p);
    return p;
  }
  it("加入前填的名字、格言时刻再新也听家里的；家里没有的生日、封面由它补上并传给全家", () => {
    const { server, phones } = family(["A", "B"], seed);
    const d = joiner("爸爸", (p) => {
      setName(p, "宝宝");
      setMotto(p, "一句话");
      edit(p, (l) => { l.profile = { ...l.profile, birthday: "2025-01-01" }; });
      setCover(p, "2026", "m2");
    });
    const all = [...phones, d];
    expect(settle(all, server)).toBeGreaterThanOrEqual(0);
    for (const p of all)
      expect({ name: p.lib.profile.name, motto: p.lib.profile.motto, birthday: p.lib.profile.birthday, cover: p.lib.yearCovers["2026"] })
        .toEqual({ name: "桉桉", motto: "入淮清洛渐漫漫", birthday: "2025-01-01", cover: "m2" });
    // 之后照常：加入的那台改名，全家跟上。
    setName(d, "清洛");
    expect(settle(all, server)).toBeGreaterThanOrEqual(0);
    expect(names(all)).toEqual(["清洛", "清洛", "清洛"]);
  });
  it("家里清空过格言（带时刻的空）：加入的那台填的格言不算数", () => {
    const { server, phones } = family(["A", "B"], seed);
    setMotto(phones[0]!, undefined);
    settle(phones, server);
    const d = joiner("爸爸", (p) => setMotto(p, "一句话"));
    const all = [...phones, d];
    expect(settle(all, server)).toBeGreaterThanOrEqual(0);
    for (const p of all) expect(p.lib.profile.motto).toBeUndefined();
  });
  it("家里的值没有时刻（升级前、1.1.6）：照样听家里的，加入的那台去掉自己的时刻", () => {
    const { server, phones } = family(["A", "旧"], seed, { old: ["旧"] });
    const d = joiner("爸爸", (p) => setName(p, "宝宝"));
    const r = sync(d, server);
    expect(r.pulled).toBeGreaterThan(0);
    expect(d.lib.profile.name).toBe("桉桉");
    expect(d.lib.rootStamps?.["profile:name"]).toBeUndefined();
    expect(settle([...phones, d], server)).toBeGreaterThanOrEqual(0);
    expect(names([...phones, d])).toEqual(["桉桉", "桉桉", "桉桉"]);
  });
  it("同一年的寄语两边都有：接起来，一个字不丢，全家同一段", () => {
    const { server, phones } = family(["A", "B"], seed);
    const d = joiner("爸爸", (p) => setNote(p, "2026", "爸爸写的"));
    const all = [...phones, d];
    expect(settle(all, server)).toBeGreaterThanOrEqual(0);
    for (const p of all) expect(p.lib.yearNotes["2026"]).toBe("第一年\n\n爸爸写的");
  });
  it("年度目录：家里有这一年的听家里的，家里没有的年份留着加入那台的", () => {
    const picks = (title: string, at: string) => ({ title, months: {}, updatedAt: at });
    const { server, phones } = family(["A", "B"], (s) => { seed(s); s.yearPicks = { "2026": picks("家里的书", T1) }; });
    const d = joiner("爸爸", (p) => edit(p, (l) => { l.yearPicks = { "2026": picks("爸爸的书", T3), "2025": picks("去年", T3) }; }));
    const all = [...phones, d];
    expect(settle(all, server)).toBeGreaterThanOrEqual(0);
    for (const p of all) expect([p.lib.yearPicks?.["2026"]?.title, p.lib.yearPicks?.["2025"]?.title]).toEqual(["家里的书", "去年"]);
  });
  it("人物：同一个 id 家里也有（以前加入过）就听家里的；自己建的同名人物并成一个", () => {
    const { server, phones } = family(["A", "B"], seed);
    const d = joiner("爸爸", (p) => {
      edit(p, (l) => { l.persons.p = { id: "p", name: "外公" }; l.persons.z = { id: "z", name: "奶奶" }; });
    });
    const all = [...phones, d];
    expect(settle(all, server)).toBeGreaterThanOrEqual(0);
    for (const p of all) expect(Object.values(p.lib.persons).map((x) => x.name)).toEqual(["奶奶"]);
  });
  it("建家的那台（家里还没有清单）：什么都不让，值与时刻原样", () => {
    const creator = joiner("建家", (p) => { setName(p, "桉桉"); setMotto(p, "入淮清洛渐漫漫"); });
    const before = copy(creator.lib);
    const server: Server = {};
    const r = sync(creator, server);
    expect(r.pulled).toBe(0);
    expect(creator.lib.profile).toEqual(before.profile);
    expect(creator.lib.rootStamps).toEqual(before.rootStamps);
  });
  it("头一轮读了清单却没并成：标记还在，下一轮照样听家里的；并成之后按平常合并", () => {
    const { server, phones } = family(["A", "B"], seed);
    const d = joiner("爸爸", (p) => setName(p, "宝宝"));
    begin(d, server);
    abort(d);
    expect(d.joining).toBe(true);
    sync(d, server);
    expect(d.lib.profile.name).toBe("桉桉");
    expect(d.joining).toBe(false);
  });
  it("恢复备份、丢了合并历史都不是加入：本机加入后改的名字不会被家里的盖掉", () => {
    const { server, phones } = family(["A", "B"], seed);
    const [, b] = phones as [Phone, Phone];
    setName(b, "清洛");
    b.base = emptyBase();
    expect(settle(phones, server)).toBeGreaterThanOrEqual(0);
    expect(names(phones)).toEqual(["清洛", "清洛"]);
  });
});
