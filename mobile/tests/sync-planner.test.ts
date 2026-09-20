import { expect, it } from "vitest";
import {
  CHUNK_BYTES,
  OBJECT_BYTES,
  bytesLabel,
  chunkSizes,
  objectsOf,
  pendingOf,
  planUpload,
  progressLabel,
} from "../src/sync/planner";
const sha = (n: number) => n.toString(16).padStart(2, "0").repeat(32);
it("splits content into 4 MiB objects and marks the last one final", () => {
  expect(objectsOf(sha(1), 1)).toEqual([
    { sha256: sha(1), part: 0, from: 0, bytes: 1, final: true },
  ]);
  expect(objectsOf(sha(1), OBJECT_BYTES)).toEqual([
    { sha256: sha(1), part: 0, from: 0, bytes: OBJECT_BYTES, final: true },
  ]);
  const plans = objectsOf(sha(2), OBJECT_BYTES * 2 + 5);
  expect(plans.map((p) => [p.part, p.from, p.bytes, p.final])).toEqual([
    [0, 0, OBJECT_BYTES, false],
    [1, OBJECT_BYTES, OBJECT_BYTES, false],
    [2, OBJECT_BYTES * 2, 5, true],
  ]);
  expect(() => objectsOf(sha(1), 0)).toThrow("长度");
});
it("cuts an object into whole MiB chunks plus a tail", () => {
  expect(chunkSizes(1)).toEqual([1]);
  expect(chunkSizes(CHUNK_BYTES)).toEqual([CHUNK_BYTES]);
  expect(chunkSizes(CHUNK_BYTES * 2 + 3)).toEqual([
    CHUNK_BYTES,
    CHUNK_BYTES,
    3,
  ]);
  expect(chunkSizes(OBJECT_BYTES)).toHaveLength(4);
});
it("plans every object of every blob in a fixed order with derived ids", () => {
  const items = planUpload(
    [
      { sha256: sha(3), bytes: OBJECT_BYTES + 1 },
      { sha256: sha(4), bytes: 10 },
    ],
    (s, part) => `${s.slice(0, 4)}-${part}`,
  );
  expect(items.map((i) => i.id)).toEqual(["0303-0", "0303-1", "0404-0"]);
  expect(items[1]).toMatchObject({
    part: 1,
    from: OBJECT_BYTES,
    bytes: 1,
    final: true,
  });
  expect(pendingOf(items, new Set(["0404-0"])).map((i) => i.id)).toEqual([
    "0404-0",
  ]);
  expect(pendingOf(items, new Set())).toEqual([]);
});
it("labels progress and sizes for the card", () => {
  expect(progressLabel(3, 12)).toBe("正在上传 3/12");
  expect(bytesLabel(0)).toBe("0.1 MB");
  expect(bytesLabel(52428800)).toBe("50.0 MB");
  expect(bytesLabel(3.5 * 1024 ** 3)).toBe("3.5 GB");
});
