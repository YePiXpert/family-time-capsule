import { describe, expect, it } from "vitest";
import {
  isEmptyDraft,
  isEmptyLetter,
} from "../src/local/empties";
import {
  emptyContent,
  type LocalLetter,
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
