import { contentHashOf } from "../src/local/hash";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  clone,
  deleteAlbum,
  deleteLetter,
  deletePerson,
  deleteRecord,
  deleteSeries,
  emptyContent,
  emptyLibrary,
  finishSelection,
  forkLibrary,
  fullNameLine,
  mergePersons,
  stampUnsigned,
  tombstone,
  unsignedRecords,
  monthOfItem,
  normalizeLibrary,
  recordsOfPerson,
  referencedMedia,
  saveRecord,
  validateChange,
  validateLibrary,
  type Library,
  type YearPicks,
  type LibraryDelta,
  type Mutable,
  LocalMedia,
} from "../src/local/model";
import { LocalStore } from "../src/local/store";

import { BACKUP_MAGIC_V3, decodeLibraryV2, decodeMetaV2, encodeEntities, encodeMetaV2, decodeManifest, encodeHeader } from "../src/local/backup-format";
import {
  ageLine,
  birthdayLabel,
  milestoneLabel,
  milestoneNumeral,
  milestoneOf,
} from "../src/local/dates";
import {
  clusterPlaces,
  distanceMeters,
  looksLikeCoordinates,
  placeLabel,
} from "../src/local/places";
/** 测试里的库都是现造现用的裸对象，没进过 store、没被冻结，可以直接改。 */
const mut = <T>(value: T): Mutable<T> => value as Mutable<T>;
const date = "2026-09-16T12:00:00.000Z";
function fixture() {
  const s = emptyLibrary();
  s.media.photo = {
    id: "photo",
    file: "photo.jpg",
    name: "baby.jpg",
    kind: "image",
    bytes: 8,
    sha256: "a".repeat(64),
  };
  s.drafts.draft = {
    id: "draft",
    recordId: null,
    baseRevision: 0,
    content: {
      ...emptyContent(),
      text: "第一次挥手",
      date,
      mediaIds: ["photo"],
      coverId: "photo",
    },
    updatedAt: date,
  };
  return s;
}
describe("device record lifecycle", () => {
  it("keeps auto-saved edits separate from the last explicit save and updates the same identity", () => {
    const s = fixture();
    saveRecord(s, "draft", "record", date);
    s.drafts.edit = {
      id: "edit",
      recordId: "record",
      baseRevision: 1,
      content: { ...mut(clone(s.records.record!)), text: "补记" },
      updatedAt: date,
    };
    expect(s.records.record).not.toHaveProperty("ancestors");
    const previousHash = contentHashOf(s.records.record!).slice(0, 16);
    expect(s.records.record!.text).toBe("第一次挥手");
    saveRecord(s, "edit", "unused", date);
    expect(Object.keys(s.records)).toEqual(["record"]);
    expect(s.records.record!.revision).toBe(2);
    expect(s.records.record!.text).toBe("补记");
    expect(s.records.record!.ancestors).toEqual([previousHash]);
    expect(Object.keys(s.drafts)).toEqual([]);
    validateLibrary(s);
  });
  it("preserves both versions on stale edits", () => {
    const s = fixture();
    saveRecord(s, "draft", "record", date);
    s.drafts.edit = {
      id: "edit",
      recordId: "record",
      baseRevision: 0,
      content: { ...emptyContent(), text: "old input" },
      updatedAt: date,
    };
    expect(() => saveRecord(s, "edit", "x", date)).toThrow("原记录已改变");
    expect(s.drafts.edit.content.text).toBe("old input");
    expect(s.records.record!.revision).toBe(1);
  });
  it("rejects empty records", () => {
    const s = fixture();
    mut(s.drafts.draft!).content = emptyContent();
    expect(() => saveRecord(s, "draft", "r", date)).toThrow("写几句话");
  });
  it("deletes record references without deleting other records or their originals", () => {
    const s = fixture();
    saveRecord(s, "draft", "r", date);
    s.records.other = { ...s.records.r!, id: "other" };
    s.albums.a = {
      id: "a",
      name: "album",
      items: [
        { id: "i", recordId: "r" },
        { id: "j", recordId: "other" },
      ],
      coverId: "photo",
      updatedAt: date,
    };
    deleteRecord(s, "r");
    expect(s.albums.a.items.map((i) => i.recordId)).toEqual(["other"]);
    expect(referencedMedia(s).has("photo")).toBe(true);
    validateLibrary(s);
  });
  it.each(["edit", "delete"])(
    "clears unavailable album and selection covers on %s without deleting originals",
    (operation) => {
      const s = fixture();
      saveRecord(s, "draft", "r", date);
      s.albums.a = {
        id: "a",
        name: "Album",
        items: [{ id: "i", recordId: "r" }],
        coverId: "photo",
        updatedAt: date,
      };
      s.selections.q = {
        id: "q",
        albumId: null,
        selected: ["r"],
        name: "Draft album",
        month: "",
        offset: 42,
        coverId: "photo",
      };
      if (operation === "delete") deleteRecord(s, "r");
      else {
        s.drafts.edit = {
          id: "edit",
          recordId: "r",
          baseRevision: 1,
          content: { ...clone(s.records.r!), mediaIds: [], coverId: null },
          updatedAt: date,
        };
        saveRecord(s, "edit", "unused", date);
        expect(s.albums.a.items).toHaveLength(1);
        expect(s.records.r!.revision).toBe(2);
      }
      expect(s.albums.a.coverId).toBeNull();
      expect(s.selections.q.coverId).toBeNull();
      expect(s.selections.q.name).toBe("Draft album");
      expect(s.media.photo).toBeDefined();
      validateLibrary(s);
    },
  );
  it("protects media used only in an unfinished draft or avatar", () => {
    const s = fixture();
    expect(referencedMedia(s).has("photo")).toBe(true);
    s.profile.avatarId = "photo";
    delete s.drafts.draft;
    expect(referencedMedia(s).has("photo")).toBe(true);
  });
  it("album removal cannot delete the original record", () => {
    const s = fixture();
    saveRecord(s, "draft", "r", date);
    s.selections.q = {
      id: "q",
      albumId: null,
      selected: ["r"],
      name: "一岁",
      month: "2026-09",
      offset: 142,
      coverId: "photo",
    };
    finishSelection(s, "q", "a", () => "i", date);
    delete s.albums.a;
    expect(s.records.r?.mediaIds).toEqual(["photo"]);
  });
  it("appends without duplicating selected records and preserves order and cover", () => {
    const s = fixture();
    saveRecord(s, "draft", "r", date);
    s.records.two = { ...s.records.r!, id: "two" };
    s.albums.a = {
      id: "a",
      name: "旅行",
      items: [{ id: "one", recordId: "r" }],
      coverId: "photo",
      updatedAt: date,
    };
    s.selections.q = {
      id: "q",
      albumId: "a",
      selected: ["r", "two"],
      name: "",
      month: "",
      offset: 500,
      coverId: null,
    };
    finishSelection(s, "q", "unused", () => "two", date);
    expect(s.albums.a.items.map((i) => i.recordId)).toEqual(["r", "two"]);
    expect(s.albums.a.coverId).toBe("photo");
    validateLibrary(s);
  });
});
describe("serialized durable state", () => {
  it("rolls back failed writes and continues with the next operation", async () => {
    let disk = emptyLibrary(),
      fail = false;
    const store = new LocalStore({
      read: async () => disk,
      write: async (s) => {
        if (fail) throw new Error("disk full");
        disk = clone(s);
      },
    });
    await store.open();
    fail = true;
    await expect(
      store.change((s) => {
        s.profile.name = "lost";
      }),
    ).rejects.toThrow("disk full");
    expect(store.get().profile.name).toBe("");
    fail = false;
    await store.change((s) => {
      s.profile.name = "saved";
    });
    expect(disk.profile.name).toBe("saved");
  });
  it("serializes concurrent changes without losing either update and reopens identically", async () => {
    let disk: Library | null = null;
    const driver = {
      read: async () => disk,
      write: async (s: Library) => {
        disk = clone(s);
      },
    };
    const store = new LocalStore(driver);
    await store.open();
    await Promise.all([
      store.change(async (s) => {
        await Promise.resolve();
        s.profile.name = "宝宝";
      }),
      store.change((s) => {
        s.welcome = true;
      }),
    ]);
    const reopened = new LocalStore(driver);
    await reopened.open();
    expect(reopened.get().profile.name).toBe("宝宝");
    expect(reopened.get().welcome).toBe(true);
  });
  it("never overwrites an unreadable database with an empty library", async () => {
    let writes = 0;
    const store = new LocalStore({
      read: async () => ({ version: 99 }),
      write: async () => {
        writes++;
      },
    });
    await expect(store.open()).rejects.toThrow();
    expect(writes).toBe(0);
  });
});
describe("complete backup manifest", () => {
  it("roundtrips records, edits, profile, albums, selection position and preferences", () => {
    const s = fixture();
    saveRecord(s, "draft", "r", date);
    s.profile = { name: "桉桉", birthday: "2025-09-10", avatarId: "photo" };
    s.settings.theme = "dark";
    s.selections.q = {
      id: "q",
      albumId: null,
      selected: ["r"],
      month: "2026-09",
      offset: 258,
      name: "旅行",
      coverId: "photo",
    };
    const header = encodeHeader(s);
    expect(decodeManifest(header.slice(12)).library).toEqual(s);
  });
  it.each(["../secret.jpg", "/absolute.jpg", "http://example.com/a.jpg"])(
    "rejects unsafe media paths %s",
    (file) => {
      const s = fixture();
      mut(s.media.photo!).file = file;
      expect(() => encodeHeader(s)).toThrow();
    },
  );
  it("rejects missing originals and broken album relationships", () => {
    const s = fixture();
    delete s.media.photo;
    expect(() => validateLibrary(s)).toThrow();
    const other = emptyLibrary();
    other.albums.a = {
      id: "a",
      name: "",
      items: [{ id: "i", recordId: "missing" }],
      coverId: null,
      updatedAt: date,
    };
    expect(() => validateLibrary(other)).toThrow();
  });
  it("keeps the bound-year ledger well-formed", () => {
    const s = fixture();
    s.yearBooksBoundAt = { "2026": "2027-01-05T10:00:00.000Z" };
    validateLibrary(s);
    s.yearBooksBoundAt = { "26": "2027-01-05T10:00:00.000Z" };
    expect(() => validateLibrary(s)).toThrow();
    s.yearBooksBoundAt = { "2026": "someday" };
    expect(() => validateLibrary(s)).toThrow();
    delete s.yearBooksBoundAt;
    validateLibrary(s);
  });
  it("keeps the closed-nudge ledger well-formed", () => {
    const s = fixture();
    s.nudgeClosedAt = {
      backup: "2026-09-20T10:00:00.000Z",
      rhythm: "2026-09-20T10:00:00.000Z",
    };
    validateLibrary(s);
    delete s.nudgeClosedAt;
    validateLibrary(s);
  });
  it("rejects malformed closed-nudge entries", () => {
    const s = fixture();
    s.nudgeClosedAt = { backup: "someday" };
    expect(() => validateLibrary(s)).toThrow();
    s.nudgeClosedAt = { "Backup Card!": "2026-09-20T10:00:00.000Z" };
    expect(() => validateLibrary(s)).toThrow();
    s.nudgeClosedAt = ["2026-09-20T10:00:00.000Z"] as unknown as Record<
      string,
      string
    >;
    expect(() => validateLibrary(s)).toThrow();
  });
  it("accepts a boolean quote flag and nothing else", () => {
    const s = fixture();
    saveRecord(s, "draft", "r", date);
    mut(s.records.r!).quote = true;
    validateLibrary(s);
    mut(s.records.r!).quote = "yes" as unknown as boolean;
    expect(() => validateLibrary(s)).toThrow();
  });
  it("rejects unsupported versions and active recording snapshots", () => {
    const s = fixture();
    mut(s.drafts.draft!).recordingFile = "recording-test.m4a";
    expect(() => encodeHeader(s)).toThrow("录音");
    const old = { ...emptyLibrary(), version: 2 };
    expect(() => validateLibrary(old)).toThrow();
  });
});
describe("annual notes", () => {
  it("roundtrips year notes through the backup manifest", () => {
    const s = fixture();
    s.yearNotes["2026"] = "这一年你学会了走路。";
    validateLibrary(s);
    const header = encodeHeader(s);
    expect(decodeManifest(header.slice(12)).library).toEqual(s);
  });
  it("rejects invalid year keys, non-string notes and overlong notes", () => {
    const badKey = fixture();
    badKey.yearNotes["26"] = "bad key";
    expect(() => validateLibrary(badKey)).toThrow();
    const overlong = fixture();
    overlong.yearNotes["2026"] = "长".repeat(2001);
    expect(() => validateLibrary(overlong)).toThrow();
    const nonString = fixture();
    (nonString.yearNotes as Record<string, unknown>)["2026"] = 42;
    expect(() => validateLibrary(nonString)).toThrow();
  });
  it("opens stores and backups written before year notes existed", async () => {
    const legacy = clone(fixture()) as Partial<Library>;
    delete legacy.yearNotes;
    const store = new LocalStore({
      read: async () => legacy,
      write: async () => {},
    });
    await store.open();
    expect(store.get().yearNotes).toEqual({});
    const manifest = JSON.parse(
      new TextDecoder().decode(encodeHeader(fixture()).slice(12)),
    ) as { library: Partial<Library> };
    delete manifest.library.yearNotes;
    const decoded = decodeManifest(
      new TextEncoder().encode(JSON.stringify(manifest)),
    );
    expect(decoded.library.yearNotes).toEqual({});
    expect(decoded.library.yearCovers).toEqual({});
  });
});
describe("annual book covers", () => {
  it("keeps a hand-picked cover per year and rejects malformed ones", () => {
    const s = fixture();
    s.yearCovers["2026"] = "11111111-1111-4111-8111-111111111111";
    validateLibrary(s);
    const header = encodeHeader(s);
    expect(decodeManifest(header.slice(12)).library).toEqual(s);
    const badYear = fixture();
    badYear.yearCovers["26"] = "11111111-1111-4111-8111-111111111111";
    expect(() => validateLibrary(badYear)).toThrow();
    const badId = fixture();
    badId.yearCovers["2026"] = "这不是素材 id";
    expect(() => validateLibrary(badId)).toThrow();
  });
  it("tolerates a cover whose photo has since been deleted", () => {
    // 选完封面又删照片，只该回落到自动封面，不该让整库打不开。
    const s = fixture();
    s.yearCovers["2026"] = "22222222-2222-4222-8222-222222222222";
    expect(s.media["22222222-2222-4222-8222-222222222222"]).toBeUndefined();
    expect(() => validateLibrary(s)).not.toThrow();
  });
});

