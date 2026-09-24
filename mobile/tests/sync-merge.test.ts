import { lineage } from "../src/local/hash";
import { describe, expect, it } from "vitest";
import {
  emptyLibrary,
  validateLibrary,
  type Library,
  type LocalAlbum,
  type LocalLetter,
  type LocalMedia,
  type LocalRecord,
  type LocalSeries,
  type Mutable,
} from "../src/local/model";
import {
  canonical,
  contentHashOf,
  fingerprintOf,
  hashOf,
  mergeLibraries,
  repairReferences,
  unifyPersons,
  unionItems,
  emptyBase,
  KNOWN_LIMIT,
  type RemoteSnapshot,
  type SyncBase,
} from "../src/sync/merge";
/** 测试里的库都是现造的裸对象，没进过 store、没被冻结，可以直接改。 */
const mut = <T>(value: T): Mutable<T> => value as Mutable<T>;
const T0 = "2026-09-20T10:00:00.000Z";
const T1 = "2026-09-21T10:00:00.000Z";
const T2 = "2026-09-22T10:00:00.000Z";
const T3 = "2026-09-23T10:00:00.000Z";
const NOW = "2026-09-24T10:00:00.000Z";
const media = (id: string, kind: LocalMedia["kind"] = "image"): LocalMedia => ({
  id,
  file: `${id}.jpg`,
  name: `${id}.jpg`,
  kind,
  bytes: 10,
  sha256: id
    .padEnd(64, "0")
    .slice(0, 64)
    .replace(/[^a-f0-9]/g, "a"),
});
const record = (id: string, patch: Partial<LocalRecord> = {}): LocalRecord => ({
  id,
  revision: 1,
  updatedAt: T0,
  title: "",
  text: `记录 ${id}`,
  date: T0,
  location: "",
  first: false,
  mediaIds: [],
  coverId: null,
  ...patch,
});
const letter = (id: string, patch: Partial<LocalLetter> = {}): LocalLetter => ({
  id,
  title: "给桉桉",
  text: "十八岁拆",
  from: "妈妈",
  openAt: "2044-06-15",
  writtenAt: T0,
  sealed: false,
  mediaIds: [],
  coverId: null,
  updatedAt: T0,
  ...patch,
});
const album = (id: string, patch: Partial<LocalAlbum> = {}): LocalAlbum => ({
  id,
  name: "相册",
  items: [],
  coverId: null,
  updatedAt: T0,
  ...patch,
});
const series = (id: string, patch: Partial<LocalSeries> = {}): LocalSeries => ({
  id,
  name: "同款",
  items: [],
  updatedAt: T0,
  ...patch,
});
function lib(fill: (s: Library) => void = () => {}): Library {
  const s = emptyLibrary();
  s.welcome = true;
  fill(s);
  return s;
}
/** 两台手机从同一份库出发：深拷贝，各自再改。 */
const copy = (s: Library): Library => JSON.parse(JSON.stringify(s)) as Library;
const snap = (
  library: Library,
  device = "妈妈的手机",
  createdAt = T3,
  deviceId = device,
): RemoteSnapshot => ({ deviceId, deviceName: device, createdAt, library });
/** 合并并校验：任何情形下合并结果都得能进库。 */
function merge(
  local: Library,
  remotes: RemoteSnapshot[],
  base: SyncBase = emptyBase(),
  now = NOW,
) {
  const result = mergeLibraries(local, remotes, base, now);
  validateLibrary(result.next);
  return result;
}
/** 上一轮同步结束时的基：把本机现状记下来。 */
const baseOf = (s: Library) => merge(s, []).base;
describe("fingerprints", () => {
  it("hashes canonically regardless of key order and ignores revision and updatedAt in the content hash", () => {
    expect(canonical({ b: 1, a: { d: 2, c: [3, { f: 1, e: 2 }] } })).toBe(
      '{"a":{"c":[3,{"e":2,"f":1}],"d":2},"b":1}',
    );
    expect(hashOf({ a: 1, b: 2 })).toBe(hashOf({ b: 2, a: 1 }));
    const r = record("r", { text: "x" });
    expect(contentHashOf(r)).toBe(
      contentHashOf({ ...r, revision: 9, updatedAt: T3, ancestors: ["a".repeat(16)] }),
    );
    expect(contentHashOf(r)).not.toBe(contentHashOf({ ...r, text: "y" }));
    expect(fingerprintOf(r)).toBe(`${T0}|${contentHashOf(r)}`);
    const person = { id: "p", name: "外婆" };
    expect(fingerprintOf(person)).toMatch(/^\|[a-f0-9]{64}$/);
  });
  it("unionItems keeps the first side's order and appends the second side's new keys", () => {
    expect(unionItems([1, 2, 3], [3, 4, 2, 5], (n) => String(n))).toEqual([
      1, 2, 3, 4, 5,
    ]);
  });
});
describe("first join and single-sided edits", () => {
  it("pulls everything from an empty library, wants only media shared entities reference, and numbers revisions itself", () => {
    const remote = lib((s) => {
      s.media.m1 = media("m1");
      s.media.m2 = {
        ...media("m2"),
        thumb: "m2-thumb.jpg",
        width: 4,
        height: 3,
      };
      s.media.draftOnly = media("draftOnly");
      s.media.orphan = media("orphan");
      s.records.r1 = record("r1", {
        mediaIds: ["m1"],
        coverId: "m1",
        revision: 7,
        by: "妈妈",
      });
      s.letters.l1 = letter("l1", { mediaIds: ["m2"], coverId: "m2" });
      s.drafts.d = {
        id: "d",
        recordId: null,
        baseRevision: 0,
        updatedAt: T0,
        content: {
          ...record("x"),
          mediaIds: ["draftOnly"],
          coverId: "draftOnly",
        },
      };
      s.persons.p = { id: "p", name: "外婆" };
      s.albums.a = album("a", {
        items: [{ id: "i1", recordId: "r1" }],
        coverId: "m1",
      });
      s.series.t = series("t", {
        items: [{ recordId: "r1", mediaId: "m1", month: "2026-09" }],
      });
      s.profile = { name: "桉桉", birthday: "2026-08-01", avatarId: "m2" };
      s.yearNotes["2026"] = "第一年";
      s.settings.by = "妈妈";
      s.receivedShares = ["share-1"];
    });
    const local = lib((s) => {
      s.settings.by = "爸爸";
    });
    const { next, wantedMedia, conflicts, pulled, base } = merge(local, [
      snap(remote),
    ]);
    expect(Object.keys(next.records)).toEqual(["r1"]);
    expect(next.records.r1!.revision).toBe(1);
    expect(next.records.r1!.by).toBe("妈妈");
    expect(next.letters.l1!.text).toBe("十八岁拆");
    expect(next.persons.p!.name).toBe("外婆");
    expect(next.albums.a!.items).toHaveLength(1);
    expect(next.series.t!.items).toHaveLength(1);
    expect(next.profile).toEqual({
      name: "桉桉",
      birthday: "2026-08-01",
      avatarId: "m2",
    });
    expect(next.yearNotes).toEqual({ "2026": "第一年" });
    // 草稿、设置、收到的分享是这台手机的事。
    expect(next.drafts).toEqual({});
    expect(next.settings.by).toBe("爸爸");
    expect(next.receivedShares).toEqual([]);
    // 只带回共享实体引用到的素材；thumb 是对方手机的产物，宽高不是。
    expect(wantedMedia.map((m) => m.id).sort()).toEqual(["m1", "m2"]);
    expect(next.media.m2).toEqual({ ...media("m2"), width: 4, height: 3 });
    expect(next.media.draftOnly).toBeUndefined();
    expect(next.media.orphan).toBeUndefined();
    expect(conflicts).toEqual([]);
    expect(pulled).toBe(7);
    expect(base.merged.records!.r1).toBe(fingerprintOf(next.records.r1!));
    expect(base.merged.root!["profile:name"]).toBe(hashOf(next.profile.name));
    expect(base.merged.root!.profile).toBeUndefined();
    expect(base.merged.media).toBeUndefined();
  });
  it("takes the remote edit when the local copy is unchanged since the last sync", () => {
    const shared = lib((s) => {
      s.records.r = record("r");
    });
    const base = baseOf(shared);
    const remote = copy(shared);
    remote.records.r = record("r", {
      text: "改过了",
      updatedAt: T1,
      revision: 3,
    });
    const local = copy(shared);
    local.records.r = { ...local.records.r!, revision: 5 };
    const { next, conflicts, pulled } = merge(local, [snap(remote)], base);
    expect(next.records.r!.text).toBe("改过了");
    expect(next.records.r!.updatedAt).toBe(T1);
    expect(next.records.r!.revision).toBe(6);
    expect(conflicts).toEqual([]);
    expect(pulled).toBe(1);
  });
  it("keeps the local edit when the remote copy is the one from the last sync", () => {
    const shared = lib((s) => {
      s.records.r = record("r");
    });
    const base = baseOf(shared);
    const local = copy(shared);
    local.records.r = record("r", {
      text: "我改的",
      updatedAt: T1,
      revision: 2,
    });
    const { next, conflicts, pulled } = merge(
      local,
      [snap(copy(shared))],
      base,
    );
    expect(next.records.r).toBe(local.records.r);
    expect(conflicts).toEqual([]);
    expect(pulled).toBe(0);
  });
  it("adds a record that only the other phone wrote and leaves local-only records alone", () => {
    const local = lib((s) => {
      s.records.mine = record("mine", { by: "爸爸" });
    });
    const remote = lib((s) => {
      s.records.hers = record("hers", { by: "妈妈", updatedAt: T1 });
    });
    const { next, pulled } = merge(local, [snap(remote)]);
    expect(Object.keys(next.records).sort()).toEqual(["hers", "mine"]);
    expect(next.records.hers!.by).toBe("妈妈");
    expect(pulled).toBe(1);
  });
});
describe("both sides changed", () => {
  const start = () => {
    const shared = lib((s) => {
      s.records.r = record("r", { by: "爸爸" });
    });
    return { shared, base: baseOf(shared) };
  };
  it("lets the newer version win and keeps the losing local version as a conflict", () => {
    const { shared, base } = start();
    const local = copy(shared);
    local.records.r = record("r", {
      text: "爸爸的版本",
      by: "爸爸",
      updatedAt: T1,
      revision: 2,
    });
    const remote = copy(shared);
    remote.records.r = record("r", {
      text: "妈妈的版本",
      by: "妈妈",
      updatedAt: T2,
      revision: 2,
    });
    const { next, conflicts } = merge(local, [snap(remote)], base);
    expect(next.records.r!.text).toBe("妈妈的版本");
    expect(next.records.r!.revision).toBe(3);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      key: "records:r",
      kind: "records",
      entityId: "r",
      at: NOW,
      device: null,
      winner: { updatedAt: T2, by: "妈妈" },
    });
    expect((conflicts[0]!.loser as LocalRecord).text).toBe("爸爸的版本");
  });
  it("keeps the newer local version and files the remote version with its device name", () => {
    const { shared, base } = start();
    const local = copy(shared);
    local.records.r = record("r", {
      text: "爸爸的版本",
      by: "爸爸",
      updatedAt: T2,
      revision: 2,
    });
    const remote = copy(shared);
    remote.records.r = record("r", {
      text: "妈妈的版本",
      by: "妈妈",
      updatedAt: T1,
    });
    const { next, conflicts } = merge(
      local,
      [snap(remote, "妈妈的手机")],
      base,
    );
    expect(next.records.r!.text).toBe("爸爸的版本");
    expect(conflicts[0]).toMatchObject({
      device: "妈妈的手机",
      winner: { updatedAt: T2, by: "爸爸" },
    });
    expect((conflicts[0]!.loser as LocalRecord).text).toBe("妈妈的版本");
  });
  it("brings back the photos only the losing remote version uses, so 用这一版 keeps them", () => {
    const { shared, base } = start();
    const local = copy(shared);
    local.records.r = record("r", { text: "爸爸的版本", updatedAt: T2, revision: 2 });
    const remote = copy(shared);
    remote.media.m9 = media("m9");
    remote.records.r = record("r", { text: "妈妈的版本", updatedAt: T1, mediaIds: ["m9"] });
    const { next, conflicts, wantedMedia } = merge(local, [snap(remote)], base);
    expect(next.records.r!.text).toBe("爸爸的版本");
    expect((conflicts[0]!.loser as LocalRecord).mediaIds).toEqual(["m9"]);
    expect(wantedMedia.map((m) => m.id)).toEqual(["m9"]);
    expect(next.media.m9).toBeTruthy();
  });
  it("breaks a same-second tie by content hash so both phones pick the same winner", () => {
    const { shared, base } = start();
    const a = copy(shared);
    a.records.r = record("r", { text: "A", updatedAt: T1 });
    const b = copy(shared);
    b.records.r = record("r", { text: "B", updatedAt: T1 });
    const onA = merge(a, [snap(b, "B")], base);
    const onB = merge(b, [snap(a, "A")], base);
    expect(onA.next.records.r!.text).toBe(onB.next.records.r!.text);
    expect(onA.conflicts).toHaveLength(1);
    expect(onB.conflicts).toHaveLength(1);
    expect((onA.conflicts[0]!.loser as LocalRecord).text).not.toBe(
      onA.next.records.r!.text,
    );
  });
  it("does not call it a conflict when both edits produced the same content", () => {
    const { shared, base } = start();
    const local = copy(shared);
    local.records.r = record("r", { text: "一样", by: "爸爸", updatedAt: T1 });
    const remote = copy(shared);
    remote.records.r = record("r", { text: "一样", by: "爸爸", updatedAt: T2 });
    const { next, conflicts } = merge(local, [snap(remote)], base);
    expect(conflicts).toEqual([]);
    expect(next.records.r!.updatedAt).toBe(T2);
  });
  it("treats letters like records, using the letter's from as its signature", () => {
    const shared = lib((s) => {
      s.letters.l = letter("l");
    });
    const base = baseOf(shared);
    const local = copy(shared);
    local.letters.l = letter("l", {
      text: "爸爸改的",
      from: "爸爸",
      updatedAt: T2,
    });
    const remote = copy(shared);
    remote.letters.l = letter("l", { text: "妈妈改的", updatedAt: T1 });
    const { next, conflicts } = merge(local, [snap(remote)], base);
    expect(next.letters.l!.text).toBe("爸爸改的");
    expect(conflicts[0]).toMatchObject({
      kind: "letters",
      winner: { updatedAt: T2, by: "爸爸" },
    });
    expect((conflicts[0]!.loser as LocalLetter).from).toBe("妈妈");
  });
  it("with an empty base, identical content is no conflict and differing content falls back to newest-wins", () => {
    const local = lib((s) => {
      s.records.same = record("same", { text: "同", updatedAt: T1 });
      s.records.diff = record("diff", { text: "本机", updatedAt: T2 });
    });
    const remote = lib((s) => {
      s.records.same = record("same", { text: "同", updatedAt: T0 });
      s.records.diff = record("diff", { text: "远端", updatedAt: T1 });
    });
    const { next, conflicts } = merge(local, [snap(remote)]);
    expect(next.records.same!.updatedAt).toBe(T1);
    expect(next.records.diff!.text).toBe("本机");
    expect(conflicts.map((c) => c.entityId)).toEqual(["diff"]);
  });
});
describe("stale copies never come back", () => {
  it("ignores the other phone's old copy after the local record moved on, even across several syncs", () => {
    const shared = lib((s) => {
      s.records.r = record("r", { text: "v0" });
    });
    let base = baseOf(shared);
    const other = copy(shared);
    // 本机改到 v1、同步；对方的清单还停在 v0。
    const local = copy(shared);
    local.records.r = record("r", { text: "v1", updatedAt: T1 });
    let result = merge(local, [snap(other)], base);
    expect(result.next.records.r!.text).toBe("v1");
    base = result.base;
    // 再改到 v2、再同步；对方还是 v0：v0 既不是基也不是本机，但本机认得它。
    const again = copy(result.next);
    again.records.r = record("r", { text: "v2", updatedAt: T2 });
    result = merge(again, [snap(other)], base);
    expect(result.next.records.r!.text).toBe("v2");
    expect(result.conflicts).toEqual([]);
    expect(result.pulled).toBe(0);
    base = result.base;
    // 对方什么都没动、本机也没动：一片安静。
    result = merge(result.next, [snap(other)], base);
    expect(result.pulled).toBe(0);
    expect(result.conflicts).toEqual([]);
  });
  it("does not resurrect the version that lost a conflict on the next sync", () => {
    const shared = lib((s) => {
      s.records.r = record("r");
    });
    const base = baseOf(shared);
    const local = copy(shared);
    local.records.r = record("r", { text: "本机新", updatedAt: T2 });
    const remote = copy(shared);
    remote.records.r = record("r", { text: "远端旧", updatedAt: T1 });
    const first = merge(local, [snap(remote)], base);
    expect(first.conflicts).toHaveLength(1);
    const second = merge(first.next, [snap(remote)], first.base);
    expect(second.next.records.r!.text).toBe("本机新");
    expect(second.conflicts).toEqual([]);
    expect(second.pulled).toBe(0);
  });
  it("is idempotent: merging the same snapshots again with the new base changes nothing", () => {
    const remote = lib((s) => {
      s.media.m = media("m");
      s.records.r = record("r", { mediaIds: ["m"], coverId: "m" });
      s.persons.p = { id: "p", name: "外婆" };
      s.albums.a = album("a", { items: [{ id: "i", recordId: "r" }] });
      s.yearNotes["2026"] = "一";
    });
    const local = lib((s) => {
      s.records.mine = record("mine", { updatedAt: T1 });
    });
    const first = merge(local, [snap(remote)]);
    const second = merge(first.next, [snap(remote)], first.base);
    expect(second.pulled).toBe(0);
    expect(second.conflicts).toEqual([]);
    expect(second.wantedMedia).toEqual([]);
    expect(second.next).toEqual(first.next);
    expect(second.base.merged).toEqual(first.base.merged);
  });
  it("files an older unknown remote version as a conflict instead of regressing an unchanged local record", () => {
    const shared = lib((s) => {
      s.records.r = record("r", { text: "现在", updatedAt: T2 });
    });
    const base = baseOf(shared);
    // 对方从旧备份恢复了（或时钟慢了一天）：它的版本比本机还旧，本机又没动过。
    const remote = copy(shared);
    remote.records.r = record("r", { text: "很久以前", updatedAt: T0 });
    const first = merge(copy(shared), [snap(remote, "外婆的手机")], base);
    expect(first.next.records.r!.text).toBe("现在");
    expect(first.conflicts[0]).toMatchObject({
      device: "外婆的手机",
      winner: { updatedAt: T2 },
    });
    const second = merge(first.next, [snap(remote, "外婆的手机")], first.base);
    expect(second.conflicts).toEqual([]);
    expect(second.pulled).toBe(0);
  });
  it("caps the remembered versions per entity", () => {
    const shared = lib((s) => {
      s.records.r = record("r");
    });
    let base = baseOf(shared);
    let local = copy(shared);
    for (let i = 0; i < KNOWN_LIMIT + 5; i++) {
      local = copy(local);
      local.records.r = record("r", {
        text: `v${i}`,
        updatedAt: new Date(Date.parse(T1) + i * 60000).toISOString(),
      });
      base = merge(local, [], base).base;
    }
    expect(base.known["records:r"]).toHaveLength(KNOWN_LIMIT);
    expect(base.known["records:r"]!.at(-1)).toBe(
      fingerprintOf(local.records.r!),
    );
  });
});
describe("deletions", () => {
  const start = () => {
    const shared = lib((s) => {
      s.media.m = media("m");
      s.records.r = record("r", { mediaIds: ["m"], coverId: "m" });
      s.records.keep = record("keep");
      s.albums.a = album("a", {
        items: [
          { id: "i1", recordId: "r" },
          { id: "i2", recordId: "keep" },
        ],
        coverId: "m",
      });
      s.series.t = series("t", {
        items: [{ recordId: "r", mediaId: "m", month: "2026-09" }],
      });
      s.selections.q = {
        id: "q",
        albumId: "a",
        selected: ["r", "keep"],
        month: "2026-09",
        offset: 0,
        name: "",
        coverId: "m",
      };
      s.drafts.edit = {
        id: "edit",
        recordId: "r",
        baseRevision: 1,
        updatedAt: T1,
        content: { ...record("r"), text: "正在改" },
      };
    });
    return { shared, base: baseOf(shared) };
  };
  it("applies the other phone's deletion, repairs albums, series and selections, and detaches the open draft", () => {
    const { shared, base } = start();
    const remote = copy(shared);
    delete remote.records.r;
    remote.tombstones = { "records:r": T2 };
    mut(remote.albums.a!).items = [{ id: "i2", recordId: "keep" }];
    mut(remote.albums.a!).coverId = null;
    mut(remote.series.t!).items = [];
    delete remote.drafts.edit;
    delete remote.selections.q;
    const { next, conflicts, pulled } = merge(
      copy(shared),
      [snap(remote)],
      base,
    );
    expect(next.records.r).toBeUndefined();
    expect(next.records.keep).toBeDefined();
    expect(next.tombstones).toEqual({ "records:r": T2 });
    expect(next.albums.a!.items.map((i) => i.recordId)).toEqual(["keep"]);
    expect(next.albums.a!.coverId).toBeNull();
    expect(next.series.t!.items).toEqual([]);
    expect(next.selections.q).toMatchObject({
      selected: ["keep"],
      coverId: null,
      albumId: "a",
    });
    expect(next.drafts.edit).toMatchObject({ recordId: null, baseRevision: 0 });
    expect(next.drafts.edit!.content.text).toBe("正在改");
    // 素材文件留在本机；只是没人指着了。
    expect(next.media.m).toBeDefined();
    expect(conflicts).toEqual([]);
    expect(pulled).toBeGreaterThanOrEqual(1);
  });
  it("lets an edit made after the deletion win over the tombstone", () => {
    const { shared, base } = start();
    const remote = copy(shared);
    delete remote.records.r;
    remote.tombstones = { "records:r": T1 };
    const local = copy(shared);
    local.records.r = record("r", {
      mediaIds: ["m"],
      coverId: "m",
      text: "删了之后我又改了",
      updatedAt: T2,
    });
    const { next, conflicts } = merge(local, [snap(remote)], base);
    expect(next.records.r!.text).toBe("删了之后我又改了");
    expect(next.tombstones).toEqual({ "records:r": T1 });
    expect(conflicts).toEqual([]);
  });
  it("keeps a copy when the other phone deleted a record this phone had changed before that", () => {
    const { shared, base } = start();
    const local = copy(shared);
    local.records.r = record("r", {
      mediaIds: ["m"],
      coverId: "m",
      text: "先改的",
      updatedAt: T1,
    });
    const remote = copy(shared);
    delete remote.records.r;
    remote.tombstones = { "records:r": T2 };
    const { next, conflicts } = merge(local, [snap(remote)], base);
    expect(next.records.r).toBeUndefined();
    expect(conflicts[0]).toMatchObject({
      kind: "records",
      entityId: "r",
      device: null,
      winner: { updatedAt: T2, deleted: true },
    });
    expect((conflicts[0]!.loser as LocalRecord).text).toBe("先改的");
  });
  it("keeps a local deletion against an unchanged remote copy, but takes a remote edit made after it", () => {
    const { shared, base } = start();
    const local = copy(shared);
    delete local.records.r;
    local.tombstones = { "records:r": T1 };
    const stale = merge(copy(local), [snap(copy(shared))], base);
    expect(stale.next.records.r).toBeUndefined();
    expect(stale.pulled).toBe(0);
    const remote = copy(shared);
    remote.records.r = record("r", {
      mediaIds: ["m"],
      coverId: "m",
      text: "对方后来改的",
      updatedAt: T2,
    });
    const edited = merge(copy(local), [snap(remote)], base);
    expect(edited.next.records.r!.text).toBe("对方后来改的");
  });
  it("unions tombstones with the latest time and stays quiet when both phones deleted", () => {
    const { shared, base } = start();
    const local = copy(shared);
    delete local.records.r;
    local.tombstones = { "records:r": T1, "albums:old": T0 };
    const remote = copy(shared);
    delete remote.records.r;
    remote.tombstones = { "records:r": T2, "letters:gone": T1 };
    const { next, conflicts, pulled } = merge(local, [snap(remote)], base);
    expect(next.tombstones).toEqual({
      "records:r": T2,
      "albums:old": T0,
      "letters:gone": T1,
    });
    expect(conflicts).toEqual([]);
    expect(pulled).toBe(0);
  });
  it("does not let a third phone's old copy resurrect a deleted record", () => {
    const { shared, base } = start();
    const local = copy(shared);
    delete local.records.r;
    local.tombstones = { "records:r": T1 };
    const third = copy(shared);
    third.records.r = record("r", {
      mediaIds: ["m"],
      coverId: "m",
      text: "第三台的旧本",
      updatedAt: T0,
      revision: 4,
    });
    const { next } = merge(local, [snap(third, "外婆的手机", T2)], base);
    expect(next.records.r).toBeUndefined();
  });
  it("deletes a person by tombstone, folding their tags into a same-named survivor when one exists", () => {
    const shared = lib((s) => {
      s.persons.p1 = { id: "p1", name: "外婆" };
      s.persons.p2 = { id: "p2", name: "姥姥" };
      s.records.r = record("r", { personIds: ["p1", "p2"] });
    });
    const base = baseOf(shared);
    const remote = copy(shared);
    delete remote.persons.p2;
    remote.tombstones = { "persons:p2": T1 };
    mut(remote.records.r!).personIds = ["p1"];
    const gone = merge(copy(shared), [snap(remote)], base);
    expect(gone.next.persons.p2).toBeUndefined();
    expect(gone.next.records.r!.personIds).toEqual(["p1"]);
    // 同名的还在：本机仍标着 p2 的记录并到同名的 p3 身上，不是剥掉；对方已改成 [p1] 的那条照单全收。
    const local = copy(shared);
    local.persons.p3 = { id: "p3", name: "姥姥" };
    local.records.mine = record("mine", { personIds: ["p2"], updatedAt: T1 });
    const folded = merge(local, [snap(remote)], base);
    expect(folded.next.persons.p2).toBeUndefined();
    expect(folded.next.records.r!.personIds).toEqual(["p1"]);
    expect(folded.next.records.mine!.personIds).toEqual(["p3"]);
  });
});
describe("albums, series and persons", () => {
  it("unions album items when both phones added, winner's order first, converging from either side", () => {
    const shared = lib((s) => {
      s.records.r1 = record("r1");
      s.records.r2 = record("r2");
      s.records.r3 = record("r3");
      s.albums.a = album("a", { items: [{ id: "i1", recordId: "r1" }] });
    });
    const base = baseOf(shared);
    const a = copy(shared);
    a.albums.a = album("a", {
      name: "A 起的名",
      items: [
        { id: "i1", recordId: "r1" },
        { id: "i2", recordId: "r2" },
      ],
      updatedAt: T1,
    });
    const b = copy(shared);
    b.albums.a = album("a", {
      name: "B 起的名",
      items: [
        { id: "i1", recordId: "r1" },
        { id: "i3", recordId: "r3" },
      ],
      updatedAt: T2,
    });
    const onA = merge(a, [snap(b, "B")], base);
    const onB = merge(b, [snap(a, "A")], base);
    expect(onA.next.albums.a!.name).toBe("B 起的名");
    expect(onA.next.albums.a!.items.map((i) => i.recordId)).toEqual([
      "r1",
      "r3",
      "r2",
    ]);
    expect(onA.next.albums.a!.updatedAt).toBe(NOW);
    expect(onB.next.albums.a).toEqual(onA.next.albums.a);
    expect(onA.conflicts).toEqual([]);
    // 第二轮：A 推了合并版，B 合并它时自己的条目都已在内，直接取用。
    const onBAgain = merge(onB.next, [snap(onA.next, "A", NOW)], onB.base);
    expect(onBAgain.next.albums.a).toEqual(onA.next.albums.a);
    expect(onBAgain.conflicts).toEqual([]);
  });
  it("takes a one-sided album change whole and takes the winner whole when the loser adds nothing", () => {
    const shared = lib((s) => {
      s.records.r1 = record("r1");
      s.records.r2 = record("r2");
      s.albums.a = album("a", { items: [{ id: "i1", recordId: "r1" }] });
    });
    const base = baseOf(shared);
    const remote = copy(shared);
    remote.albums.a = album("a", {
      name: "改名",
      items: [
        { id: "i1", recordId: "r1" },
        { id: "i2", recordId: "r2" },
      ],
      note: "扉页",
      updatedAt: T1,
    });
    const oneSided = merge(copy(shared), [snap(remote)], base);
    expect(oneSided.next.albums.a).toEqual(remote.albums.a);
    const local = copy(shared);
    local.albums.a = album("a", {
      name: "本机改名",
      items: [{ id: "i1", recordId: "r1" }],
      updatedAt: T0.replace("10:00", "11:00"),
    });
    const both = merge(local, [snap(remote)], base);
    expect(both.next.albums.a).toEqual(remote.albums.a);
  });
  it("lets the newer side pick the photo for a month both chose, unions other months, and never repeats a record", () => {
    const shared = lib((s) => {
      for (const n of ["1", "2", "3", "4"]) {
        s.media[`m${n}`] = media(`m${n}`);
        s.records[`r${n}`] = record(`r${n}`, {
          mediaIds: [`m${n}`],
          coverId: `m${n}`,
        });
      }
      s.series.t = series("t");
    });
    const base = baseOf(shared);
    const a = copy(shared);
    a.series.t = series("t", {
      items: [
        { recordId: "r1", mediaId: "m1", month: "2026-09" },
        { recordId: "r3", mediaId: "m3", month: "2026-10" },
      ],
      updatedAt: T2,
    });
    const b = copy(shared);
    b.series.t = series("t", {
      items: [
        { recordId: "r2", mediaId: "m2", month: "2026-09" },
        { recordId: "r4", mediaId: "m4", month: "2026-11" },
        // 对方把 r3 放在了另一个月：同一条记录只能出现一次，赢家那份留下。
        { recordId: "r3", mediaId: "m3", month: "2026-12" },
      ],
      updatedAt: T1,
    });
    const { next } = merge(a, [snap(b)], base);
    expect(next.series.t!.items).toEqual([
      { recordId: "r1", mediaId: "m1", month: "2026-09" },
      { recordId: "r3", mediaId: "m3", month: "2026-10" },
      { recordId: "r4", mediaId: "m4", month: "2026-11" },
    ]);
    expect(next.series.t!.updatedAt).toBe(NOW);
  });
  it("merges same-named persons into the smaller id and retags records, converging from both sides", () => {
    const a = lib((s) => {
      s.persons.pa = { id: "pa", name: "外婆" };
      s.records.ra = record("ra", { personIds: ["pa"] });
    });
    const b = lib((s) => {
      s.persons.pb = { id: "pb", name: "外婆 " };
      s.records.rb = record("rb", { personIds: ["pb"], updatedAt: T1 });
    });
    const onA = merge(a, [snap(b, "B")]);
    const onB = merge(b, [snap(a, "A")]);
    for (const { next } of [onA, onB]) {
      expect(Object.keys(next.persons)).toEqual(["pa"]);
      expect(next.records.ra!.personIds).toEqual(["pa"]);
      expect(next.records.rb!.personIds).toEqual(["pa"]);
      expect(next.tombstones).toEqual({ "persons:pb": NOW });
    }
    expect(unifyPersons(lib(), NOW)).toBe(0);
  });
  it("resolves a two-sided person rename deterministically without a conflict card", () => {
    const shared = lib((s) => {
      s.persons.p = { id: "p", name: "外婆" };
    });
    const base = baseOf(shared);
    const a = copy(shared);
    a.persons.p = { id: "p", name: "姥姥" };
    const b = copy(shared);
    b.persons.p = { id: "p", name: "外祖母" };
    const onA = merge(a, [snap(b)], base);
    const onB = merge(b, [snap(a)], base);
    expect(onA.next.persons.p!.name).toBe(onB.next.persons.p!.name);
    expect(onA.conflicts).toEqual([]);
  });
});
describe("root fields and media", () => {
  it("adopts a motto-only profile change when the other phone is unchanged", () => {
    const shared = lib((s) => {
      s.profile = { name: "小夏", fullName: "林知夏", birthday: "2026-08-01", avatarId: null };
    });
    const base = baseOf(shared);
    const remote = copy(shared);
    remote.profile.motto = "名字来自夏天的第一阵风。";
    const received = merge(copy(shared), [snap(remote)], base);
    expect(received.next.profile).toEqual(remote.profile);
    expect(received.pulled).toBe(1);
    expect(merge(copy(remote), [snap(shared)], base).next.profile).toEqual(remote.profile);
    expect(merge(received.next, [snap(remote)], received.base).pulled).toBe(0);
  });
  it("adopts a remote-only profile change and settles a two-sided one the same way on both phones", () => {
    const shared = lib((s) => {
      s.profile = { name: "桉桉", birthday: "2026-08-01", avatarId: null };
    });
    const base = baseOf(shared);
    const remote = copy(shared);
    remote.profile = { ...remote.profile, name: "李清洛" };
    expect(merge(copy(shared), [snap(remote)], base).next.profile.name).toBe(
      "李清洛",
    );
    const a = copy(shared);
    a.profile = { ...a.profile, name: "A" };
    const b = copy(shared);
    b.profile = { ...b.profile, name: "B" };
    const onA = merge(a, [snap(b)], base);
    const onB = merge(b, [snap(a)], base);
    expect(onA.next.profile).toEqual(onB.next.profile);
    // 输的一版下一轮不再被拿起来。
    const again = merge(onA.next, [snap(b)], onA.base);
    expect(again.pulled).toBe(0);
  });
  it("keeps both phones' profile edits when they changed different fields", () => {
    const shared = lib((s) => {
      s.profile = { name: "桉桉", birthday: "2026-08-01", avatarId: null };
    });
    const base = baseOf(shared);
    const a = copy(shared);
    a.profile = { ...a.profile, name: "李清洛", motto: "入淮清洛渐漫漫" };
    const b = copy(shared);
    b.profile = { ...b.profile, birthday: "2026-08-02" };
    const expected = { name: "李清洛", motto: "入淮清洛渐漫漫", birthday: "2026-08-02", avatarId: null };
    const onA = merge(a, [snap(b)], base);
    const onB = merge(b, [snap(a)], base);
    expect(onA.next.profile).toEqual(expected);
    expect(onB.next.profile).toEqual(expected);
    expect(onA.pulled).toBe(1);
  });
  it("reads a base saved before profile fields merged separately", () => {
    const shared = lib((s) => {
      s.profile = { name: "桉桉", birthday: "2026-08-01", avatarId: null };
    });
    const base = baseOf(shared);
    const root = base.merged.root!;
    for (const key of Object.keys(root)) if (key.startsWith("profile:")) delete root[key];
    root.profile = hashOf(shared.profile);
    const a = copy(shared);
    a.profile = { ...a.profile, name: "李清洛", motto: "入淮清洛渐漫漫" };
    // 一边没动：另一边的改动照收，没动的那边不会把它改回去。
    expect(merge(copy(shared), [snap(a)], base).next.profile).toEqual(a.profile);
    expect(merge(a, [snap(shared)], base).next.profile).toEqual(a.profile);
    // 转过一轮之后按字段记基：再各改一项，两边都留下。
    const after = merge(copy(shared), [snap(a)], base);
    expect(after.base.merged.root!.profile).toBeUndefined();
    const b = copy(after.next);
    b.profile = { ...b.profile, birthday: "2026-08-02" };
    const c = copy(after.next);
    c.profile = { ...c.profile, fullName: "李清洛" };
    expect(merge(b, [snap(c)], after.base).next.profile).toEqual({
      ...a.profile, birthday: "2026-08-02", fullName: "李清洛",
    });
  });
  it("on a first join an empty profile field is unset, not an edit, on either side", () => {
    const family = lib((s) => {
      s.profile = { name: "桉桉", birthday: "2026-08-01", avatarId: null };
    });
    const fresh = lib((s) => {
      s.profile = { name: "", birthday: "", avatarId: null, motto: "名字来自一首诗" };
    });
    const expected = { name: "桉桉", birthday: "2026-08-01", avatarId: null, motto: "名字来自一首诗" };
    expect(merge(fresh, [snap(family)]).next.profile).toEqual(expected);
    expect(merge(family, [snap(fresh)]).next.profile).toEqual(expected);
  });
  it("merges year notes per year and joins two-sided edits so no words are lost", () => {
    const shared = lib((s) => {
      s.yearNotes["2026"] = "起点";
      s.yearNotes["2027"] = "老的";
    });
    const base = baseOf(shared);
    const a = copy(shared);
    a.yearNotes["2026"] = "起点，爸爸写的";
    const b = copy(shared);
    b.yearNotes["2026"] = "起点，妈妈写的";
    b.yearNotes["2027"] = "妈妈改了 2027";
    b.yearNotes["2028"] = "新的一年";
    const onA = merge(a, [snap(b)], base);
    const onB = merge(b, [snap(a)], base);
    expect(onA.next.yearNotes["2026"]).toContain("爸爸写的");
    expect(onA.next.yearNotes["2026"]).toContain("妈妈写的");
    expect(onA.next.yearNotes["2026"]).toBe(onB.next.yearNotes["2026"]);
    expect(onA.next.yearNotes["2027"]).toBe("妈妈改了 2027");
    expect(onA.next.yearNotes["2028"]).toBe("新的一年");
    // 一段已经包含另一段：取长的，不重复。
    const c = copy(shared);
    c.yearNotes["2026"] = "起点，续写";
    const d = copy(shared);
    d.yearNotes["2026"] = "起点，续写，再续";
    expect(merge(c, [snap(d)], base).next.yearNotes["2026"]).toBe(
      "起点，续写，再续",
    );
  });
  it("adopts year covers and pulls their media, and takes the earlier binding time per year", () => {
    const local = lib((s) => {
      s.yearBooksBoundAt = { "2026": T2 };
    });
    const remote = lib((s) => {
      s.media.cover = media("cover");
      s.records.r = record("r", { mediaIds: ["cover"], coverId: "cover" });
      s.yearCovers["2026"] = "cover";
      s.yearBooksBoundAt = { "2026": T1, "2025": T3 };
    });
    const { next, wantedMedia } = merge(local, [snap(remote)]);
    expect(next.yearCovers).toEqual({ "2026": "cover" });
    expect(wantedMedia.map((m) => m.id)).toEqual(["cover"]);
    expect(next.yearBooksBoundAt).toEqual({ "2026": T1, "2025": T3 });
  });
  it("never overwrites local media, keeps the local thumb, and drops references nobody can satisfy", () => {
    const local = lib((s) => {
      s.media.m = { ...media("m"), thumb: "mine.jpg", width: 100, height: 50 };
      s.records.r = record("r", { mediaIds: ["m"], coverId: "m" });
    });
    const base = baseOf(local);
    const remote = copy(local);
    remote.media.m = {
      ...media("m"),
      name: "renamed.jpg",
      thumb: "theirs.jpg",
    };
    remote.records.ghost = record("ghost", {
      mediaIds: ["missing"],
      coverId: "missing",
      updatedAt: T1,
    });
    delete remote.media.missing;
    const { next, wantedMedia } = merge(local, [snap(remote)], base);
    expect(next.media.m).toBe(local.media.m);
    expect(wantedMedia).toEqual([]);
    expect(next.records.ghost).toMatchObject({ mediaIds: [], coverId: null });
  });
  it("prefers the newest snapshot when several phones carry the same new record, marking stale copies as seen", () => {
    const local = lib();
    const newer = lib((s) => {
      s.records.r = record("r", { text: "新", updatedAt: T2 });
    });
    const older = lib((s) => {
      s.records.r = record("r", { text: "旧", updatedAt: T1 });
    });
    const first = merge(local, [snap(older, "C", T1), snap(newer, "B", T2)]);
    expect(first.next.records.r!.text).toBe("新");
    expect(first.conflicts).toEqual([]);
    expect(first.base.known["records:r"]).toContain(
      fingerprintOf(older.records.r!),
    );
    const second = merge(first.next, [snap(older, "C", T1)], first.base);
    expect(second.pulled).toBe(0);
    expect(second.conflicts).toEqual([]);
  });
  it("repairReferences fixes dangling references without touching valid entities", () => {
    const s = lib((t) => {
      t.media.m = media("m");
      t.records.ok = record("ok", { mediaIds: ["m"], coverId: "m" });
      t.records.bad = record("bad", {
        mediaIds: ["m", "gone"],
        coverId: "gone",
        personIds: ["nobody"],
      });
      t.albums.a = album("a", {
        items: [
          { id: "i", recordId: "ok" },
          { id: "j", recordId: "deleted" },
        ],
        coverId: "m",
      });
      t.series.t = series("t", {
        items: [
          { recordId: "ok", mediaId: "m", month: "2026-09" },
          { recordId: "deleted", mediaId: "m", month: "2026-10" },
        ],
      });
      t.letters.l = letter("l", { mediaIds: ["gone"], coverId: "gone" });
      t.selections.q = {
        id: "q",
        albumId: "nope",
        selected: ["ok", "deleted"],
        month: "2026-09",
        offset: 0,
        name: "",
        coverId: "m",
      };
      t.profile = { name: "", birthday: "", avatarId: "gone" };
    });
    const ok = s.records.ok;
    repairReferences(s);
    validateLibrary(s);
    expect(s.records.ok).toBe(ok);
    expect(s.records.bad).toMatchObject({ mediaIds: ["m"], coverId: null });
    expect("personIds" in s.records.bad!).toBe(false);
    expect(s.albums.a!.items).toHaveLength(1);
    expect(s.series.t!.items).toHaveLength(1);
    expect(s.letters.l).toMatchObject({ mediaIds: [], coverId: null });
    expect(s.selections.q).toMatchObject({
      albumId: null,
      selected: ["ok"],
      coverId: "m",
    });
    expect(s.profile.avatarId).toBeNull();
  });
  it("does not mutate the inputs", () => {
    const local = lib((s) => {
      s.records.r = record("r");
      s.persons.p = { id: "p", name: "外婆" };
    });
    const remote = lib((s) => {
      s.records.r = record("r", { text: "改", updatedAt: T1 });
      s.persons.q = { id: "q", name: "外婆" };
      s.tombstones = { "albums:x": T1 };
    });
    const localBefore = JSON.stringify(local),
      remoteBefore = JSON.stringify(remote);
    const base = emptyBase();
    merge(local, [snap(remote)], base);
    expect(JSON.stringify(local)).toBe(localBefore);
    expect(JSON.stringify(remote)).toBe(remoteBefore);
    expect(base).toEqual(emptyBase());
  });
});

