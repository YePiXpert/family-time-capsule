import { describe, expect, it } from "vitest";
import {
  defaultOpenAt,
  letterCaption,
  letterShortCaption,
  letterState,
  openAtLabel,
  openLetterAt,
  sealLetterAt,
  sortLetters,
} from "../src/local/letters";
import { nthBirthday, toDayKey } from "../src/local/dates";
import {
  emptyLibrary,
  normalizeLibrary,
  referencedMedia,
  validateLibrary,
  type LocalLetter,
} from "../src/local/model";

const letter = (over: Partial<LocalLetter> = {}): LocalLetter => ({
  id: "l1",
  title: "写给十八岁的你",
  text: "今天你第一次叫了妈妈。",
  from: "妈妈",
  openAt: "2042-06-15",
  writtenAt: "2026-09-19T10:00:00.000Z",
  sealed: true,
  mediaIds: [],
  coverId: null,
  updatedAt: "2026-09-19T10:00:00.000Z",
  ...over,
});

describe("nthBirthday", () => {
  it("projects the nth birthday on the local calendar", () => {
    expect(nthBirthday("2024-06-15", 18)).toBe("2042-06-15");
    expect(nthBirthday("2024-06-15", 0)).toBe("2024-06-15");
  });
  it("moves a leap-day birthday to 28 February in common years", () => {
    expect(nthBirthday("2024-02-29", 18)).toBe("2042-02-28");
    expect(nthBirthday("2024-02-29", 4)).toBe("2028-02-29");
  });
  it("returns null for missing or invalid birthdays", () => {
    expect(nthBirthday("", 18)).toBeNull();
    expect(nthBirthday("2024-13-01", 18)).toBeNull();
    expect(nthBirthday("2024-06-15", -1)).toBeNull();
  });
});

describe("letterState", () => {
  const today = new Date(2030, 5, 15);
  it("is a draft until sealed", () => {
    expect(letterState(letter({ sealed: false }), today)).toBe("draft");
  });
  it("stays sealed until the open day, inclusive", () => {
    expect(letterState(letter({ openAt: "2030-06-16" }), today)).toBe("sealed");
    expect(letterState(letter({ openAt: "2030-06-15" }), today)).toBe("openable");
    expect(letterState(letter({ openAt: "2030-06-14" }), today)).toBe("openable");
  });
  it("is opened once openedAt is set, even before the open day", () => {
    expect(
      letterState(letter({ openedAt: "2030-01-01T00:00:00.000Z" }), today),
    ).toBe("opened");
  });
});

describe("defaultOpenAt", () => {
  it("uses the 18th birthday when the profile has one", () => {
    expect(defaultOpenAt("2024-06-15")).toBe("2042-06-15");
  });
  it("falls back to eighteen years from today", () => {
    const today = new Date(2026, 8, 19);
    expect(defaultOpenAt("", today)).toBe("2044-09-19");
    expect(defaultOpenAt("bad", today)).toBe("2044-09-19");
  });
});