describe("last export timestamp", () => {
  it("roundtrips the timestamp through the backup manifest", () => {
    const s = fixture();
    s.lastExportAt = "2026-09-01T08:00:00.000Z";
    validateLibrary(s);
    expect(decodeManifest(encodeHeader(s).slice(12)).library.lastExportAt).toBe(
      "2026-09-01T08:00:00.000Z",
    );
  });
  it("rejects non-string and unparsable timestamps", () => {
    const nonString = fixture();
    (nonString as unknown as { lastExportAt: number }).lastExportAt = 123;
    expect(() => validateLibrary(nonString)).toThrow();
    const unparsable = fixture();
    unparsable.lastExportAt = "yesterday";
    expect(() => validateLibrary(unparsable)).toThrow();
  });
  it("accepts libraries written before the field existed", () => {
    expect(() => validateLibrary(fixture())).not.toThrow();
  });
  it("validates the app-lock setting and keeps it optional", () => {
    const on = fixture();
    on.settings.lockEnabled = true;
    validateLibrary(on);
    const off = fixture();
    off.settings.lockEnabled = false;
    validateLibrary(off);
    const bad = fixture();
    (bad.settings as { lockEnabled?: unknown }).lockEnabled = "yes";
    expect(() => validateLibrary(bad)).toThrow();
  });
});

