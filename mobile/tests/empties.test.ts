import { describe, expect, it } from "vitest";
import {
  isEmptyDraft,
  isEmptyLetter,
  isEmptySeries,
} from "../src/local/empties";
import {
  emptyContent,
  SERIES_DEFAULT_NAME,
  type LocalLetter,
  type LocalSeries,
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
const series = (over: Partial<LocalSeries> = {}): LocalSeries => ({
  id: "s1",
  name: SERIES_DEFAULT_NAME,
  items: [],
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
          groupPhotosByDay: true,
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
      { photoEvents: [{ ...emptyContent(), text: "第 1 件事的正文" }] },
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

describe("empty series", () => {
  it("is empty while it still has the default or a blank name and no photos", () => {
    expect(isEmptySeries(series())).toBe(true);
    expect(isEmptySeries(series({ name: `  ${SERIES_DEFAULT_NAME} ` }))).toBe(
      true,
    );
    expect(isEmptySeries(series({ name: "   " }))).toBe(true);
  });
  it("survives once it is renamed or holds a photo", () => {
    expect(isEmptySeries(series({ name: "每月一张" }))).toBe(false);
    expect(
      isEmptySeries(
        series({
          items: [{ recordId: "r1", mediaId: "m1", month: "2026-09" }],
        }),
      ),
    ).toBe(false);
  });
});
