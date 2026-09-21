import { expect, it } from "vitest";
import { clone, emptyLibrary, validateLibrary, type Library, type LocalLetter, type LocalRecord } from "../src/local/model";
import { LocalStore } from "../src/local/store";
import { restoreLoser } from "../src/sync/conflicts";
import type { Conflict } from "../src/sync/state";
const at = "2026-09-20T10:00:00.000Z", now = "2026-09-21T10:00:00.000Z";
function fixture() {
  const lib = emptyLibrary();
  lib.media.photo = { id: "photo", file: "photo.jpg", name: "photo.jpg", kind: "image", bytes: 1, sha256: "a".repeat(64) };
  lib.persons.p = { id: "p", name: "爸爸" };
  lib.tombstones = { "records:r": at, "letters:l": at, "records:other": at };
  return lib;
}
function recordConflict(): Conflict {
  const loser: LocalRecord = { id: "r", revision: 42, updatedAt: at, title: "笑了", text: "妈妈记的", by: "妈妈", date: at, location: "家", first: true, quote: true, mediaIds: ["photo", "gone"], coverId: "gone", personIds: ["p", "gone"] };
  return { key: "records:r", kind: "records", entityId: "r", at, device: null, winner: { updatedAt: now, by: "爸爸" }, loser };
}
function letterConflict(): Conflict {
  const loser: LocalLetter = { id: "l", title: "给你", text: "慢慢长大", from: "爸爸", openAt: "2044-09-20", writtenAt: at, sealed: true, openedAt: now, mediaIds: ["photo", "gone"], coverId: "gone", updatedAt: at };
  return { key: "letters:l", kind: "letters", entityId: "l", at, device: "other", winner: { updatedAt: now, deleted: true }, loser };
}
it("整个替换记录，递增本机 revision，过滤引用并换掉墓碑对象", () => {
  const lib = fixture(), c = recordConflict(), before = clone(c);
  const previous = Object.freeze({ ...(c.loser as LocalRecord), revision: 5 });
  lib.records.r = previous;
  const tombstones = Object.freeze(lib.tombstones!);
  restoreLoser(lib, c, now);
  expect(lib.records.r).not.toBe(previous);
  expect(lib.records.r).toEqual({ ...c.loser, revision: 6, updatedAt: now, mediaIds: ["photo"], coverId: null, personIds: ["p"] });
  expect(lib.tombstones).toEqual({ "letters:l": at, "records:other": at });
  expect(lib.tombstones).not.toBe(tombstones);
  expect(tombstones["records:r"]).toBe(at);
  expect(c).toEqual(before);
});
it("被删的记录重新建为第一版，并移除墓碑", () => {
  const lib = fixture(), c = recordConflict();
  c.winner = { updatedAt: now, deleted: true };
  restoreLoser(lib, c, now);
  expect(lib.records.r!.revision).toBe(1);
  expect(lib.records.r!.updatedAt).toBe(now);
  expect(lib.tombstones!["records:r"]).toBeUndefined();
});
it.each([false, true])("换回信，保留全文与时间、过滤附件和墓碑（已有信 %s）", (exists) => {
  const lib = fixture(), c = letterConflict(), before = clone(c);
  if (exists) lib.letters.l = Object.freeze({ ...(c.loser as LocalLetter), text: "留下的" });
  const previous = lib.letters.l;
  restoreLoser(lib, c, now);
  expect(lib.letters.l).not.toBe(previous);
  expect(lib.letters.l).toEqual({ ...c.loser, updatedAt: now, mediaIds: ["photo"], coverId: null });
  expect(lib.tombstones!["letters:l"]).toBeUndefined();
  expect(c).toEqual(before);
});
it("仍存在且属于这一版的封面留下，不属于附件的封面去掉", () => {
  const lib = fixture(), c = recordConflict();
  c.loser.coverId = "photo";
  restoreLoser(lib, c, now);
  expect(lib.records.r!.coverId).toBe("photo");
  c.loser.mediaIds = [];
  restoreLoser(lib, c, now);
  expect(lib.records.r!.coverId).toBeNull();
});
it("未知种类拒绝且不改库或冲突", () => {
  const lib = fixture(), before = clone(lib), c = { ...recordConflict(), kind: "albums" } as unknown as Conflict;
  expect(() => restoreLoser(lib, c, now)).toThrow("不认识的冲突。");
  expect(lib).toEqual(before);
});
it("通过真的 LocalStore.change 与 validateChange，并持久保存冻结实体的替换", async () => {
  let disk: Library = fixture();
  // 打开的库必须有效；留底里的失效引用在恢复时过滤。
  disk.records.r = { ...(recordConflict().loser as LocalRecord), revision: 7, mediaIds: ["photo"], coverId: "photo", personIds: ["p"] };
  const store = new LocalStore({ read: async () => disk, write: async (next) => { disk = clone(next); } });
  await store.open();
  expect(Object.isFrozen(store.get().records.r)).toBe(true);
  await store.change((lib) => restoreLoser(lib, recordConflict(), now));
  await store.change((lib) => restoreLoser(lib, letterConflict(), now));
  expect(disk.records.r!.revision).toBe(8);
  expect(disk.records.r!.text).toBe("妈妈记的");
  expect(disk.letters.l!.text).toBe("慢慢长大");
  expect(disk.tombstones).toEqual({ "records:other": at });
});
it.each([
  { keepsPhoto: false, outcome: "清除悬空引用" },
  { keepsPhoto: true, outcome: "保留有效引用" },
])("换回记录后相册、选材与系列$outcome，落盘有效且可重新打开", async ({ keepsPhoto }) => {
  let disk: Library = fixture();
  const c = recordConflict();
  disk.records.r = { ...(c.loser as LocalRecord), text: "留下的正文", revision: 7, mediaIds: ["photo"], coverId: "photo", personIds: ["p"] };
  disk.albums.a = { id: "a", name: "相册", items: [{ id: "item", recordId: "r" }], coverId: "photo", updatedAt: at };
  disk.selections.q = { id: "q", albumId: "a", selected: ["r"], month: "2026-09", offset: 0, name: "选材", coverId: "photo" };
  const seriesItems = [{ recordId: "r", mediaId: "photo", month: "2026-09" }];
  disk.series.t = { id: "t", name: "时光系列", items: seriesItems, updatedAt: at };
  expect(() => validateLibrary(disk)).not.toThrow();
  c.loser.mediaIds = keepsPhoto ? ["photo"] : [];
  c.loser.coverId = keepsPhoto ? "photo" : null;
  const storage = { read: async () => disk, write: async (next: Library) => { disk = clone(next); } };
  const store = new LocalStore(storage);
  await store.open();
  await expect(store.change((lib) => restoreLoser(lib, c, now))).resolves.toBeUndefined();
  expect(() => validateLibrary(disk)).not.toThrow();
  const reopened = new LocalStore(storage);
  await expect(reopened.open()).resolves.toBeUndefined();
  expect(disk.albums.a!.coverId).toBe(keepsPhoto ? "photo" : null);
  expect(disk.selections.q!.coverId).toBe(keepsPhoto ? "photo" : null);
  expect(disk.series.t!.items).toEqual(keepsPhoto ? seriesItems : []);
  expect(disk.records.r!.text).toBe(c.loser.text);
  expect(disk.records.r!.revision).toBe(8);
  expect(reopened.get().records.r!.text).toBe(c.loser.text);
});