describe("keepsake dates", () => {
  it("labels the birthday as a local calendar day and rejects malformed input", () => {
    expect(birthdayLabel("2024-06-15")).toBe("2024年6月15日");
    expect(birthdayLabel("2024-06-01")).toBe("2024年6月1日");
    expect(birthdayLabel("")).toBeNull();
    expect(birthdayLabel("2024/06/15")).toBeNull();
  });
  it("composes the age line with calendar precision, counting the birth day as day one", () => {
    expect(ageLine("2024-06-15", new Date(2026, 8, 17))).toBe(
      "2 岁 3 个月 · 来到世界第 825 天",
    );
    expect(ageLine("2026-09-17", new Date(2026, 8, 17))).toBe(
      "来到世界第 1 天",
    );
    expect(ageLine("2026-08-17", new Date(2026, 8, 17))).toBe(
      "1 个月 · 来到世界第 32 天",
    );
    // 闰日出生：周年前一天按「差一天满 N 岁」折算为 11 个月。
    expect(ageLine("2024-02-29", new Date(2025, 1, 28))).toBe(
      "11 个月 · 来到世界第 366 天",
    );
  });
  it("returns no age line without a usable birthday", () => {
    expect(ageLine("", new Date(2026, 8, 17))).toBeNull();
    expect(ageLine("not-a-date", new Date())).toBeNull();
    expect(ageLine("2026-09-18", new Date(2026, 8, 17))).toBeNull();
  });
  it("marks the birth day, the hundredth day and each birthday", () => {
    expect(milestoneOf("2026-09-17", new Date(2026, 8, 17))).toEqual({
      kind: "birthday",
    });
    const hundred = milestoneOf("2026-06-08", new Date(2026, 8, 15));
    expect(hundred).toEqual({ kind: "hundred" });
    expect(milestoneLabel(hundred!)).toBe("来到世界第 100 天");
    expect(milestoneNumeral(hundred!)).toBe("100");
    const anniversary = milestoneOf("2024-09-17", new Date(2026, 8, 17));
    expect(anniversary).toEqual({ kind: "anniversary", years: 2 });
    expect(milestoneLabel(anniversary!)).toBe("2 周岁生日");
    expect(milestoneNumeral(anniversary!)).toBe("2");
    // 出生当天之后的第 100 天只命中一次，其余日子与无效生日都为空。
    expect(milestoneOf("2026-06-08", new Date(2026, 8, 16))).toBeNull();
    expect(milestoneOf("2024-06-15", new Date(2026, 8, 17))).toBeNull();
    expect(milestoneOf("", new Date())).toBeNull();
  });
});

describe("album keepsake notes", () => {
  it("roundtrips an album note through the backup manifest", () => {
    const s = fixture();
    saveRecord(s, "draft", "record", date);
    s.albums.a = {
      id: "a",
      name: "一岁相册",
      items: [{ id: "i", recordId: "record" }],
      coverId: null,
      updatedAt: date,
      note: "这一年的照片，都在这里。",
    };
    validateLibrary(s);
    expect(
      decodeManifest(encodeHeader(s).slice(12)).library.albums.a?.note,
    ).toBe("这一年的照片，都在这里。");
  });
  it("rejects non-string and overlong album notes, accepts legacy albums", () => {
    const s = fixture();
    saveRecord(s, "draft", "record", date);
    const album = {
      id: "a",
      name: "一岁相册",
      items: [{ id: "i", recordId: "record" }],
      coverId: null as string | null,
      updatedAt: date,
    };
    const withNote = { ...album, note: "留几句话。" };
    validateLibrary({ ...s, albums: { a: withNote } });
    const overlong = { ...album, note: "长".repeat(2001) };
    expect(() => validateLibrary({ ...s, albums: { a: overlong } })).toThrow();
    const nonString = { ...album, note: 42 } as unknown as typeof album;
    expect(() => validateLibrary({ ...s, albums: { a: nonString } })).toThrow();
    validateLibrary({ ...s, albums: { a: album } });
  });
});

