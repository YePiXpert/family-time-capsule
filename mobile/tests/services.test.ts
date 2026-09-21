import { describe, expect, it } from "vitest";
import {
  appendToAlbum,
  clone,
  emptyLibrary,
  newAlbumFrom,
  validateLibrary,
  type Library,
} from "../src/local/model";
import { LocalStore } from "../src/local/store";

const date = "2026-09-16T12:00:00.000Z";
const later = "2026-09-20T09:00:00.000Z";
let seq = 0;
const nextId = () => `id${++seq}`;
/** 两条记录（r1 带一张照片）和一本已含 r1 的相册。 */
function fixture(): Library {
  const lib = emptyLibrary();
  lib.media.photo = {
    id: "photo",
    file: "photo.jpg",
    name: "baby.jpg",
    kind: "image",
    bytes: 8,
    sha256: "a".repeat(64),
  };
  for (const id of ["r1", "r2"])
    lib.records[id] = {
      id,
      title: "",
      text: `记下 ${id}`,
      date,
      location: "",
      first: false,
      mediaIds: id === "r1" ? ["photo"] : [],
      coverId: id === "r1" ? "photo" : null,
      revision: 1,
      updatedAt: date,
    };
  lib.albums.a = {
    id: "a",
    name: "夏天",
    items: [{ id: "i1", recordId: "r1" }],
    coverId: null,
    updatedAt: date,
  };
  return lib;
}

describe("adding records to albums from the reading page", () => {
  it("appends only records the album does not already hold", () => {
    const s = fixture();
    const album = appendToAlbum(s, "a", ["r1", "r2", "r2"], nextId, later);
    expect(album.name).toBe("夏天");
    expect(album.items.map((i) => i.recordId)).toEqual(["r1", "r2"]);
    expect(album.updatedAt).toBe(later);
    expect(s.albums.a).toBe(album);
    validateLibrary(s);
    // 再加一遍不重复，也不动 updatedAt。
    const again = appendToAlbum(
      s,
      "a",
      ["r2"],
      nextId,
      "2026-09-21T00:00:00.000Z",
    );
    expect(again.items).toHaveLength(2);
    expect(again.updatedAt).toBe(later);
  });
  it("creates a new album holding the records, with the first record's cover", () => {
    const s = fixture();
    const album = newAlbumFrom(s, "b", ["r1", "r2"], nextId, later);
    expect(album.name).toBe("新相册");
    expect(album.items.map((i) => i.recordId)).toEqual(["r1", "r2"]);
    expect(album.coverId).toBe("photo");
    expect(s.albums.b).toBe(album);
    const named = newAlbumFrom(s, "c", ["r2"], nextId, later, " 秋天 ");
    expect(named.name).toBe("秋天");
    expect(named.coverId).toBeNull();
    validateLibrary(s);
  });
  it("refuses missing albums and missing records", () => {
    const s = fixture();
    expect(() => appendToAlbum(s, "nope", ["r1"], nextId, later)).toThrow(
      "相册已删除",
    );
    expect(() => appendToAlbum(s, "a", ["gone"], nextId, later)).toThrow(
      "这段时光已删除",
    );
    expect(() => newAlbumFrom(s, "b", [], nextId, later)).toThrow("请先选择");
    expect(() => newAlbumFrom(s, "b", ["gone"], nextId, later)).toThrow(
      "这段时光已删除",
    );
    expect(Object.keys(s.albums)).toEqual(["a"]);
    expect(s.albums.a!.items).toHaveLength(1);
  });
  it("persists through the store like any other change", async () => {
    let disk: Library = fixture();
    const store = new LocalStore({
      read: async () => disk,
      write: async (next) => {
        disk = clone(next);
      },
    });
    await store.open();
    const id = await store.change(
      (s) => newAlbumFrom(s, "b", ["r2"], nextId, later).id,
    );
    await store.change((s) => appendToAlbum(s, id, ["r1"], nextId, later));
    expect(disk.albums.b!.items.map((i) => i.recordId)).toEqual(["r2", "r1"]);
    await expect(
      store.change((s) => appendToAlbum(s, "gone", ["r1"], nextId, later)),
    ).rejects.toThrow("相册已删除");
    expect(Object.keys(disk.albums).sort()).toEqual(["a", "b"]);
  });
});

