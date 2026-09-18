import { describe, expect, it } from "vitest";
import { replayPhotos, REPLAY_LIMIT } from "../src/local/replay";
import {
  emptyContent,
  type Library,
  type LocalRecord,
} from "../src/local/model";

function libraryWithPhotos(): { library: Library; mediaId: (n: number) => string } {
  const s: Library = {
    version: 1,
    revision: 0,
    welcome: false,
    profile: { name: "", birthday: "", avatarId: null },
    settings: { theme: "auto", largeText: false },
    records: {},
    drafts: {},
    media: {},
    albums: {},
    selections: {},
    series: {},
    persons: {},
    yearNotes: {},
    receivedShares: [],
  };
  return { library: s, mediaId: (n) => `img${n}` };
}

function photo(id: string) {
  return {
    id,
    file: `${id}.jpg`,
    name: `${id}.jpg`,
    kind: "image" as const,
    bytes: 4,
    sha256: id.padEnd(64, "0").slice(0, 64),
  };
}

function record(
  id: string,
  date: string,
  mediaIds: string[],
  first = false,
): LocalRecord {
  return {
    ...emptyContent(),
    title: `记录${id}`,
    text: "",
    date,
    mediaIds,
    coverId: null,
    id,
    revision: 1,
    updatedAt: date,
    first,
  };
}

describe("annual replay selection", () => {
  it("covers each month once with the earliest photo, sorted by date", () => {
    const { library, mediaId } = libraryWithPhotos();
    library.media[mediaId(1)] = photo(mediaId(1));
    library.media[mediaId(2)] = photo(mediaId(2));
    library.media[mediaId(3)] = photo(mediaId(3));
    library.records.a = record("a", "2026-01-10T09:00:00.000Z", [mediaId(1)]);
    library.records.b = record("b", "2026-01-25T09:00:00.000Z", [mediaId(2)]);
    library.records.c = record("c", "2026-03-05T09:00:00.000Z", [mediaId(3)]);
    const slides = replayPhotos(Object.values(library.records), library.media);
    expect(slides.map((s) => s.mediaId)).toEqual([mediaId(1), mediaId(3)]);
    expect(slides.map((s) => s.caption)).toEqual(["记录a", "记录c"]);
  });
  it("prioritizes firsts and never repeats the same photo", () => {
    const { library, mediaId } = libraryWithPhotos();
    library.media[mediaId(1)] = photo(mediaId(1));
    library.records.later = record(
      "later",
      "2026-02-01T09:00:00.000Z",
      [mediaId(1)],
    );
    library.records.first = record(
      "first",
      "2026-02-20T09:00:00.000Z",
      [mediaId(1)],
      true,
    );
    const slides = replayPhotos(Object.values(library.records), library.media);
    // 同月同图：第一次的代表这一月，不重复进片。
    expect(slides).toHaveLength(1);
    expect(slides[0]!.caption).toBe("记录first");
  });
  it("caps the slideshow and keeps the earliest slides", () => {
    const { library, mediaId } = libraryWithPhotos();
    for (let i = 0; i < REPLAY_LIMIT + 4; i++) {
      const id = mediaId(i);
      library.media[id] = photo(id);
      library.records[`r${i}`] = record(
        `r${i}`,
        `2026-01-${String(((i % 28) + 1)).padStart(2, "0")}T09:00:00.000Z`,
        [id],
        true,
      );
    }
    const slides = replayPhotos(Object.values(library.records), library.media);
    expect(slides).toHaveLength(REPLAY_LIMIT);
    expect(slides[0]!.date <= slides[1]!.date).toBe(true);
  });
  it("returns nothing for years without photos and skips non-image media", () => {
    const { library } = libraryWithPhotos();
    library.media.doc = {
      id: "doc",
      file: "doc.pdf",
      name: "doc.pdf",
      kind: "document",
      bytes: 4,
      sha256: "d".repeat(64),
    };
    library.records.a = record("a", "2026-05-01T09:00:00.000Z", ["doc"]);
    expect(replayPhotos(Object.values(library.records), library.media)).toEqual(
      [],
    );
  });
});
