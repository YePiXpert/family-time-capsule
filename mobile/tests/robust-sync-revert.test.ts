/**
 * 改回去的一版、时钟不准的手机、「用这一版」撞上墓碑：合并审计（2026-09-26）找到的几处，
 * 每台手机都走真实的 mergeLibraries → validateLibrary → 换上新库与新基。
 */
import { describe, expect, it } from "vitest";
import { lineage } from "../src/local/hash";
import {
  deleteAlbum,
  deleteLetter,
  deletePerson,
  deleteRecord,
  deleteSeries,
  emptyLibrary,
  patchRecord,
  validateLibrary,
  type Library,
  type LocalLetter,
  type LocalRecord,
} from "../src/local/model";
import { restoreLoser } from "../src/sync/conflicts";
import {
  emptyBase,
  mergeLibraries,
  type RemoteSnapshot,
  type SyncBase,
} from "../src/sync/merge";

type Phone = { name: string; lib: Library; base: SyncBase };
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const T0 = "2026-09-20T10:00:00.000Z";
const record = (id: string, text: string, at = T0): LocalRecord => ({
  id, revision: 1, updatedAt: at, title: "", text, date: at, location: "", first: false, mediaIds: [], coverId: null,
});
const letter = (id: string, text: string, at = T0): LocalLetter => ({
  id, title: "给桉桉", text, from: "妈妈", openAt: "2044-09-20", writtenAt: at, sealed: false, mediaIds: [], coverId: null, updatedAt: at,
});
const snapOf = (p: Phone, now: string): RemoteSnapshot => ({ deviceId: p.name, deviceName: p.name, createdAt: now, library: copy(p.lib) });
/** 一轮同步：并入其他手机的整库快照，换上新库与新基。 */
function sync(p: Phone, others: Phone[], now: string) {
  const r = mergeLibraries(p.lib, others.map((o) => snapOf(o, now)), p.base, now);
  validateLibrary(r.next);
  p.lib = copy(r.next);
  p.base = r.base;
  return r;
}
/** 几台手机从同一份库出发，各同步一轮（第三台只在给了三个名字时有）。 */
function family(fill: (s: Library) => void, names = ["A", "B"]): [Phone, Phone, Phone] {
  const lib = emptyLibrary();
  lib.welcome = true;
  fill(lib);
  const phones = names.map((name) => ({ name, lib: copy(lib), base: emptyBase() }));
  for (const p of phones) sync(p, phones.filter((o) => o !== p), "2026-09-20T10:00:01.000Z");
  return phones as [Phone, Phone, Phone];
}
/** 编辑页保存的形状：升一版、带世系、updatedAt = 这台手机的「现在」。 */
function edit(p: Phone, kind: "records" | "letters", id: string, text: string, now: string) {
  p.lib = copy(p.lib);
  const old = p.lib[kind][id]!;
  const next = { ...copy(old), text, updatedAt: now, ancestors: lineage(old) };
  if (kind === "records") (next as LocalRecord).revision = (old as LocalRecord).revision + 1;
  (p.lib[kind] as Record<string, typeof next>)[id] = next;
}
const mark = (p: Phone, first: boolean, now: string) => {
  p.lib = copy(p.lib);
  patchRecord(p.lib, "x", { first }, now);
};