describe("on-demand place naming", () => {
  it("recognizes bare coordinates filled from photo metadata", () => {
    expect(looksLikeCoordinates("31.200000, 121.500000")).toBe(true);
    expect(looksLikeCoordinates("-33.000000, -70.000000")).toBe(true);
    expect(looksLikeCoordinates("31.2,121.5")).toBe(true);
    expect(looksLikeCoordinates("")).toBe(false);
    expect(looksLikeCoordinates("公园的湖边")).toBe(false);
    expect(looksLikeCoordinates("31.2, 121.5, 5")).toBe(false);
  });
  it("prefers landmarks, then city/district/street, then region", () => {
    expect(placeLabel({ name: "鲁迅公园" }, "31.2, 121.5")).toBe("鲁迅公园");
    expect(
      placeLabel(
        { city: "上海市", district: "虹口区", street: "四川北路" },
        "x",
      ),
    ).toBe("上海市虹口区四川北路");
    expect(placeLabel({ region: "上海", country: "中国" }, "x")).toBe(
      "上海 · 中国",
    );
    expect(placeLabel(undefined, "31.2, 121.5")).toBe("31.2, 121.5");
    expect(placeLabel({}, "31.2, 121.5")).toBe("31.2, 121.5");
  });
});

describe("time series", () => {
  function seriesFixture() {
    const s = fixture();
    saveRecord(s, "draft", "r", date);
    s.series.grow = {
      id: "grow",
      name: "沙发上的每月一张",
      items: [{ recordId: "r", mediaId: "photo", month: "2026-09" }],
      updatedAt: date,
    };
    return s;
  }
  it("roundtrips a series through the backup manifest", () => {
    const s = seriesFixture();
    validateLibrary(s);
    expect(
      decodeManifest(encodeHeader(s).slice(12)).library.series.grow!,
    ).toEqual(s.series.grow);
  });
  it("rejects duplicate months, dangling media and non-image media", () => {
    const dup = seriesFixture();
    dup.records.two = { ...dup.records.r!, id: "two" };
    mut(dup.series.grow!).items.push({
      recordId: "two",
      mediaId: "photo",
      month: "2026-09",
    });
    expect(() => validateLibrary(dup)).toThrow();
    const dangling = seriesFixture();
    mut(dangling.series.grow!).items = [
      { recordId: "missing", mediaId: "photo", month: "2026-09" },
    ];
    expect(() => validateLibrary(dangling)).toThrow();
    const outside = seriesFixture();
    outside.media.standalone = {
      id: "standalone",
      file: "standalone.jpg",
      name: "standalone.jpg",
      kind: "image",
      bytes: 4,
      sha256: "b".repeat(64),
    };
    mut(outside.series.grow!).items = [
      { recordId: "r", mediaId: "standalone", month: "2026-09" },
    ];
    expect(() => validateLibrary(outside)).toThrow();
  });
  it("rejects malformed months and overlong names, accepts empty series", () => {
    const badMonth = seriesFixture();
    badMonth.series.grow!.items[0]!.month = "2026-9";
    expect(() => validateLibrary(badMonth)).toThrow();
    const badMonth2 = seriesFixture();
    badMonth2.series.grow!.items[0]!.month = "2026-13";
    expect(() => validateLibrary(badMonth2)).toThrow();
    const overlong = seriesFixture();
    mut(overlong.series.grow!).name = "长".repeat(101);
    expect(() => validateLibrary(overlong)).toThrow();
    const empty = seriesFixture();
    mut(empty.series.grow!).items = [];
    validateLibrary(empty);
  });
  it("opens stores and backups written before series existed", async () => {
    const legacy = clone(seriesFixture()) as Partial<Library>;
    delete legacy.series;
    const store = new LocalStore({
      read: async () => legacy,
      write: async () => {},
    });
    await store.open();
    expect(store.get().series).toEqual({});
    const manifest = JSON.parse(
      new TextDecoder().decode(encodeHeader(seriesFixture()).slice(12)),
    ) as { library: Partial<Library> };
    delete manifest.library.series;
    const decoded = decodeManifest(
      new TextEncoder().encode(JSON.stringify(manifest)),
    );
    expect(decoded.library.series).toEqual({});
  });
  it("drops series items when their record or photo goes away", () => {
    const s = seriesFixture();
    deleteRecord(s, "r");
    expect(s.series.grow!.items).toEqual([]);
    validateLibrary(s);
    const edited = seriesFixture();
    edited.drafts.edit = {
      id: "edit",
      recordId: "r",
      baseRevision: 1,
      content: {
        ...clone(edited.records.r!),
        mediaIds: [],
        coverId: null,
      },
      updatedAt: date,
    };
    saveRecord(edited, "edit", "unused", date);
    expect(edited.series.grow!.items).toEqual([]);
    validateLibrary(edited);
  });
  it("derives the item month from capture time before the record date", () => {
    const record = { date };
    expect(monthOfItem(record)).toBe("2026-09");
    expect(
      monthOfItem(record, {
        photoMetadata: { capturedAt: "2026-08-15T10:00:00.000Z" },
      }),
    ).toBe("2026-08");
  });
});

