import "server-only";
import { randomUUID } from "node:crypto";
import type { ArchivePrivacy } from "@/lib/export/privacy.mjs";
import type { DraftArchive } from "@/lib/drafts/archive";
/**
 * V1 omitted event/asset account grants. Recover restrictive evidence from its
 * durable drafts, but never turn an archived Person into a live account grant.
 */
export function legacyArchivePrivacy(rows: {
  events: { id: string }[];
  assets: { assetId: string }[];
  drafts: DraftArchive[];
  books: { id: string; audience: string; ownerPersonId: string | null }[];
  imports: { id: string; source: string }[];
}): ArchivePrivacy {
  const principals = new Map<string, { id: string; name: string }>();
  function principal(key: string, name = "旧归档待确认身份") {
    if (!principals.has(key)) principals.set(key, { id: randomUUID(), name: name.slice(0, 200) });
    return principals.get(key)!.id;
  }
  const draftOwners = new Map(rows.drafts.map(d => [d.id, principal(d.authorPersonId ? `person:${d.authorPersonId}` : `draft:${d.id}`, d.authorName || "旧草稿待确认作者")]));
  const drafts: ArchivePrivacy["drafts"] = rows.drafts.map(d => ({ id: d.id, visibility: d.visibility, owner: draftOwners.get(d.id)!, readers: d.visibility === "members" ? d.readerUserIds.map(id => principal(`reader:${id}`, "旧归档待确认读者")) : [] }));
  const events: ArchivePrivacy["events"] = rows.events.map(e => {
    const sources = rows.drafts.filter(d => d.memoryEventId === e.id && d.status === "published" && d.visibility !== "family");
    const owners = new Set(sources.map(d => draftOwners.get(d.id)!));
    return { id: e.id, visibility: sources.length ? "private" : "family", owner: owners.size === 1 ? [...owners][0] : sources.length ? principal(`event:${e.id}`) : null, readers: [] };
  });
  const assets: ArchivePrivacy["assets"] = rows.assets.map(a => {
    const sources = rows.drafts.filter(d => (d.visibility !== "family" || d.status !== "published") && d.items.some(item => item.assetId === a.assetId));
    const owners = new Set(sources.map(d => draftOwners.get(d.id)!));
    return { id: a.assetId, visibility: sources.length ? "private" : "family", owner: owners.size === 1 ? [...owners][0] : principal(sources.length ? `asset:${a.assetId}` : "legacy-assets", "旧原件待确认上传者") };
  });
  const books = rows.books.map(b => ({ id: b.id, owner: b.audience === "personal" ? principal(b.ownerPersonId ? `person:${b.ownerPersonId}` : `book:${b.id}`, "旧作品待确认作者") : null }));
  const imports = rows.imports.map(i => ({ id: i.id, owner: i.source === "guest" ? null : principal(`import:${i.id}`, "旧收件待确认提交者") }));
  return { version: 1, principals: [...principals.values()], events, assets, drafts, books, imports, reviewAssets: [] };
}
