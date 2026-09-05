/** Database-free graph validator shared by restore and the standalone verifier. */
export const BOOK_FILES = [
  "book-projects.json",
  "book-chapters.json",
  "book-blocks.json",
  "book-source-refs.json",
  "book-block-sources.json",
  "book-revisions.json",
];
const fields = {
  memory: "memoryEventId",
  asset: "assetId",
  contribution: "contributionId",
  story: "storyId",
  collection: "collectionId",
};
const fail = () => {
  throw new Error("Invalid book archive graph");
};
const obj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const text = (v, max, min = 0) =>
  typeof v === "string" && v.length <= max && v.trim().length >= min;
const uuid = (v) =>
  typeof v === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const instant = (v) => typeof v === "string" && Number.isFinite(Date.parse(v));
const day = (v) =>
  typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  instant(v) &&
  new Date(v).toISOString().slice(0, 10) === v;
const integer = (v) => Number.isSafeInteger(v) && v >= 0;
function layout(v) {
  if (
    !obj(v) ||
    Object.keys(v).some((k) => !["breakBefore", "fit", "focus"].includes(k)) ||
    typeof v.breakBefore !== "boolean" ||
    !["contain", "cover"].includes(v.fit) ||
    !Array.isArray(v.focus) ||
    v.focus.length !== 4 ||
    v.focus.some(
      (f) =>
        !obj(f) ||
        Object.keys(f).some((k) => !["x", "y"].includes(k)) ||
        [f.x, f.y].some((n) => !Number.isFinite(n) || n < 0 || n > 1),
    )
  )
    fail();
}
function metadata(p, refs) {
  if (
    !text(p.title, 200, 1) ||
    !text(p.subtitle, 500) ||
    !["photos", "growth", "letters"].includes(p.template) ||
    !["personal", "family"].includes(p.audience) ||
    !["A4", "A5"].includes(p.pageSize) ||
    [p.startDate, p.endDate].some((d) => d !== null && !day(d)) ||
    (p.startDate && p.endDate && p.startDate > p.endDate) ||
    (p.coverAssetId !== null && !refs.asset.has(p.coverAssetId))
  )
    fail();
}
function source(s, refs) {
  if (
    !Object.hasOwn(fields, s.kind) ||
    !text(s.label, 500) ||
    !text(s.fingerprint, 128)
  )
    fail();
  for (const [kind, field] of Object.entries(fields))
    if (
      kind === s.kind
        ? s[field] !== null && !refs[kind].has(s[field])
        : s[field] !== null
    )
      fail();
}
function block(b) {
  if (
    !["text", "image", "double", "collage", "quote", "date"].includes(b.kind) ||
    !text(b.text, 30000) ||
    !text(b.caption, 2000)
  )
    fail();
}
function ordered(rows, key, limit) {
  const groups = new Map();
  for (const row of rows) {
    if (!integer(row.position)) fail();
    const a = groups.get(row[key]) || [];
    a.push(row.position);
    groups.set(row[key], a);
  }
  for (const a of groups.values())
    if (a.length > limit || a.sort((a, b) => a - b).some((n, i) => n !== i))
      fail();
}
function uniqueRows(rows, keys, familyId) {
  if (!Array.isArray(rows) || rows.length > 100000) fail();
  const m = new Map();
  for (const row of rows) {
    if (
      !obj(row) ||
      !uuid(row.id) ||
      m.has(row.id) ||
      row.familyId !== familyId ||
      Object.keys(row).some((k) => !keys.includes(k))
    )
      fail();
    m.set(row.id, row);
  }
  return m;
}
export function validateBookArchive(raw, familyId, refs) {
  if (!Array.isArray(raw) || raw.length !== 6) fail();
  const [projects, chapters, blocks, sources, links, revisions] = raw;
  const common = ["id", "familyId", "projectId"];
  const ps = uniqueRows(
    projects,
    [
      "id",
      "familyId",
      "ownerPersonId",
      "title",
      "subtitle",
      "template",
      "audience",
      "pageSize",
      "startDate",
      "endDate",
      "coverAssetId",
      "status",
      "draftKey",
      "revision",
      "createdAt",
      "updatedAt",
      "deletedAt",
    ],
    familyId,
  );
  const cs = uniqueRows(chapters, [...common, "title", "position"], familyId);
  const bs = uniqueRows(
    blocks,
    [
      ...common,
      "chapterId",
      "position",
      "kind",
      "text",
      "caption",
      "layoutJson",
    ],
    familyId,
  );
  const ss = uniqueRows(
    sources,
    [
      ...common,
      "kind",
      ...Object.values(fields),
      "fingerprint",
      "label",
      "createdAt",
    ],
    familyId,
  );
  uniqueRows(
    links,
    [...common, "blockId", "sourceRefId", "position"],
    familyId,
  );
  uniqueRows(
    revisions,
    [...common, "revision", "snapshotJson", "createdAt"],
    familyId,
  );
  const drafts = new Set(),
    pairs = new Set(),
    versions = new Set();
  for (const p of projects) {
    metadata(p, refs);
    if (
      (p.ownerPersonId !== null && !refs.person.has(p.ownerPersonId)) ||
      !["active", "finished"].includes(p.status) ||
      !integer(p.revision) ||
      p.revision < 1 ||
      !instant(p.createdAt) ||
      !instant(p.updatedAt) ||
      (p.deletedAt !== null && !instant(p.deletedAt)) ||
      (p.draftKey !== null && !text(p.draftKey, 500, 1))
    )
      fail();
    if (p.status === "active" && p.deletedAt === null && p.draftKey !== null) {
      if (drafts.has(p.draftKey)) fail();
      drafts.add(p.draftKey);
    }
  }
  for (const rows of [chapters, blocks, sources, links, revisions])
    for (const r of rows) if (!ps.has(r.projectId)) fail();
  for (const c of chapters) if (!text(c.title, 200, 1)) fail();
  for (const b of blocks) {
    block(b);
    if (cs.get(b.chapterId)?.projectId !== b.projectId) fail();
    layout(JSON.parse(b.layoutJson));
  }
  for (const s of sources) {
    source(s, refs);
    if (!instant(s.createdAt)) fail();
  }
  for (const l of links) {
    if (
      bs.get(l.blockId)?.projectId !== l.projectId ||
      ss.get(l.sourceRefId)?.projectId !== l.projectId
    )
      fail();
    const key = JSON.stringify([l.blockId, l.sourceRefId]);
    if (pairs.has(key)) fail();
    pairs.add(key);
  }
  ordered(chapters, "projectId", 50);
  ordered(blocks, "projectId", 500);
  ordered(links, "blockId", 20);
  for (const p of projects) {
    const list = blocks.filter((b) => b.projectId === p.id);
    if (
      list.reduce((n, b) => n + b.text.length + b.caption.length, 0) > 500000 ||
      sources.filter((s) => s.projectId === p.id).length > 2000
    )
      fail();
  }
  for (const r of revisions) {
    const p = ps.get(r.projectId),
      key = JSON.stringify([r.projectId, r.revision]);
    if (
      !integer(r.revision) ||
      r.revision < 1 ||
      r.revision > p.revision ||
      versions.has(key) ||
      !instant(r.createdAt) ||
      !text(r.snapshotJson, 4000000)
    )
      fail();
    versions.add(key);
    const v = JSON.parse(r.snapshotJson);
    if (!obj(v)) fail();
    // An immutable snapshot can name a physically purged target. Its durable
    // SourceRef is the authority: only an explicit FK tombstone permits this.
    const coverTombstone =
      v.coverAssetId !== null &&
      Array.isArray(v.sources) &&
      v.sources.some(
        (s) =>
          obj(s) &&
          s.kind === "asset" &&
          s.assetId === v.coverAssetId &&
          ss.get(s.id)?.projectId === r.projectId &&
          ss.get(s.id)?.assetId === null,
      );
    metadata(coverTombstone ? { ...v, coverAssetId: null } : v, refs);
    if (v.audience !== p.audience) fail();
    if (
      !Array.isArray(v.chapters) ||
      v.chapters.length > 50 ||
      !Array.isArray(v.blocks) ||
      v.blocks.length > 500 ||
      !Array.isArray(v.sources) ||
      v.sources.length > 2000
    )
      fail();
    const oldChapters = new Set(),
      oldBlocks = new Set(),
      oldSources = new Set();
    for (const c of v.chapters) {
      if (
        !obj(c) ||
        !uuid(c.id) ||
        oldChapters.has(c.id) ||
        !text(c.title, 200, 1)
      )
        fail();
      oldChapters.add(c.id);
    }
    for (const s of v.sources) {
      if (!obj(s) || oldSources.has(s.id)) fail();
      const canonical = ss.get(s.id);
      if (
        !canonical ||
        canonical.projectId !== r.projectId ||
        canonical.kind !== s.kind ||
        Object.values(fields).some((f) =>
          f === fields[s.kind] && canonical[f] === null
            ? s[f] !== null && !text(s[f], 128, 1)
            : canonical[f] !== s[f],
        )
      )
        fail();
      source({ ...s, [fields[s.kind]]: canonical[fields[s.kind]] }, refs);
      oldSources.add(s.id);
    }
    for (const b of v.blocks) {
      if (
        !obj(b) ||
        !uuid(b.id) ||
        oldBlocks.has(b.id) ||
        !oldChapters.has(b.chapterId) ||
        !Array.isArray(b.sourceIds) ||
        b.sourceIds.length > 20 ||
        new Set(b.sourceIds).size !== b.sourceIds.length ||
        b.sourceIds.some((id) => !oldSources.has(id))
      )
        fail();
      block(b);
      layout(b.layout);
      oldBlocks.add(b.id);
    }
    if (
      v.blocks.reduce((n, b) => n + b.text.length + b.caption.length, 0) >
      500000
    )
      fail();
  }
  return { projects, chapters, blocks, sources, links, revisions };
}