describe("version ancestry", () => {
  it("keeps the newest parent first and caps ancestry at eight without mutating it", () => {
    const ancestors = Array.from({ length: 8 }, (_, i) => i.toString(16).repeat(16));
    const previous = record("r", { ancestors });
    const result = lineage(previous);
    expect(result).toEqual([contentHashOf(previous).slice(0, 16), ...ancestors.slice(0, 7)]);
    expect(previous.ancestors).toEqual(ancestors);
    expect(lineage(record("r"))).toEqual([contentHashOf(record("r")).slice(0, 16)]);
  });
  describe.each(["records", "letters"] as const)("%s", (kind) => {
    it.each(["sequential", "concurrent", "legacy", "identical"] as const)(
      "adopts %s remote edits and only retains genuine concurrent losses",
      (scenario) => {
        const local = lib();
        if (kind === "records") local.records.r = record("r");
        else local.letters.r = letter("r");
        const previous = local[kind].r!;
        const base = baseOf(local);
        const remote = copy(local);
        const ancestors = scenario === "sequential"
          ? [contentHashOf(previous).slice(0, 16)] : ["a".repeat(16)];
        const patch = {
          updatedAt: T1,
          text: scenario === "identical" ? previous.text : "远端改写",
          ...(scenario === "legacy" ? {} : { ancestors }),
        };
        if (kind === "records") remote.records.r = { ...remote.records.r!, ...patch };
        else remote.letters.r = { ...remote.letters.r!, ...patch };
        const result = merge(local, [snap(remote)], base);
        expect(result.next[kind].r).toEqual({
          ...remote[kind].r,
          ...(kind === "records" ? { revision: local.records.r!.revision + 1 } : {}),
        });
        expect(result.pulled).toBe(1);
        if (scenario === "concurrent") {
          expect(result.conflicts).toHaveLength(1);
          expect(result.conflicts[0]).toMatchObject({
            key: `${kind}:r`, device: null, loser: previous,
            winner: { updatedAt: T1 },
          });
        } else expect(result.conflicts).toEqual([]);
        const repeated = merge(result.next, [snap(remote)], result.base);
        expect(repeated.conflicts).toEqual([]);
        expect(repeated.pulled).toBe(0);
      },
    );
  });
});