describe("person tags", () => {
  function personFixture() {
    const s = fixture();
    saveRecord(s, "draft", "r", date);
    s.persons.mom = { id: "mom", name: "妈妈" };
    s.persons.grandma = { id: "grandma", name: "外婆" };
    mut(s.records.r!).personIds = ["mom", "grandma"];
    return s;
  }
  it("roundtrips persons and record tags through the backup manifest", () => {
    const s = personFixture();
    validateLibrary(s);
    const decoded = decodeManifest(encodeHeader(s).slice(12)).library;
    expect(decoded.persons).toEqual(s.persons);
    expect(decoded.records.r!.personIds).toEqual(["mom", "grandma"]);
  });
  it("rejects unknown persons, duplicates, and blank or overlong names", () => {
    const unknown = personFixture();
    mut(unknown.records.r!).personIds = ["missing"];
    expect(() => validateLibrary(unknown)).toThrow();
    const duplicate = personFixture();
    mut(duplicate.records.r!).personIds = ["mom", "mom"];
    expect(() => validateLibrary(duplicate)).toThrow();
    const blank = personFixture();
    blank.persons.blank = { id: "blank", name: "  " };
    expect(() => validateLibrary(blank)).toThrow();
    const overlong = personFixture();
    overlong.persons.long = { id: "long", name: "长".repeat(51) };
    expect(() => validateLibrary(overlong)).toThrow();
  });
  it("keeps personIds optional and opens stores written before persons existed", async () => {
    const bare = personFixture();
    delete mut(bare.records.r!).personIds;
    validateLibrary(bare);
    const legacy = clone(personFixture()) as Partial<Library>;
    delete legacy.persons;
    mut(legacy.records!.r!).personIds = undefined;
    const store = new LocalStore({
      read: async () => legacy,
      write: async () => {},
    });
    await store.open();
    expect(store.get().persons).toEqual({});
    const manifest = JSON.parse(
      new TextDecoder().decode(encodeHeader(bare).slice(12)),
    ) as { library: Partial<Library> };
    delete manifest.library.persons;
    const decoded = decodeManifest(
      new TextEncoder().encode(JSON.stringify(manifest)),
    );
    expect(decoded.library.persons).toEqual({});
  });
  /** 记录、草稿正文与「按事情分组」的每件事都带着标记，用来验证级联剥离。 */
  function cascadeFixture() {
    const s = personFixture();
    s.drafts.d = {
      id: "d",
      recordId: null,
      baseRevision: 0,
      updatedAt: date,
      content: {
        ...emptyContent(),
        date,
        text: "外婆来了",
        personIds: ["mom", "grandma"],
      },
      photoEvents: [
        { ...emptyContent(), date, text: "上午", personIds: ["grandma"] },
        {
          ...emptyContent(),
          date,
          text: "下午",
          personIds: ["mom", "grandma"],
        },
      ],
    };
    return s;
  }
  it("strips a deleted person from records, drafts and photo events", () => {
    const s = cascadeFixture();
    deletePerson(s, "grandma");
    expect(s.persons.grandma).toBeUndefined();
    expect(s.records.r!.personIds).toEqual(["mom"]);
    expect(s.drafts.d!.content.personIds).toEqual(["mom"]);
    expect(s.drafts.d!.photoEvents![1]!.personIds).toEqual(["mom"]);
    // 标记被剥空的那件事要删掉整个字段，不留空数组
    expect("personIds" in s.drafts.d!.photoEvents![0]!).toBe(false);
    validateLibrary(s);
  });
  it("merges a person into another without leaving duplicates", () => {
    const s = cascadeFixture();
    mergePersons(s, "grandma", "mom");
    expect(s.persons.grandma).toBeUndefined();
    expect(s.persons.mom).toEqual({ id: "mom", name: "妈妈" });
    // 两个都在的地方合并后只剩一个，不重复
    expect(s.records.r!.personIds).toEqual(["mom"]);
    expect(s.drafts.d!.content.personIds).toEqual(["mom"]);
    expect(s.drafts.d!.photoEvents![0]!.personIds).toEqual(["mom"]);
    expect(s.drafts.d!.photoEvents![1]!.personIds).toEqual(["mom"]);
    validateLibrary(s);
  });
  it("refuses to delete or merge people that are not there", () => {
    expect(() => deletePerson(cascadeFixture(), "nobody")).toThrow();
    expect(() => mergePersons(cascadeFixture(), "nobody", "mom")).toThrow();
    expect(() => mergePersons(cascadeFixture(), "mom", "nobody")).toThrow();
    expect(() => mergePersons(cascadeFixture(), "mom", "mom")).toThrow();
  });
  it("rejects photo events that point at a person who is gone", () => {
    const s = cascadeFixture();
    // 只在「按事情分组」的某一件事上留下外婆：记录与草稿正文都不带，
    // 把 content() 本来就有的那条检查排除掉，单独验 photoEvents 这条分支
    mut(s.records.r!).personIds = ["mom"];
    s.drafts.d!.content.personIds = ["mom"];
    s.drafts.d!.photoEvents![1]!.personIds = ["mom"];
    validateLibrary(s);
    delete s.persons.grandma;
    expect(() => validateLibrary(s)).toThrow();
  });
  it("heals dangling person tags on open instead of locking the library out", () => {
    const s = cascadeFixture();
    delete s.persons.grandma;
    normalizeLibrary(s);
    expect(s.records.r!.personIds).toEqual(["mom"]);
    expect(s.drafts.d!.content.personIds).toEqual(["mom"]);
    expect(s.drafts.d!.photoEvents![1]!.personIds).toEqual(["mom"]);
    // 剥空的那件事删掉整个字段，与 deletePerson 的行为一致
    expect("personIds" in s.drafts.d!.photoEvents![0]!).toBe(false);
    validateLibrary(s);
  });
  it("filters records by person", () => {
    const s = personFixture();
    s.records.two = {
      ...s.records.r!,
      id: "two",
      personIds: ["mom"],
    };
    const records = Object.values(s.records);
    expect(recordsOfPerson(records, "mom").map((r) => r.id)).toEqual([
      "r",
      "two",
    ]);
    expect(recordsOfPerson(records, "grandma").map((r) => r.id)).toEqual(["r"]);
  });
});

describe("place clustering", () => {
  const gps = (
    id: string,
    latitude: number,
    longitude: number,
    capturedAt?: string,
  ): LocalMedia => ({
    id,
    file: `${id}.jpg`,
    name: `${id}.jpg`,
    kind: "image",
    bytes: 4,
    sha256: id.padEnd(64, "0").slice(0, 64),
    photoMetadata: {
      latitude,
      longitude,
      ...(capturedAt ? { capturedAt } : {}),
    },
  });
  it("measures real distances in meters", () => {
    expect(
      distanceMeters(
        { latitude: 31.2, longitude: 121.5 },
        { latitude: 31.2001, longitude: 121.5001 },
      ),
    ).toBeLessThan(30);
    expect(
      distanceMeters(
        { latitude: 31.2, longitude: 121.5 },
        { latitude: 31.21, longitude: 121.5 },
      ),
    ).toBeGreaterThan(1000);
  });
  it("clusters nearby photos with the first center and skips no-GPS media", () => {
    const clusters = clusterPlaces([
      gps("a", 31.2, 121.5, "2026-01-10T09:00:00.000Z"),
      gps("b", 31.2001, 121.5001, "2026-05-20T09:00:00.000Z"),
      gps("c", 31.21, 121.5),
      { ...gps("d", 0, 0), photoMetadata: undefined },
    ]);
    expect(clusters).toHaveLength(2);
    expect(clusters[0]).toMatchObject({
      center: { latitude: 31.2, longitude: 121.5 },
      mediaIds: ["a", "b"],
      firstAt: "2026-01-10T09:00:00.000Z",
      lastAt: "2026-05-20T09:00:00.000Z",
    });
    expect(clusters[1]!.mediaIds).toEqual(["c"]);
    expect(clusters[1]!.firstAt).toBe("");
  });
});

describe("replay score", () => {
  function audioFixture() {
    const s = fixture();
    s.media.song = {
      id: "song",
      file: "song.m4a",
      name: "哄睡小调.m4a",
      kind: "audio",
      bytes: 12,
      sha256: "c".repeat(64),
    };
    return s;
  }
  it("roundtrips the chosen score and keeps it optional", () => {
    const bare = audioFixture();
    validateLibrary(bare);
    expect(bare.settings.replayAudioId).toBeUndefined();
    const s = audioFixture();
    s.settings.replayAudioId = "song";
    validateLibrary(s);
    expect(
      decodeManifest(encodeHeader(s).slice(12)).library.settings.replayAudioId,
    ).toBe("song");
  });
  it("rejects unknown and non-audio scores", () => {
    const unknown = audioFixture();
    unknown.settings.replayAudioId = "missing";
    expect(() => validateLibrary(unknown)).toThrow();
    const nonAudio = fixture();
    nonAudio.settings.replayAudioId = "photo";
    expect(() => validateLibrary(nonAudio)).toThrow();
  });
  it("protects the chosen score from the unused-media sweep", () => {
    const s = audioFixture();
    s.settings.replayAudioId = "song";
    expect(referencedMedia(s).has("song")).toBe(true);
  });
  it("clears a score whose audio is gone instead of failing validation", () => {
    const s = audioFixture();
    s.settings.replayAudioId = "song";
    delete s.media.song;
    deleteRecord(s, "missing");
    // deleteRecord 走清理路径，悬空 id 被移除后库仍合法。
    expect(s.settings.replayAudioId).toBeUndefined();
    validateLibrary(s);
  });
});

