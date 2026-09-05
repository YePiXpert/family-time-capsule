/** Shared by restore and the standalone verifier. No database or authentication imports. */
export const COLLECTION_FILES = [
  "collections.json",
  "collection-sections.json",
  "collection-items.json",
];
export function validateCollectionArchive(
  collections,
  sections,
  items,
  familyId,
  eventIds,
  assetIds,
) {
  const fail = () => {
    throw new Error("Invalid collection archive graph");
  };
  const text = (v, max, min = 0) =>
    typeof v === "string" && v.length <= max && v.trim().length >= min;
  const date = (v) =>
    typeof v === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(v) &&
    Number.isFinite(Date.parse(v)) &&
    new Date(v).toISOString().slice(0, 10) === v;
  const instant = (v) =>
    typeof v === "string" && Number.isFinite(Date.parse(v));
  const map = (rows, keys) => {
    if (!Array.isArray(rows) || rows.length > 100000) fail();
    const result = new Map();
    for (const row of rows) {
      if (
        !row ||
        typeof row !== "object" ||
        !text(row.id, 128, 1) ||
        result.has(row.id) ||
        row.familyId !== familyId ||
        Object.keys(row).some((k) => !keys.includes(k))
      )
        fail();
      result.set(row.id, row);
    }
    return result;
  };
  const cs = map(collections, [
    "id",
    "familyId",
    "kind",
    "title",
    "description",
    "coverAssetId",
    "startDate",
    "endDate",
    "sortMode",
    "revision",
    "deletedAt",
    "createdAt",
    "updatedAt",
  ]);
  const ss = map(sections, [
    "id",
    "familyId",
    "collectionId",
    "title",
    "position",
  ]);
  map(items, [
    "id",
    "familyId",
    "collectionId",
    "sectionId",
    "memoryEventId",
    "caption",
    "position",
  ]);
  for (const c of collections) {
    if (
      !["album", "chapter"].includes(c.kind) ||
      !text(c.title, 200, 1) ||
      !text(c.description, 5000) ||
      !["manual", "time"].includes(c.sortMode) ||
      !Number.isSafeInteger(c.revision) ||
      c.revision < 1 ||
      !instant(c.createdAt) ||
      !instant(c.updatedAt) ||
      (c.deletedAt !== null && !instant(c.deletedAt))
    )
      fail();
    if (
      (c.coverAssetId !== null && !assetIds.has(c.coverAssetId)) ||
      (c.startDate !== null && !date(c.startDate)) ||
      (c.endDate !== null && !date(c.endDate)) ||
      (c.startDate && c.endDate && c.startDate > c.endDate)
    )
      fail();
  }
  for (const s of sections) {
    if (
      !cs.has(s.collectionId) ||
      cs.get(s.collectionId).kind !== "chapter" ||
      !text(s.title, 200, 1) ||
      !Number.isSafeInteger(s.position) ||
      s.position < 0
    )
      fail();
  }
  const seenSources = new Set();
  for (const i of items) {
    if (
      !cs.has(i.collectionId) ||
      !text(i.caption, 2000) ||
      !Number.isSafeInteger(i.position) ||
      i.position < 0 ||
      (i.sectionId !== null &&
        ss.get(i.sectionId)?.collectionId !== i.collectionId) ||
      (i.memoryEventId !== null && !eventIds.has(i.memoryEventId))
    )
      fail();
    if (i.memoryEventId !== null) {
      const key = JSON.stringify([i.collectionId, i.memoryEventId]);
      if (seenSources.has(key)) fail();
      seenSources.add(key);
    }
  }
  for (const [rows, limit] of [
    [sections, 20],
    [items, 500],
  ]) {
    const groups = new Map();
    for (const row of rows) {
      const positions = groups.get(row.collectionId) || [];
      positions.push(row.position);
      groups.set(row.collectionId, positions);
    }
    for (const positions of groups.values()) {
      positions.sort((a, b) => a - b);
      if (positions.length > limit || positions.some((p, i) => p !== i)) fail();
    }
  }
  return { collections, sections, items };
}
