import { emptyDraftContent, parseDraftContent } from "../drafts/model";
import type { LocalMemoryEdit, MemoryEditContent, MemoryEditSubmission } from "../memories/edit-model";

const invalid = (): never => { throw new Error("救援包中的记录编辑信息或所属家庭无效。"); };
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) return invalid();
  return value as Record<string, unknown>;
}
const str = (value: unknown, max: number): string => typeof value === "string" && value.length <= max ? value : invalid();
const id = (value: unknown): string => typeof value === "string" && /^[\w-]{1,128}$/u.test(value) ? value : invalid();
const revision = (value: unknown): number => Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : invalid();

/** Scope contains identity, never authentication. Reject URLs that carry secrets. */
export function validateRescueEditScope(value: unknown): string {
  const scope = str(value, 4096);
  let fields: unknown;
  try { fields = JSON.parse(scope); } catch { return invalid(); }
  if (!Array.isArray(fields) || fields.length !== 4) return invalid();
  const url = new URL(str(fields[0], 2048));
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) return invalid();
  fields.slice(1).forEach(id);
  return scope;
}
function content(value: unknown): MemoryEditContent {
  const v = object(value, ["title", "bodyText", "location", "occurredAt", "precision", "participants", "child", "items", "visibility", "readerUserIds", "coverAssetId", "newCoverItemId", "milestoneType"]);
  const parsed = parseDraftContent({ ...emptyDraftContent(), title: v.title, text: "", locationText: v.location, occurredAt: v.occurredAt,
    occurredAtPrecision: v.precision, participantIds: v.participants, items: v.items ?? [], coverItemId: v.newCoverItemId ?? null, visibility: v.visibility ?? "private", readerUserIds: v.readerUserIds ?? [] });
  const child = v.child === null ? null : id(v.child);
  if (v.items !== undefined) for (const item of v.items as unknown[]) object(item, ["id", "assetId", "localCaptureRef", "caption", "preservationState", "livePhotoGroupId", "livePhotoRole"]);
  return { title: parsed.title, bodyText: str(v.bodyText, 100_000), location: parsed.locationText, occurredAt: parsed.occurredAt,
    precision: parsed.occurredAtPrecision, participants: parsed.participantIds, child,
    ...(v.items === undefined ? {} : { items: parsed.items }), ...(v.visibility === undefined ? {} : { visibility: parsed.visibility }),
    ...(v.readerUserIds === undefined ? {} : { readerUserIds: parsed.readerUserIds }),
    ...(v.coverAssetId === undefined ? {} : { coverAssetId: v.coverAssetId === null ? null : id(v.coverAssetId) }),
    ...(v.newCoverItemId === undefined ? {} : { newCoverItemId: parsed.coverItemId }),
    ...(v.milestoneType === undefined ? {} : { milestoneType: v.milestoneType === null ? null : str(v.milestoneType, 32) }) };
}
/** An explicit whitelist protects exports and rejects credential-bearing imports. */
export function parseRescueEditSnapshot(value: unknown, scope: string, memoryId: string): LocalMemoryEdit {
  const v = object(value, ["scope", "memoryId", "content", "base", "baseRevision", "timezone", "atomicEditVersion", "appliedItemIds", "savedContent", "submission", "conflict", "blocked", "problem", "revision", "updatedAt"]);
  if (v.scope !== scope || v.memoryId !== memoryId || typeof v.blocked !== "boolean" || (v.atomicEditVersion !== undefined && v.atomicEditVersion !== 1)) return invalid();
  const appliedItemIds = v.appliedItemIds === undefined ? undefined : Array.isArray(v.appliedItemIds) ? v.appliedItemIds.map(id) : invalid();
  if (appliedItemIds && new Set(appliedItemIds).size !== appliedItemIds.length) return invalid();
  let submission: MemoryEditSubmission | null = null;
  if (v.submission !== null) {
    const s = object(v.submission, ["mutationId", "content", "expectedRevision", "stage"]);
    submission = { mutationId: id(s.mutationId), content: content(s.content), expectedRevision: revision(s.expectedRevision) };
    if (s.stage !== undefined) {
      const stage = object(s.stage, ["id", "mutationId", "revision", "items", "uploads"]);
      const parsed = parseDraftContent({ ...emptyDraftContent(), items: stage.items });
      for (const item of stage.items as unknown[]) object(item, ["id", "assetId", "localCaptureRef", "caption", "preservationState", "livePhotoGroupId", "livePhotoRole"]);
      let uploads: Record<string, { id: string; offset: number }> | undefined;
      if (stage.uploads !== undefined) {
        if (!stage.uploads || typeof stage.uploads !== "object" || Array.isArray(stage.uploads)) return invalid();
        uploads = Object.fromEntries(Object.entries(stage.uploads).map(([capture, raw]) => {
          const upload = object(raw, ["id", "offset"]);
          return [id(capture), { id: id(upload.id), offset: revision(upload.offset) }];
        }));
      }
      const originalItems = submission.content.items ?? [];
      if (parsed.items.length !== originalItems.length || parsed.items.some((item, index) => {
        const source = originalItems[index]!;
        return item.id !== source.id || item.localCaptureRef !== source.localCaptureRef || item.caption !== source.caption ||
          item.livePhotoGroupId !== source.livePhotoGroupId || item.livePhotoRole !== source.livePhotoRole;
      }) || (uploads && Object.keys(uploads).some(key => !parsed.items.some(item => item.id === key)))) return invalid();
      submission.stage = { id: id(stage.id), mutationId: id(stage.mutationId), revision: stage.revision === null ? null : revision(stage.revision), items: parsed.items, ...(uploads ? { uploads } : {}) };
    }
  }
  let conflict: LocalMemoryEdit["conflict"] = null;
  if (v.conflict !== null) { const c = object(v.conflict, ["content", "revision"]); conflict = { content: content(c.content), revision: revision(c.revision) }; }
  const updatedAt = str(v.updatedAt, 32), timezone = str(v.timezone, 128);
  if (!Number.isFinite(Date.parse(updatedAt))) return invalid();
  try { new Intl.DateTimeFormat("en", { timeZone: timezone }); } catch { return invalid(); }
  return { scope, memoryId: id(memoryId), content: content(v.content), base: content(v.base), baseRevision: revision(v.baseRevision), timezone,
    ...(v.atomicEditVersion === 1 ? { atomicEditVersion: 1 as const } : {}), ...(appliedItemIds ? { appliedItemIds } : {}), savedContent: v.savedContent === null ? null : content(v.savedContent),
    submission, conflict, blocked: v.blocked, problem: v.problem === null ? null : str(v.problem, 4096), revision: revision(v.revision), updatedAt };
}
export function rescueEditCaptureRefs(snapshot: LocalMemoryEdit): Set<string> {
  return new Set([snapshot.content, snapshot.savedContent, snapshot.submission?.content, snapshot.submission?.stage].flatMap(row => row?.items?.flatMap(item => item.localCaptureRef ? [item.localCaptureRef] : []) ?? []));
}
