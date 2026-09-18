import { describe, expect, it } from "vitest";
import {
  emptyContent,
  type Mutable,
  type RecordDraft,
} from "../src/local/model";
import {
  applyPhotoMetadata,
  readPhotoMetadata,
  photoDayGroups,
  movePhotoToEvent,
  savePhotoDays,
} from "../src/local/photo-metadata";

import { emptyLibrary, validateLibrary } from "../src/local/model";
import { LocalStore } from "../src/local/store";
/** 测试里的库都是现造现用的裸对象，没进过 store、没被冻结，可以直接改。 */
const mut = <T,>(value: T): Mutable<T> => value as Mutable<T>;

const draft = (): RecordDraft => ({
  id: "draft",
  recordId: null,
  baseRevision: 0,
  content: emptyContent(),
  updatedAt: new Date().toISOString(),
  autoDate: true,
  autoLocation: true,
});

describe("photo capture metadata", () => {
  it("uses the birth photo's calendar day without timezone shifting or export date", () => {
    const metadata = readPhotoMetadata({
      DateTimeOriginal: "2020:02:29 00:10:00",
      OffsetTimeOriginal: "+14:00",
      DateTime: "2026:09:16 10:00:00",
    });
    expect(applyPhotoMetadata(draft(), metadata).content.date).toBe(
      "2020-02-29T00:10:00",
    );
  });
  it("rejects missing and malformed capture dates, with digitized fallback", () => {
    for (const value of [
      null,
      {},
      { DateTime: "2026:09:16 10:00:00" },
      { DateTimeOriginal: "2023:02:29 10:00:00" },
      { DateTimeOriginal: "2020:01:01 25:00:00" },
    ])
      expect(readPhotoMetadata(value)).toBeUndefined();
    expect(
      readPhotoMetadata({
        DateTimeOriginal: "bad",
        DateTimeDigitized: "2020:01:01 12:00:00",
      })?.capturedAt,
    ).toBe("2020-01-01T12:00:00");
  });
  it("handles iOS hemisphere refs, Android signed coordinates and zero", () => {
    expect(
      readPhotoMetadata({
        GPSLatitude: 33,
        GPSLatitudeRef: "S",
        GPSLongitude: 70,
        GPSLongitudeRef: "W",
      }),
    ).toEqual({ latitude: -33, longitude: -70 });
    expect(readPhotoMetadata({ GPSLatitude: -33, GPSLongitude: -70 })).toEqual({
      latitude: -33,
      longitude: -70,
    });
    expect(readPhotoMetadata({ GPSLatitude: 0, GPSLongitude: 0 })).toEqual({
      latitude: 0,
      longitude: 0,
    });
    for (const values of [
      { GPSLatitude: 91, GPSLongitude: 0 },
      { GPSLatitude: NaN, GPSLongitude: 0 },
      { GPSLatitude: 5 },
    ])
      expect(readPhotoMetadata(values)).toBeUndefined();
  });
  it("uses the first valid value for each field across imports and draft reopen", () => {
    const original = draft();
    expect(applyPhotoMetadata(original, undefined)).toBe(original);
    const first = applyPhotoMetadata(original, {
      capturedAt: "2020-01-01T12:00:00",
    });
    const reopened = JSON.parse(JSON.stringify(first));
    const second = applyPhotoMetadata(reopened, {
      capturedAt: "2021-01-01T12:00:00",
      latitude: 30,
      longitude: 120,
    });
    expect(second.content.date).toBe("2020-01-01T12:00:00");
    expect(second.content.location).toBe("30.000000, 120.000000");
    expect(original.content.location).toBe("");
  });
  it("gives a shared-photo draft its capture day and place like an imported one", () => {
    const shared = { ...draft(), groupPhotosByDay: true };
    const applied = applyPhotoMetadata(shared, {
      capturedAt: "2025-06-01T10:20:30",
      latitude: -33,
      longitude: -70,
    });
    expect(applied.content.date).toBe("2025-06-01T10:20:30");
    expect(applied.content.location).toBe("-33.000000, -70.000000");
    expect(applied.autoDate).toBe(false);
    expect(applied.autoLocation).toBe(false);
    expect(applied.groupPhotosByDay).toBe(true);
  });
  it("preserves manual choices, existing records, and legacy drafts", () => {
    const metadata = {
      capturedAt: "2020-01-01T12:00:00",
      latitude: 30,
      longitude: 120,
    };
    for (const d of [
      { ...draft(), autoDate: false, autoLocation: false },
      { ...draft(), recordId: "record" },
      { ...draft(), autoDate: undefined, autoLocation: undefined },
    ]) {
      expect(applyPhotoMetadata(d, metadata).content).toEqual(d.content);
    }
  });
});
function batchFixture() {
  const s = emptyLibrary();
  for (const [id, capturedAt] of [
    ["a", "2020-01-01T08:00:00"],
    ["b", "2020-01-01T16:00:00"],
    ["c", "2020-01-02T12:00:00"],
    ["unknown", undefined],
  ] as const) {
    s.media[id] = {
      id,
      file: `${id}.jpg`,
      name: `${id}.jpg`,
      kind: "image",
      bytes: 1,
      sha256: "a".repeat(64),
      photoMetadata: capturedAt ? { capturedAt } : undefined,
    };
  }
  s.drafts.draft = {
    ...draft(),
    groupPhotosByDay: true,
    content: {
      ...emptyContent(),
      mediaIds: ["a", "b", "c", "unknown"],
      coverId: "b",
    },
  };
  return s;
}
describe("batch photo events", () => {
  it("suggests days and folds undated media into the nearest neighbor day", () => {
    const s = batchFixture();
    const groups = photoDayGroups(s.drafts.draft!, s.media);
    expect(groups.map((g) => g.mediaIds)).toEqual([
      ["a", "b"],
      ["c", "unknown"],
    ]);
    expect(groups[0]!.coverId).toBe("b");
    expect(groups[0]!.date.slice(0, 10)).toBe("2020-01-01");
  });
  it("keeps draft title and text in the first day group only", () => {
    const s = batchFixture();
    const d = s.drafts.draft!;
    d.content.title = "生日聚会";
    d.content.text = "小美吹蜡烛";
    const groups = photoDayGroups(d, s.media);
    expect(groups[0]!.title).toBe("生日聚会");
    expect(groups[0]!.text).toBe("小美吹蜡烛");
    expect(
      groups.slice(1).every((g) => g.title === "" && g.text === ""),
    ).toBe(true);
  });
  it("groups an undated video with its neighboring photo day", () => {
    const s = batchFixture();
    s.media.video = {
      id: "video",
      file: "video.mp4",
      name: "video.mp4",
      kind: "video",
      bytes: 1,
      sha256: "b".repeat(64),
    };
    const d = s.drafts.draft!;
    d.content.mediaIds = ["a", "b", "video", "c"];
    const groups = photoDayGroups(d, s.media);
    expect(groups.map((g) => g.mediaIds)).toEqual([["a", "b", "video"], ["c"]]);
    expect(groups[0]!.date.slice(0, 10)).toBe("2020-01-01");
  });
  it("keeps one undated group when the whole batch lacks capture times", () => {
    const s = batchFixture();
    const d = s.drafts.draft!;
    d.content.mediaIds = ["unknown"];
    const groups = photoDayGroups(d, s.media);
    expect(groups.map((g) => g.mediaIds)).toEqual([["unknown"]]);
  });
  it("splits same-day events, edits independently, and persists a reopened batch", () => {
    const s = batchFixture();
    const groups = movePhotoToEvent(
      photoDayGroups(s.drafts.draft!, s.media),
      "b",
      "new",
      s.media,
    );
    groups[0]!.title = "打疫苗";
    groups[2]!.title = "去公园";
    groups[2]!.text = "下午散步";
    mut(s.drafts.draft!).photoEvents = groups;
    const restored = JSON.parse(JSON.stringify(s));
    validateLibrary(restored);
    let counter = 0;
    const records = savePhotoDays(
      restored,
      "draft",
      () => `record${counter++}`,
      new Date().toISOString(),
    );
    validateLibrary(restored);
    expect(records).toHaveLength(3);
    expect(records[0]!.title).toBe("打疫苗");
    expect(records[2]!.title).toBe("去公园");
    expect(records[2]!.text).toBe("下午散步");
    expect(records[0]!.date.slice(0, 10)).toBe(records[2]!.date.slice(0, 10));
    expect(restored.drafts.draft).toBeUndefined();
  });
  it("moves photos once, handles removal and later imports without losing event edits", () => {
    const s = batchFixture();
    const d = s.drafts.draft!;
    mut(d).photoEvents = movePhotoToEvent(
      photoDayGroups(d, s.media),
      "b",
      1,
      s.media,
    );
    d.photoEvents![1]!.text = "一起记录";
    d.content.mediaIds = ["b", "c", "unknown"];
    const groups = photoDayGroups(d, s.media);
    expect(groups.map((g) => g.mediaIds)).toEqual([["c", "unknown", "b"]]);
    expect(groups[0]!.text).toBe("一起记录");
    d.content.mediaIds.push("a");
    expect(
      photoDayGroups(d, s.media)
        .flatMap((g) => g.mediaIds)
        .sort(),
    ).toEqual(["a", "b", "c", "unknown"]);
  });
  it("does not merge into existing same-day records or split an edited record", () => {
    const s = batchFixture();
    s.records.existing = {
      ...emptyContent(),
      id: "existing",
      revision: 1,
      updatedAt: new Date().toISOString(),
      date: "2020-01-01T12:00:00",
      text: "已有记录",
    };
    let counter = 0;
    savePhotoDays(
      s,
      "draft",
      () => `record${counter++}`,
      new Date().toISOString(),
    );
    expect(s.records.existing!.text).toBe("已有记录");
    expect(Object.keys(s.records)).toHaveLength(3);
    const d = {
      ...draft(),
      recordId: "existing",
      groupPhotosByDay: true,
      content: { ...emptyContent(), mediaIds: ["a", "c"] },
    };
    expect(photoDayGroups(d, s.media)).toHaveLength(1);
  });
  it("keeps the entire draft when batch disk persistence fails", async () => {
    const s = batchFixture();
    const store = new LocalStore({
      read: async () => s,
      write: async () => {
        throw new Error("disk full");
      },
    });
    await store.open();
    let counter = 0;
    await expect(
      store.change((next) =>
        savePhotoDays(
          next,
          "draft",
          () => `record${counter++}`,
          new Date().toISOString(),
        ),
      ),
    ).rejects.toThrow("disk full");
    expect(store.get().drafts.draft!.content.mediaIds).toHaveLength(4);
    expect(Object.keys(store.get().records)).toHaveLength(0);
  });
});