describe("python fixture shape", () => {
  /** Collects the top-level keys of the dict(...) call in local_fixture.py's empty(). */
  function fixtureKeys(): string[] {
    const source = readFileSync(
      join(__dirname, "../scripts/local_fixture.py"),
      "utf8",
    );
    const section = source.slice(
      source.indexOf("def empty("),
      source.indexOf("def record("),
    );
    const start = section.indexOf("dict(");
    const keys: string[] = [];
    let depth = 0;
    for (let i = start; i < section.length; i++) {
      const c = section[i]!;
      if (c === "(" || c === "[") depth++;
      else if (c === ")" || c === "]") {
        depth--;
        if (depth === 0) break;
      } else if (depth === 1 && /[A-Za-z_]/.test(c)) {
        const rest = section.slice(i);
        const word = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest)![0];
        const after = rest.slice(word.length);
        if (/^=(?!=)/.test(after)) {
          keys.push(word);
          i += word.length;
        }
      }
    }
    return keys;
  }
  it("keeps the seeded library shape in lockstep with emptyLibrary", () => {
    // 模型加字段而 fixture 没跟上（或反之）会让原生回归在真机上以别的方式失败，
    // 在这里直接红掉更容易定位。
    expect(fixtureKeys()).toEqual(Object.keys(emptyLibrary()));
  });
});

describe("incremental validation", () => {
  /** 一次只增只改的改动：改完返回 delta，与 store.change 里算出来的同形。 */
  const edits: Record<string, (s: Library) => LibraryDelta> = {
    "clean edit": (s) => {
      mut(s.records.r!).title = "新标题";
      return { changed: [{ kind: "records", id: "r" }], removed: [] };
    },
    "record pointing at missing media": (s) => {
      mut(s.records.r!).mediaIds = ["gone"];
      return { changed: [{ kind: "records", id: "r" }], removed: [] };
    },
    "record cover outside its media": (s) => {
      mut(s.records.r!).coverId = "photo2";
      return { changed: [{ kind: "records", id: "r" }], removed: [] };
    },
    "record tagged with a missing person": (s) => {
      mut(s.records.r!).personIds = ["nobody"];
      return { changed: [{ kind: "records", id: "r" }], removed: [] };
    },
    "record revision below one": (s) => {
      mut(s.records.r!).revision = 0;
      return { changed: [{ kind: "records", id: "r" }], removed: [] };
    },
    "key and id disagree": (s) => {
      s.records.other = { ...s.records.r!, id: "r" };
      return { changed: [{ kind: "records", id: "other" }], removed: [] };
    },
    "new media with a broken hash": (s) => {
      s.media.bad = { ...s.media.photo!, id: "bad", sha256: "zz" };
      return { changed: [{ kind: "media", id: "bad" }], removed: [] };
    },
    "new album item pointing nowhere": (s) => {
      s.albums.a = {
        id: "a",
        name: "相册",
        items: [{ id: "i", recordId: "missing" }],
        coverId: null,
        updatedAt: date,
      };
      return { changed: [{ kind: "albums", id: "a" }], removed: [] };
    },
    "new draft based on a missing record": (s) => {
      s.drafts.d2 = { ...s.drafts.draft!, id: "d2", recordId: "missing" };
      return { changed: [{ kind: "drafts", id: "d2" }], removed: [] };
    },
    "new person with a blank name": (s) => {
      s.persons.blank = { id: "blank", name: "   " };
      return { changed: [{ kind: "persons", id: "blank" }], removed: [] };
    },
    "replay score pointing at a photo": (s) => {
      s.settings.replayAudioId = "photo";
      return { changed: [], removed: [] };
    },
    "series month out of range": (s) => {
      s.series.grow = {
        id: "grow",
        name: "系列",
        items: [{ recordId: "r", mediaId: "photo", month: "2026-13" }],
        updatedAt: date,
      };
      return { changed: [{ kind: "series", id: "grow" }], removed: [] };
    },
  };
  it.each(Object.keys(edits))("matches the full check for %s", (name) => {
    const s = fixture();
    saveRecord(s, "draft", "r", date);
    const delta = edits[name]!(s);
    const outcome = (run: () => void) => {
      try {
        run();
        return "ok";
      } catch (e) {
        return (e as Error).message;
      }
    };
    const scoped = outcome(() => validateChange(s, delta));
    expect(scoped).toBe(outcome(() => validateLibrary(s)));
    // 除了那条干净的改动，其余每一条都必须真的被拒——否则这条测试是空的。
    expect(scoped === "ok").toBe(name === "clean edit");
  });
  it("falls back to the full check whenever something was removed", () => {
    const s = fixture();
    saveRecord(s, "draft", "r", date);
    // 删掉记录还引用着的素材：只看「动过的实体」是看不见这个破口的。
    delete s.media.photo;
    expect(() =>
      validateChange(s, {
        changed: [],
        removed: [{ kind: "media", id: "photo" }],
      }),
    ).toThrow();
  });
});

