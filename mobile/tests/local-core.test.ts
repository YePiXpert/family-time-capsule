import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  clone,
  deleteRecord,
  emptyContent,
  emptyLibrary,
  finishSelection,
  monthOfItem,
  recordsOfPerson,
  referencedMedia,
  saveRecord,
  validateLibrary,
  type Library,
 LocalMedia } from "../src/local/model";
import { LocalStore } from "../src/local/store";
import { decodeManifest, encodeHeader } from "../src/local/backup-format";
import {
  ageLine,
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
      content: { ...clone(s.records.record!), text: "补记" },
      updatedAt: date,
    };
    expect(s.records.record!.text).toBe("第一次挥手");
    saveRecord(s, "edit", "unused", date);
    expect(Object.keys(s.records)).toEqual(["record"]);
    expect(s.records.record!.revision).toBe(2);
    expect(s.records.record!.text).toBe("补记");
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
    s.drafts.draft!.content = emptyContent();
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
    s.profile = { name: "小美", birthday: "2025-09-10", avatarId: "photo" };
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
      s.media.photo!.file = file;
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
  it("rejects unsupported versions and active recording snapshots", () => {
    const s = fixture();
    s.drafts.draft!.recordingFile = "recording-test.m4a";
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
  });
});

describe("last export timestamp", () => {
  it("roundtrips the timestamp through the backup manifest", () => {
    const s = fixture();
    s.lastExportAt = "2026-09-01T08:00:00.000Z";
    validateLibrary(s);
    expect(
      decodeManifest(encodeHeader(s).slice(12)).library.lastExportAt,
    ).toBe("2026-09-01T08:00:00.000Z");
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
    expect(decodeManifest(encodeHeader(s).slice(12)).library.albums.a?.note).toBe(
      "这一年的照片，都在这里。",
    );
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
    expect(() =>
      validateLibrary({ ...s, albums: { a: nonString } }),
    ).toThrow();
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
      placeLabel({ city: "上海市", district: "虹口区", street: "四川北路" }, "x"),
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
    expect(decodeManifest(encodeHeader(s).slice(12)).library.series.grow!).toEqual(
      s.series.grow,
    );
  });
  it("rejects duplicate months, dangling media and non-image media", () => {
    const dup = seriesFixture();
    dup.records.two = { ...dup.records.r!, id: "two" };
    dup.series.grow!.items.push({
      recordId: "two",
      mediaId: "photo",
      month: "2026-09",
    });
    expect(() => validateLibrary(dup)).toThrow();
    const dangling = seriesFixture();
    dangling.series.grow!.items = [
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
    outside.series.grow!.items = [
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
    overlong.series.grow!.name = "长".repeat(101);
    expect(() => validateLibrary(overlong)).toThrow();
    const empty = seriesFixture();
    empty.series.grow!.items = [];
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
    s.records.r!.personIds = ["mom", "grandma"];
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
    unknown.records.r!.personIds = ["missing"];
    expect(() => validateLibrary(unknown)).toThrow();
    const duplicate = personFixture();
    duplicate.records.r!.personIds = ["mom", "mom"];
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
    delete bare.records.r!.personIds;
    validateLibrary(bare);
    const legacy = clone(personFixture()) as Partial<Library>;
    delete legacy.persons;
    legacy.records!.r!.personIds = undefined;
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
    expect(recordsOfPerson(records, "grandma").map((r) => r.id)).toEqual([
      "r",
    ]);
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
