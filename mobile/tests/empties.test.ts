import { describe, expect, it } from "vitest";
import {
  isEmptyDraft,
  isEmptyLetter,
  isUntouchedEdit,
} from "../src/local/empties";
import {
  emptyContent,
  type LocalLetter,
  type LocalRecord,
  type RecordDraft,
} from "../src/local/model";

const at = "2026-09-20T08:00:00.000Z";
const draft = (over: Partial<RecordDraft> = {}): RecordDraft => ({
  id: "d1",
  recordId: null,
  baseRevision: 0,
  content: emptyContent(),
  updatedAt: at,
  ...over,
});
const letter = (over: Partial<LocalLetter> = {}): LocalLetter => ({
  id: "l1",
  title: "",
  text: "",
  from: "",
  openAt: "2044-06-15",
  writtenAt: at,
  sealed: false,
  mediaIds: [],
  coverId: null,
  updatedAt: at,
  ...over,
});
describe("empty drafts", () => {
  it("treats a fresh draft as empty even after touching date, flags or whitespace", () => {
    expect(isEmptyDraft(draft())).toBe(true);
    expect(
      isEmptyDraft(
        draft({
          autoDate: false,
          content: {
            ...emptyContent(),
            title: "  ",
            text: "\n",
            date: "2026-01-01T00:00:00.000Z",
            first: true,
            quote: true,
            personIds: [],
          },
        }),
      ),
    ).toBe(true);
  });
  it("keeps a draft once it carries any content, attachment or recording", () => {
    const filled: Partial<RecordDraft>[] = [
      { content: { ...emptyContent(), title: "第一次翻身" } },
      { content: { ...emptyContent(), text: "今天…" } },
      { content: { ...emptyContent(), location: "家里" } },
      { content: { ...emptyContent(), personIds: ["p1"] } },
      { content: { ...emptyContent(), mediaIds: ["m1"] } },
      { recordingFile: "rec.m4a" },
    ];
    for (const over of filled) expect(isEmptyDraft(draft(over))).toBe(false);
  });
});

describe("untouched edit drafts", () => {
  const record: LocalRecord = {
    ...emptyContent(),
    id: "r1",
    revision: 3,
    title: "第一次翻身",
    text: "从左边翻过去了。",
    date: at,
    mediaIds: ["m1"],
    updatedAt: at,
  };
  // 打开编辑时整条复制：带着 id、revision 这类记录字段。
  const edit = (content: Partial<LocalRecord> = {}, over: Partial<RecordDraft> = {}) =>
    draft({ recordId: "r1", baseRevision: 3, content: { ...record, ...content }, ...over });
  it("drops a draft that is still a copy of the record", () => {
    expect(isUntouchedEdit(edit(), record)).toBe(true);
    // 旧记录缺 quote／personIds：草稿里补了空值也算没改。
    expect(isUntouchedEdit(edit({ quote: false, personIds: [] }), record)).toBe(true);
  });
  it("keeps any change, recording, AI work, new drafts and drafts of deleted records", () => {
    for (const change of [
      { text: "从左边翻过去了。还笑了。" },
      { title: "" },
      { first: true },
      { quote: true },
      { location: "家里" },
      { personIds: ["p1"] },
      { mediaIds: [] },
      { date: "2026-09-21T08:00:00.000Z" },
      { by: "妈妈" },
    ])
      expect(isUntouchedEdit(edit(change), record)).toBe(false);
    expect(isUntouchedEdit(edit({}, { recordingFile: "rec.m4a" }), record)).toBe(false);
    expect(isUntouchedEdit(edit({}, { recordId: null }), record)).toBe(false);
    expect(isUntouchedEdit(edit(), undefined)).toBe(false);
  });
});

describe("empty letters", () => {
  it("ignores the sign-off and the opening day", () => {
    expect(isEmptyLetter(letter())).toBe(true);
    expect(
      isEmptyLetter(letter({ from: "妈妈", openAt: "2030-01-01", title: " " })),
    ).toBe(true);
  });
  it("keeps titled, written, recorded or sealed letters", () => {
    expect(isEmptyLetter(letter({ title: "给十八岁的你" }))).toBe(false);
    expect(isEmptyLetter(letter({ text: "想对你说" }))).toBe(false);
    expect(isEmptyLetter(letter({ mediaIds: ["m1"] }))).toBe(false);
    expect(isEmptyLetter(letter({ sealed: true }))).toBe(false);
  });
});