describe("labels and order", () => {
  it("renders the open day in Chinese", () => {
    expect(openAtLabel("2042-06-15")).toBe("2042年6月15日");
    expect(openAtLabel("oops")).toBe("oops");
  });
  it("captions follow the state and carry the signature", () => {
    const today = new Date(2030, 5, 15);
    expect(letterCaption(letter({ sealed: false }), today)).toBe("还没封存的草稿");
    expect(letterCaption(letter(), today)).toBe("封存至 2042年6月15日 · 妈妈");
    expect(letterCaption(letter({ openAt: "2030-06-15" }), today)).toBe(
      "可以拆了 · 妈妈",
    );
    expect(
      letterCaption(letter({ openedAt: "2030-06-15T09:00:00.000Z", from: "" }), today),
    ).toBe("已拆封");
  });
  it("short captions fit a shelf tile: state and the opening year only", () => {
    const today = new Date(2030, 5, 15);
    expect(letterShortCaption(letter({ sealed: false }), today)).toBe("还没封存");
    expect(letterShortCaption(letter(), today)).toBe("封存至 2042");
    expect(letterShortCaption(letter({ openAt: "2030-06-15" }), today)).toBe("可以拆了");
    expect(
      letterShortCaption(letter({ openedAt: "2030-06-15T09:00:00.000Z" }), today),
    ).toBe("已拆封");
  });
  it("sorts drafts, then openable, then sealed by date, then opened newest first", () => {
    const today = new Date(2030, 5, 15);
    const list = [
      letter({ id: "sealedLate", openAt: "2044-01-01" }),
      letter({ id: "openedOld", openedAt: "2029-01-01T00:00:00.000Z" }),
      letter({ id: "draft", sealed: false }),
      letter({ id: "sealedSoon", openAt: "2031-01-01" }),
      letter({ id: "openedNew", openedAt: "2030-06-01T00:00:00.000Z" }),
      letter({ id: "openable", openAt: "2030-06-15" }),
    ];
    expect(sortLetters(list, today).map((l) => l.id)).toEqual([
      "draft",
      "openable",
      "sealedSoon",
      "sealedLate",
      "openedNew",
      "openedOld",
    ]);
  });
  it("toDayKey pads month and day", () => {
    expect(toDayKey(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});

describe("letters in the library", () => {
  it("validates well-formed letters and protects their media", () => {
    const s = emptyLibrary();
    s.media.m = {
      id: "m",
      file: "m.m4a",
      name: "录音.m4a",
      kind: "audio",
      bytes: 10,
      sha256: "a".repeat(64),
    };
    s.letters.l1 = letter({ mediaIds: ["m"], coverId: null });
    validateLibrary(s);
    expect(referencedMedia(s).has("m")).toBe(true);
  });
  it("rejects malformed letters", () => {
    const bad = (over: Partial<LocalLetter>) => {
      const s = emptyLibrary();
      s.letters.l1 = letter(over);
      return () => validateLibrary(s);
    };
    expect(bad({ openAt: "2042-6-15" })).toThrow();
    expect(bad({ openAt: "2042-13-40" })).toThrow();
    expect(bad({ text: "长".repeat(5001) })).toThrow();
    expect(bad({ from: "长".repeat(51) })).toThrow();
    expect(bad({ mediaIds: ["missing"] })).toThrow();
    expect(bad({ coverId: "m" })).toThrow();
    expect(bad({ sealed: "yes" as unknown as boolean })).toThrow();
    expect(bad({ openedAt: "not a date" })).toThrow();
  });
  it("opens libraries written before letters existed", () => {
    const s = emptyLibrary() as Partial<ReturnType<typeof emptyLibrary>>;
    delete s.letters;
    normalizeLibrary(s);
    expect(s.letters).toEqual({});
    validateLibrary(s);
  });
});

describe("seal and open transitions", () => {
  it("seals a written draft, trimming title and signature", () => {
    const sealed = sealLetterAt(
      letter({ sealed: false, title: " 给你 ", from: " 爸爸 " }),
      "2026-09-19T12:00:00.000Z",
    );
    expect(sealed).toMatchObject({
      sealed: true,
      title: "给你",
      from: "爸爸",
      writtenAt: "2026-09-19T12:00:00.000Z",
      updatedAt: "2026-09-19T12:00:00.000Z",
    });
  });
  it("refuses to seal an empty letter or one already sealed", () => {
    expect(() => sealLetterAt(letter({ sealed: false, text: "  " }), "x")).toThrow(
      "信还是空的",
    );
    expect(() => sealLetterAt(letter(), "x")).toThrow("已经封存");
  });
  it("refuses to seal a letter whose opening day has already come", () => {
    const at = new Date(2026, 8, 24, 12).toISOString();
    for (const openAt of ["2026-09-23", "2026-09-24"])
      expect(() => sealLetterAt(letter({ sealed: false, openAt }), at)).toThrow("拆封的日子已经到了");
    expect(sealLetterAt(letter({ sealed: false, openAt: "2026-09-25" }), at).sealed).toBe(true);
  });
  it("opens a sealed letter once and keeps the first opening time", () => {
    const opened = openLetterAt(letter(), "2042-06-15T08:00:00.000Z");
    expect(opened.openedAt).toBe("2042-06-15T08:00:00.000Z");
    expect(openLetterAt(opened, "2043-01-01T00:00:00.000Z")).toBe(opened);
    expect(() => openLetterAt(letter({ sealed: false }), "x")).toThrow("还没封存");
  });
});
