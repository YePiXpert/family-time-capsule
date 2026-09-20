import { describe, expect, it } from "vitest";
import {
  BACKUP_MAGIC_V2,
  BACKUP_MAGIC_V3,
  VOLUME_LIMIT,
  decodeMetaV2,
  encodeMetaV2,
  planVolumes,
  type BackupBlob,
  type BackupSet,
} from "../src/local/backup-format";
import { emptyLibrary, type Library } from "../src/local/model";

const blob = (n: number, bytes: number): BackupBlob => ({
  sha256: n.toString(16).padStart(64, "0"),
  bytes,
});
function library(): Library {
  const lib = emptyLibrary();
  lib.welcome = true;
  lib.media.a = {
    id: "a",
    file: "a.jpg",
    name: "a.jpg",
    kind: "image",
    bytes: 10,
    sha256: "a".repeat(64),
  };
  return lib;
}
const metaOf = (head: Uint8Array) =>
  decodeMetaV2(
    head.subarray(
      12,
      12 + new DataView(head.buffer, head.byteOffset).getUint32(8),
    ),
  );

describe("planVolumes", () => {
  it("keeps everything in one volume when it fits", () => {
    expect(planVolumes([blob(1, 100), blob(2, 200)], 50, 1000)).toEqual([
      { from: 0, take: 2, bytes: 350 },
    ]);
  });
  it("opens a new volume when the next blob would overflow and never splits a blob", () => {
    expect(
      planVolumes(
        [blob(1, 600), blob(2, 300), blob(3, 300), blob(4, 100)],
        50,
        1000,
      ),
    ).toEqual([
      { from: 0, take: 2, bytes: 950 },
      { from: 2, take: 2, bytes: 450 },
    ]);
  });
  it("gives an oversized blob a volume of its own without dropping it", () => {
    expect(
      planVolumes([blob(1, 100), blob(2, 5000), blob(3, 100)], 50, 1000),
    ).toEqual([
      { from: 0, take: 1, bytes: 150 },
      { from: 1, take: 1, bytes: 5050 },
      { from: 2, take: 1, bytes: 150 },
    ]);
  });
  it("plans one volume for an empty library and defaults to the 2 GiB limit", () => {
    expect(planVolumes([], 40)).toEqual([{ from: 0, take: 0, bytes: 40 }]);
    expect(VOLUME_LIMIT).toBe(2 * 1024 ** 3);
    const many = Array.from({ length: 5 }, (_, i) => blob(i, 1024 ** 3));
    expect(planVolumes(many, 0).map((v) => v.take)).toEqual([2, 2, 1]);
  });
});

describe("meta with volume sets", () => {
  it("writes no set field for a single volume so old readers see the same shape", () => {
    const head = encodeMetaV2(library(), 5, 1, {
      createdAt: "2026-09-20T00:00:00.000Z",
    });
    expect([...head.subarray(0, 8)]).toEqual([...BACKUP_MAGIC_V2]);
    const json = new TextDecoder().decode(head.subarray(12));
    expect(json).not.toContain('"set"');
    expect(metaOf(head)).toMatchObject({
      version: 2,
      createdAt: "2026-09-20T00:00:00.000Z",
      blobs: [{ sha256: "a".repeat(64), bytes: 10 }],
    });
  });
  it("round-trips a set and the manifest magic", () => {
    const set: BackupSet = {
      id: "0badf00d",
      index: 1,
      count: 3,
      from: 1,
      take: 0,
    };
    const head = encodeMetaV2(library(), 5, 1, { set, magic: BACKUP_MAGIC_V3 });
    expect([...head.subarray(0, 8)]).toEqual([...BACKUP_MAGIC_V3]);
    expect(metaOf(head).set).toEqual(set);
  });
  it("rejects malformed sets", () => {
    const good = encodeMetaV2(library(), 5, 1, {
      set: { id: "0badf00d", index: 0, count: 1, from: 0, take: 1 },
    });
    const json = JSON.parse(
      new TextDecoder().decode(good.subarray(12)),
    ) as Record<string, unknown>;
    const bad = (set: unknown) =>
      decodeMetaV2(new TextEncoder().encode(JSON.stringify({ ...json, set })));
    for (const set of [
      { id: "xyz", index: 0, count: 1, from: 0, take: 1 },
      { id: "0badf00d", index: 1, count: 1, from: 0, take: 1 },
      { id: "0badf00d", index: 0, count: 1, from: 0, take: 2 },
      { id: "0badf00d", index: 0, count: 0, from: 0, take: 0 },
      "nope",
    ])
      expect(() => bad(set)).toThrow("不是受支持");
    expect(bad(undefined).set).toBeUndefined();
  });
});