describe("落款与墓碑", () => {
  const withRecord = (by?: string) => {
    const s = fixture();
    saveRecord(s, "draft", "r", date);
    if (by !== undefined) s.records.r = { ...s.records.r!, by };
    return s;
  };
  it("accepts a trimmed 1–20 character signature on records, drafts and grouped events", () => {
    validateLibrary(withRecord("爸爸"));
    validateLibrary(withRecord("外婆"));
    validateLibrary(withRecord("一".repeat(20)));
    expect(() => validateLibrary(withRecord(""))).toThrow();
    expect(() => validateLibrary(withRecord(" 爸爸"))).toThrow();
    expect(() => validateLibrary(withRecord("一".repeat(21)))).toThrow();
    const s = fixture();
    mut(s.drafts.draft!).content = { ...s.drafts.draft!.content, by: "妈妈" };
    mut(s.drafts.draft!).photoEvents = [{ ...emptyContent(), by: "妈妈" }];
    validateLibrary(s);
    mut(s.drafts.draft!).photoEvents = [{ ...emptyContent(), by: "" }];
    expect(() => validateLibrary(s)).toThrow();
  });
  it("keeps the default signature in device settings and stamps it onto new content only", () => {
    const s = fixture();
    s.settings.by = "妈妈";
    validateLibrary(s);
    s.settings.by = "";
    expect(() => validateLibrary(s)).toThrow();
    expect(emptyContent("妈妈").by).toBe("妈妈");
    expect("by" in emptyContent()).toBe(false);
    expect("by" in emptyContent("")).toBe(false);
  });
  it("leaves a tombstone for every deletion the family could otherwise resurrect", () => {
    const s = withRecord("爸爸");
    s.persons.p = { id: "p", name: "外婆" };
    s.persons.q = { id: "q", name: "姥姥" };
    s.albums.a = { id: "a", name: "a", items: [{ id: "i", recordId: "r" }], coverId: null, updatedAt: date };
    s.selections.sel = { id: "sel", albumId: "a", selected: ["r"], month: "", offset: 0, name: "", coverId: null };
    s.series.t = { id: "t", name: "t", items: [], updatedAt: date };
    s.letters.l = { id: "l", title: "", text: "", from: "", openAt: "2042-06-15", writtenAt: date, sealed: false, mediaIds: [], coverId: null, updatedAt: date };
    const at = "2026-09-21T10:00:00.000Z";
    deleteAlbum(s, "a", at);
    expect(s.selections.sel).toBeUndefined();
    deleteSeries(s, "t", at);
    deleteLetter(s, "l", at);
    mergePersons(s, "q", "p", at);
    deletePerson(s, "p", at);
    deleteRecord(s, "r", at);
    expect(s.tombstones).toEqual({
      "albums:a": at,
      "series:t": at,
      "letters:l": at,
      "persons:q": at,
      "persons:p": at,
      "records:r": at,
    });
    validateLibrary(s);
    // 删一个不存在的记录不立碑；重复删只留最新时刻。
    deleteRecord(s, "nope", at);
    expect(Object.keys(s.tombstones!)).toHaveLength(6);
    const later = "2026-09-22T10:00:00.000Z";
    tombstone(s, "records", "r", later);
    expect(s.tombstones!["records:r"]).toBe(later);
    // 墓碑随 fork 复制，不与上一版共享同一个对象。
    const forked = forkLibrary(s);
    expect(forked.tombstones).toEqual(s.tombstones);
    expect(forked.tombstones).not.toBe(s.tombstones);
    expect("tombstones" in forkLibrary(fixture())).toBe(false);
  });
  it("rejects tombstones for unknown kinds, bad ids or unparsable times", () => {
    for (const bad of [
      { "drafts:x": date },
      { "records:": date },
      { "records:a b": date },
      { "records:r": "yesterday" },
      { "records:r": 1 },
    ]) {
      const s = fixture();
      (s as unknown as { tombstones: unknown }).tombstones = bad;
      expect(() => validateLibrary(s)).toThrow();
    }
    const s = fixture();
    s.tombstones = {};
    validateLibrary(s);
  });
});

describe("给以前的时光补落款", () => {
  it("stamps only unsigned records and leaves revision and updatedAt alone", () => {
    const s = fixture();
    saveRecord(s, "draft", "r", date);
    s.records.signed = { ...s.records.r!, id: "signed", by: "妈妈" };
    s.records.other = { ...s.records.r!, id: "other" };
    expect(unsignedRecords(s).sort()).toEqual(["other", "r"]);
    const previousHash = contentHashOf(s.records.r!).slice(0, 16);
    expect(stampUnsigned(s, "爸爸")).toBe(2);
    expect(s.records.r!.ancestors).toEqual([previousHash]);
    expect(s.records.signed).not.toHaveProperty("ancestors");
    expect(s.records.r!.by).toBe("爸爸");
    expect(s.records.other!.by).toBe("爸爸");
    expect(s.records.signed!.by).toBe("妈妈");
    expect(s.records.r!.revision).toBe(1);
    expect(s.records.r!.updatedAt).toBe(date);
    expect(unsignedRecords(s)).toEqual([]);
    expect(stampUnsigned(s, "爸爸")).toBe(0);
    validateLibrary(s);
  });
});

describe.each(["records", "letters"] as const)("%s ancestry validation", (kind) => {
  const withAncestors = (ancestors: unknown) => {
    const s = fixture();
    if (kind === "records") saveRecord(s, "draft", "r", date);
    else s.letters.r = {
      id: "r", title: "", text: "给你", from: "爸爸", openAt: "2044-06-15",
      writtenAt: date, sealed: false, mediaIds: [], coverId: null, updatedAt: date,
    };
    Object.assign(s[kind].r!, { ancestors });
    return s;
  };
  it.each([undefined, [], Array(8).fill("abcdef0123456789")])("accepts optional bounded ancestry %#", (ancestors) => {
    const s = withAncestors(ancestors);
    normalizeLibrary(s);
    validateLibrary(s);
    expect(s[kind].r!.ancestors).toEqual(ancestors);
  });
  it.each([null, "abcdef0123456789", Array(9).fill("a".repeat(16)), ["G".repeat(16)], ["A".repeat(16)], ["a".repeat(15)], ["a".repeat(17)], [1234567890123456]])(
    "rejects malformed ancestry %#", (ancestors) => {
      expect(() => validateLibrary(withAncestors(ancestors))).toThrow();
    },
  );
});

it("drops copied draft ancestry for new records and takes existing ancestry when editing", () => {
  const s = fixture();
  Object.assign(mut(s.drafts.draft!).content, { ancestors: ["a".repeat(16)] });
  const first = saveRecord(s, "draft", "r", date);
  expect(first).not.toHaveProperty("ancestors");
  s.records.r = { ...first, ancestors: ["b".repeat(16)] };
  const previous = s.records.r;
  s.drafts.edit = {
    id: "edit", recordId: "r", baseRevision: first.revision, updatedAt: date,
    content: { ...first, text: "补记" },
  };
  Object.assign(mut(s.drafts.edit).content, { ancestors: ["c".repeat(16)] });
  saveRecord(s, "edit", "r", date);
  expect(s.records.r!.ancestors).toEqual([contentHashOf(previous).slice(0, 16), "b".repeat(16)]);
});

