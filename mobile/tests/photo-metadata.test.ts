import { describe, expect, it } from "vitest";
import {
  emptyContent,
  type RecordDraft,
} from "../src/local/model";
import {
  applyPhotoMetadata,
  readPhotoMetadata,
} from "../src/local/photo-metadata";

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
    const shared = draft();
    const applied = applyPhotoMetadata(shared, {
      capturedAt: "2025-06-01T10:20:30",
      latitude: -33,
      longitude: -70,
    });
    expect(applied.content.date).toBe("2025-06-01T10:20:30");
    expect(applied.content.location).toBe("-33.000000, -70.000000");
    expect(applied.autoDate).toBe(false);
    expect(applied.autoLocation).toBe(false);
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