describe("yearPicks shared root", () => {
  const directory = (updatedAt = T0, title = "窗边的小脚"): NonNullable<Library["yearPicks"]>[string] => ({ title, months: { "2026-09": { recordIds: ["r"], quote: { recordId: "r", text: "记录" } } }, updatedAt });
  const shared = () => lib(s => { s.records.r = record("r"); s.yearPicks = { "2026": directory() }; });
  it("pulls additions and one-sided changes per year, tracks fingerprints and propagates deletion", () => {
    const start = shared(), base = baseOf(start), remote = copy(start);
    remote.yearPicks!["2026"] = directory(T1, "小脚与窗帘");
    const pulled = merge(copy(start), [snap(remote)], base);
    expect(pulled.next.yearPicks).toEqual(remote.yearPicks);
    expect(pulled.base.merged.root!["yearPicks:2026"]).toBe(hashOf(remote.yearPicks!["2026"]));
    expect(merge(lib(s => { s.records.r = record("r"); }), [snap(remote)]).next.yearPicks).toEqual(remote.yearPicks);
    delete remote.yearPicks;
    expect(merge(pulled.next, [snap(remote)], pulled.base).next.yearPicks).toBeUndefined();
    const deleted = copy(start); delete deleted.yearPicks;
    expect(merge(deleted, [snap(start)], base).next.yearPicks).toBeUndefined();
  });
  it("chooses later updatedAt on both phones; ties use the same hash rule", () => {
    const start = shared(), base = baseOf(start), a = copy(start), b = copy(start);
    a.yearPicks!["2026"] = directory(T1, "爸爸的小脚");
    b.yearPicks!["2026"] = directory(T2, "妈妈的窗帘");
    const onA = merge(a, [snap(b)], base), onB = merge(b, [snap(a)], base);
    expect(onA.next.yearPicks).toEqual(b.yearPicks);
    expect(onA.next.yearPicks).toEqual(onB.next.yearPicks);
    expect(merge(onA.next, [snap(a)], onA.base).next.yearPicks).toEqual(b.yearPicks);
    b.yearPicks!["2026"]!.updatedAt = T1;
    expect(merge(a, [snap(b)], base).next.yearPicks).toEqual(merge(b, [snap(a)], base).next.yearPicks);
  });
  it("repairs deleted records and quotes, removes empty months and years without mutating the input", () => {
    const s = shared();
    s.yearPicks!["2026"]!.months["2026-09"] = { recordIds: ["r", "gone"], quote: { recordId: "gone", text: "原话" } };
    s.yearPicks!["2026"]!.months["2026-10"] = { recordIds: ["gone2"] };
    const original = copy(s);
    const fixed = merge(s, []);
    expect(fixed.next.yearPicks!["2026"]!.months).toEqual({ "2026-09": { recordIds: ["r"] } });
    expect(s).toEqual(original);
    delete fixed.next.records.r;
    repairReferences(fixed.next);
    expect(fixed.next.yearPicks).toBeUndefined();
    const base = baseOf(shared()), remote = shared();
    delete remote.records.r; remote.tombstones = { "records:r": T1 };
    expect(merge(shared(), [snap(remote)], base).next.yearPicks).toBeUndefined();
  });
});