describe("改回去的一版（内容等于更早的一版）", () => {
  it("A 标上「第一次」又取消：B 跟着取消，不出卡", () => {
    const [a, b] = family((s) => { s.records.x = record("x", "第一次走路"); });
    mark(a, true, "2026-09-20T11:00:00.000Z");
    sync(a, [b], "2026-09-20T11:00:01.000Z");
    sync(b, [a], "2026-09-20T11:00:02.000Z");
    expect(b.lib.records.x!.first).toBe(true);
    mark(a, false, "2026-09-20T12:00:00.000Z");
    sync(a, [b], "2026-09-20T12:00:01.000Z");
    const r = sync(b, [a], "2026-09-20T12:00:02.000Z");
    expect({ a: a.lib.records.x!.first, b: b.lib.records.x!.first, cards: r.conflicts.length }).toEqual({ a: false, b: false, cards: 0 });
    // 之后几轮都不再动。
    expect(sync(a, [b], "2026-09-20T12:00:03.000Z").pulled).toBe(0);
    expect(sync(b, [a], "2026-09-20T12:00:04.000Z").pulled).toBe(0);
  });
  it("B 标上、A 取消（时钟比 B 慢）：B 照样跟着取消", () => {
    const [a, b] = family((s) => { s.records.x = record("x", "第一次走路"); });
    mark(b, true, "2026-09-20T11:10:00.000Z");
    sync(b, [a], "2026-09-20T11:10:01.000Z");
    sync(a, [b], "2026-09-20T11:00:00.000Z");
    mark(a, false, "2026-09-20T11:01:00.000Z");
    sync(a, [b], "2026-09-20T11:01:01.000Z");
    const r = sync(b, [a], "2026-09-20T11:12:00.000Z");
    expect({ a: a.lib.records.x!.first, b: b.lib.records.x!.first, cards: r.conflicts.length }).toEqual({ a: false, b: false, cards: 0 });
  });
  it("信改了又改回：另一台跟上", () => {
    const [a, b] = family((s) => { s.letters.l = letter("l", "第一句"); });
    edit(a, "letters", "l", "第二句", "2026-09-20T11:00:00.000Z");
    sync(a, [b], "2026-09-20T11:00:01.000Z");
    sync(b, [a], "2026-09-20T11:00:02.000Z");
    edit(a, "letters", "l", "第一句", "2026-09-20T12:00:00.000Z");
    sync(a, [b], "2026-09-20T12:00:01.000Z");
    const r = sync(b, [a], "2026-09-20T12:00:02.000Z");
    expect({ b: b.lib.letters.l!.text, cards: r.conflicts.length }).toEqual({ b: "第一句", cards: 0 });
  });
  it("丢了的手机的旧清单（取消之前那一版）不会把取消盖回去", () => {
    const [a, b, lost] = family((s) => { s.records.x = record("x", "第一次走路"); }, ["A", "B", "丢了的手机"]);
    mark(a, true, "2026-09-20T11:00:00.000Z");
    sync(a, [b], "2026-09-20T11:00:01.000Z");
    sync(lost, [a], "2026-09-20T11:00:02.000Z");
    expect(lost.lib.records.x!.first).toBe(true);
    mark(a, false, "2026-09-20T12:00:00.000Z");
    sync(a, [b], "2026-09-20T12:00:01.000Z");
    sync(b, [a], "2026-09-20T12:00:02.000Z");
    // 本机见过的版本记不住了（清过基、重新加入）：只剩世系能说明旧清单那一版早被包含。
    for (const base of [emptyBase(), mergeLibraries(b.lib, [], emptyBase(), "2026-09-20T12:00:03.000Z").base]) {
      const r = mergeLibraries(b.lib, [snapOf(lost, "2026-09-20T12:00:04.000Z")], base, "2026-09-20T12:00:04.000Z");
      expect({ first: r.next.records.x!.first, cards: r.conflicts.length }).toEqual({ first: false, cards: 0 });
    }
  });
  it("A 取消的同时 B 在标着的那一版上改了字：两台得出同一版，另一版两边都留底", () => {
    const [a, b] = family((s) => { s.records.x = record("x", "第一次走路"); });
    mark(a, true, "2026-09-20T11:00:00.000Z");
    sync(a, [b], "2026-09-20T11:00:01.000Z");
    sync(b, [a], "2026-09-20T11:00:02.000Z");
    mark(a, false, "2026-09-20T12:00:00.000Z");
    edit(b, "records", "x", "第一次走路，走了三步", "2026-09-20T12:05:00.000Z");
    // 两台同时同步，各自读到对方改过之后、同步之前的清单。
    const [aBefore, bBefore] = [copy(a), copy(b)];
    const onA = sync(a, [bBefore], "2026-09-20T12:06:00.000Z");
    const onB = sync(b, [aBefore], "2026-09-20T12:06:01.000Z");
    expect(a.lib.records.x).toMatchObject({ text: "第一次走路，走了三步", first: true });
    expect(b.lib.records.x).toMatchObject({ text: "第一次走路，走了三步", first: true });
    // 取消了「第一次」的那一版没有悄悄丢掉：两台都能换回。
    for (const r of [onA, onB]) {
      expect(r.conflicts).toHaveLength(1);
      expect(r.conflicts[0]!.loser).toMatchObject({ text: "第一次走路", first: false });
    }
  });
});

