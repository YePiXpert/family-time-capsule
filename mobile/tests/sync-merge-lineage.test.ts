import { describe, expect, it } from "vitest";
import { deletePerson, emptyContent, emptyLibrary, patchRecord, saveRecord, validateLibrary, type Library } from "../src/local/model";
import { mergeLibraries, emptyBase, type RemoteSnapshot } from "../src/sync/merge";
const T0 = "2026-09-20T10:00:00.000Z", T1 = "2026-09-21T10:00:00.000Z", T2 = "2026-09-22T10:00:00.000Z", NOW = "2026-09-24T10:00:00.000Z";
const copy = (s: Library): Library => JSON.parse(JSON.stringify(s)) as Library;
const snap = (library: Library): RemoteSnapshot => ({ deviceId: "B", deviceName: "妈妈的手机", createdAt: T2, library });
/** Phone A writes a record and later edits it in the editor (saveRecord → ancestors), then syncs. */
function phoneA(): Library {
  const s = emptyLibrary();
  s.welcome = true;
  s.persons.p = { id: "p", name: "外婆" };
  s.drafts.d = { id: "d", recordId: null, baseRevision: 0, updatedAt: T0, content: { ...emptyContent(), date: T0, text: "第一次翻身", personIds: ["p"] } };
  saveRecord(s, "d", "r", T0);
  s.drafts.e = { id: "e", recordId: "r", baseRevision: 1, updatedAt: T1, content: { ...s.records.r!, mediaIds: [...s.records.r!.mediaIds], personIds: [...(s.records.r!.personIds ?? [])], text: "第一次翻身，外婆在旁边" } };
  saveRecord(s, "e", "r", T1);
  expect(s.records.r!.ancestors).toHaveLength(1);
  return s;
}
function mergeInto(a: Library, b: Library) {
  const base = mergeLibraries(a, [], emptyBase(), NOW).base; // A's base after its last sync
  const result = mergeLibraries(a, [snap(b)], base, NOW);
  validateLibrary(result.next);
  return result;
}
describe("编辑页以外的改动也带世系", () => {
  it("B 在阅读页标「第一次」：没动过的 A 直接取用，不出卡", () => {
    const a = phoneA();
    const b = copy(a); // B has adopted A's version
    patchRecord(b, "r", { first: true }, T2);
    const { next, conflicts } = mergeInto(a, b);
    expect(next.records.r!.first).toBe(true);
    expect(conflicts).toEqual([]);
  });
  it("B 删掉一个人物：A 没动过的记录去掉标记，不出卡", () => {
    const a = phoneA();
    const b = copy(a);
    deletePerson(b, "p", T2);
    const { next, conflicts } = mergeInto(a, b);
    expect(next.records.r!.personIds).toBeUndefined();
    expect(conflicts).toEqual([]);
  });
});