describe("profile name and origin", () => {
  it.each([
    ["fullName", 20],
    ["motto", 60],
  ] as const)("validates optional %s, including its %i-character limit", (key, limit) => {
    for (const value of [undefined, "清", "字".repeat(limit)]) {
      const s = emptyLibrary();
      s.profile[key] = value;
      expect(() => validateLibrary(s)).not.toThrow();
    }
    for (const value of ["", "字".repeat(limit + 1), " 清", "清 ", "\n清", "清\t", 1, null, {}, []]) {
      const s = emptyLibrary();
      Object.assign(s.profile, { [key]: value });
      expect(() => validateLibrary(s)).toThrow();
    }
  });
  it("preserves both fields through normalization, forks and backup manifests", () => {
    const s = emptyLibrary();
    s.profile.fullName = "林知夏";
    s.profile.motto = "名字来自夏天的第一阵风。";
    normalizeLibrary(s);
    const fork = forkLibrary(s);
    expect(fork.profile).toEqual(s.profile);
    expect(fork.profile).not.toBe(s.profile);
    validateLibrary(fork);
    expect(decodeManifest(encodeHeader(s).slice(12)).library.profile).toEqual(s.profile);
  });
  it("omits the full name line when no nickname is filled", () => {
    expect(fullNameLine("林知夏", "小夏")).toBe("林知夏 · 小名小夏");
    expect(fullNameLine("林知夏", "")).toBe("");
    expect(fullNameLine("林知夏", "  ")).toBe("");
  });
});

describe("device-only transcription consent", () => {
  it.each([true, false, undefined])("accepts optional boolean %s", (value) => {
    const s = fixture();
    s.settings.transcribeConsent = value;
    expect(() => validateLibrary(s)).not.toThrow();
  });
  it("rejects a string consent", () => {
    const s = fixture();
    Object.assign(s.settings, { transcribeConsent: "yes" });
    expect(() => validateLibrary(s)).toThrow();
  });
});

it("accepts the legacy story field on an existing record", () => {
  const s = fixture();
  saveRecord(s, "draft", "legacy", date);
  s.records.legacy = { ...s.records.legacy!, story: "birth" };
  expect(() => validateLibrary(s)).not.toThrow();
});

describe("device-local daily question cache validation", () => {
  it("accepts a valid optional cache", () => {
    const state = emptyLibrary();
    state.settings.dailyQuestion = { requestedDay: "2026-09-21", day: "2026-09-21", question: "她今天说了什么？", asked: [{ day: "2026-09-20", question: "谁来看她？" }] };
    expect(() => validateLibrary(state)).not.toThrow();
  });
  it.each(["2026-9-21", "not-a-date", "2026-02-30", "2026-13-01"])("rejects invalid calendar day %s", (date) => {
    const state = emptyLibrary();
    state.settings.dailyQuestion = { requestedDay: date, asked: [] };
    expect(() => validateLibrary(state)).toThrow();
    state.settings.dailyQuestion = { requestedDay: "2026-09-21", day: date, asked: [] };
    expect(() => validateLibrary(state)).toThrow();
    state.settings.dailyQuestion = { requestedDay: "2026-09-21", asked: [{ day: date, question: "问题" }] };
    expect(() => validateLibrary(state)).toThrow();
  });
  it("rejects oversized questions and history", () => {
    const state = emptyLibrary();
    state.settings.dailyQuestion = { requestedDay: "2026-09-21", question: "问".repeat(61), asked: [] };
    expect(() => validateLibrary(state)).toThrow();
    state.settings.dailyQuestion = { requestedDay: "2026-09-21", asked: Array.from({ length: 15 }, () => ({ day: "2026-09-21", question: "问题" })) };
    expect(() => validateLibrary(state)).toThrow();
  });
});


describe("annual editor directory", () => {
  const picks = (): YearPicks => ({ title: "窗边的小脚", months: { "2026-09": { recordIds: ["record"], quote: { recordId: "record", text: "伸出小脚" } } }, notes: "每月挑几段。", updatedAt: "2026-09-21T10:00:00.000Z" });
  it("accepts valid directories and roundtrips the .xmbm root and entities", () => {
    const s = fixture();
    s.yearPicks = { "2026": picks() };
    validateLibrary(s);
    const entities = encodeEntities(s);
    const count = new TextDecoder().decode(entities).trimEnd().split("\n").length;
    const header = encodeMetaV2(s, entities.length, count, { magic: BACKUP_MAGIC_V3 });
    expect(new TextDecoder().decode(header.slice(0, 8))).toBe("XIAOMEI3");
    expect(decodeLibraryV2(decodeMetaV2(header.slice(12)), entities)).toEqual(s);
    const fork = forkLibrary(s);
    expect(fork.yearPicks).not.toBe(s.yearPicks);
    expect(fork.yearPicks!["2026"]).toBe(s.yearPicks["2026"]);
    delete fork.yearPicks!["2026"];
    expect(s.yearPicks["2026"]).toEqual(picks());
  });
  const bad: Record<string, (s: Library) => void> = {
    year: s => { s.yearPicks = { "26": picks() }; },
    monthYear: s => { s.yearPicks!["2026"]!.months = { "2025-09": { recordIds: ["r"] } }; },
    monthNumber: s => { s.yearPicks!["2026"]!.months = { "2026-13": { recordIds: ["r"] } }; },
    fourPicks: s => { s.yearPicks!["2026"]!.months["2026-09"]!.recordIds = ["a", "b", "c", "d"]; },
    emptyPicks: s => { s.yearPicks!["2026"]!.months["2026-09"]!.recordIds = []; },
    badId: s => { s.yearPicks!["2026"]!.months["2026-09"]!.recordIds = ["坏 id"]; },
    duplicate: s => { s.yearPicks!["2026"]!.months["2026-10"] = { recordIds: ["record"] }; },
    quote: s => { s.yearPicks!["2026"]!.months["2026-09"]!.quote!.text = "字".repeat(41); },
    untrimmedQuote: s => { s.yearPicks!["2026"]!.months["2026-09"]!.quote!.text = " 原句 "; },
    quoteId: s => { s.yearPicks!["2026"]!.months["2026-09"]!.quote!.recordId = "坏 id"; },
    title: s => { s.yearPicks!["2026"]!.title = "字".repeat(21); },
    emptyTitle: s => { s.yearPicks!["2026"]!.title = ""; },
    untrimmedTitle: s => { s.yearPicks!["2026"]!.title = " 小脚 "; },
    notes: s => { s.yearPicks!["2026"]!.notes = "字".repeat(201); },
    updatedAt: s => { s.yearPicks!["2026"]!.updatedAt = "not a date"; },
    nonIso: s => { s.yearPicks!["2026"]!.updatedAt = "2026"; },
    nullYear: s => { (s.yearPicks as Record<string, unknown>)["2026"] = null; },
    nullMonths: s => { (s.yearPicks!["2026"] as unknown as Record<string, unknown>).months = null; },
  };
  it.each(Object.keys(bad))("rejects %s instead of dropping the bad value", (key) => {
    const s = fixture(); s.yearPicks = { "2026": picks() }; bad[key]!(s);
    expect(() => validateLibrary(s)).toThrow();
  });
  it("allows a title-only directory after the family removes every month", () => {
    const s = fixture(); s.yearPicks = { "2026": { title: "小脚", months: {}, updatedAt: picks().updatedAt } };
    expect(() => validateLibrary(s)).not.toThrow();
  });
});