describe("时钟不准的手机", () => {
  it("时钟慢的手机在快钟版本上接着改：照收，不出卡", () => {
    const [a, b] = family((s) => { s.records.x = record("x", "原文"); });
    edit(a, "records", "x", "A 的版本", "2026-09-20T10:40:00.000Z");
    sync(a, [b], "2026-09-20T10:40:01.000Z");
    sync(b, [a], "2026-09-20T10:35:00.000Z");
    edit(b, "records", "x", "B 在 A 的版本上接着改", "2026-09-20T10:36:00.000Z");
    sync(b, [a], "2026-09-20T10:36:01.000Z");
    const r = sync(a, [b], "2026-09-20T10:50:00.000Z");
    expect({ onA: a.lib.records.x!.text, cards: r.conflicts.length }).toEqual({ onA: "B 在 A 的版本上接着改", cards: 0 });
  });
  it("刚并进快钟手机改过的一段就删掉：另一台也删掉，不出卡", () => {
    const [a, b] = family((s) => { s.records.x = record("x", "原文"); });
    edit(b, "records", "x", "B 改过", "2026-09-20T12:02:00.000Z");
    sync(b, [a], "2026-09-20T12:02:01.000Z");
    sync(a, [b], "2026-09-20T12:00:30.000Z");
    a.lib = copy(a.lib);
    deleteRecord(a.lib, "x", "2026-09-20T12:01:00.000Z");
    sync(a, [b], "2026-09-20T12:01:10.000Z");
    const r = sync(b, [a], "2026-09-20T12:05:00.000Z");
    expect({ onA: a.lib.records.x ?? null, onB: b.lib.records.x ?? null, cards: r.conflicts.length }).toEqual({ onA: null, onB: null, cards: 0 });
  });
  it("墓碑时刻不早于被删那一版的 updatedAt 之后一毫秒；时钟准时照记本机时刻", () => {
    const later = "2026-09-20T12:02:00.000Z", now = "2026-09-20T12:01:00.000Z";
    const s = emptyLibrary();
    s.records.r = record("r", "一段", later);
    s.letters.l = letter("l", "一封", later);
    s.albums.a = { id: "a", name: "相册", items: [], coverId: null, updatedAt: later };
    s.series.t = { id: "t", name: "系列", items: [], updatedAt: later };
    s.persons.p = { id: "p", name: "外婆" };
    s.records.old = record("old", "旧的");
    deleteRecord(s, "r", now);
    deleteLetter(s, "l", now);
    deleteAlbum(s, "a", now);
    deleteSeries(s, "t", now);
    deletePerson(s, "p", now);
    deleteRecord(s, "old", now);
    const after = "2026-09-20T12:02:00.001Z";
    expect(s.tombstones).toEqual({
      "records:r": after,
      "letters:l": after,
      "albums:a": after,
      "series:t": after,
      "persons:p": now,
      "records:old": now,
    });
    validateLibrary(s);
  });
});

describe("「用这一版」换回被删掉的一版", () => {
  it("删的那台时钟快：换回的一版晚于墓碑，下一次合并不再被删，两台都留着", () => {
    const [a, b] = family((s) => { s.records.x = record("x", "原文"); });
    // A 的时钟快十分钟：真实 12:00 删掉这一段，墓碑记成 12:10。B 同时（准钟 12:00）改了字。
    a.lib = copy(a.lib);
    deleteRecord(a.lib, "x", "2026-09-20T12:10:00.000Z");
    edit(b, "records", "x", "B 改的字", "2026-09-20T12:00:00.000Z");
    sync(a, [b], "2026-09-20T12:10:30.000Z");
    const deleted = sync(b, [a], "2026-09-20T12:01:00.000Z");
    expect(b.lib.records.x).toBeUndefined();
    expect(deleted.conflicts).toHaveLength(1);
    // B 在 12:02（它的「现在」，仍早于墓碑）选「用这一版」。
    b.lib = copy(b.lib);
    restoreLoser(b.lib, deleted.conflicts[0]!, "2026-09-20T12:02:00.000Z");
    validateLibrary(b.lib);
    expect(Date.parse(b.lib.records.x!.updatedAt)).toBeGreaterThanOrEqual(Date.parse(a.lib.tombstones!["records:x"]!));
    const onB = sync(b, [a], "2026-09-20T12:03:00.000Z");
    const onA = sync(a, [b], "2026-09-20T12:13:00.000Z");
    expect({ a: a.lib.records.x?.text, b: b.lib.records.x?.text, cards: onA.conflicts.length + onB.conflicts.length }).toEqual({
      a: "B 改的字",
      b: "B 改的字",
      cards: 0,
    });
  });
});
