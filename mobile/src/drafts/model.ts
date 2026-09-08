/** Shared Web/native wire contract. A draft owns references, never original bytes. */
import { isOccurredAtPrecision } from "../utils/occurred-precision";
export type DraftItem = {
  id: string;
  assetId: string | null;
  localCaptureRef: string | null;
  caption: string;
  preservationState?: "missing";
  livePhotoGroupId?: string;
  livePhotoRole?: "image" | "video";
};
/**
 * 正式 1.0 §5 对象级读者：family=全家；members=作者+指定成员（按用户 ID）；
 * private=仅作者。参与人物不是读者。
 */
export type DraftVisibility = "family" | "members" | "private";
export type DraftContent = {
  title: string;
  text: string;
  /**
   * UTC 锚点（排序/分组用）。按 §6：month/year 精度锚点为该期首日；
   * unknown 精度为 null（服务端用创建时刻做内部锚点，永不显示为发生时间）。
   */
  occurredAt: string | null;
  occurredAtPrecision: "exact" | "approximate" | "date_only" | "month" | "year" | "unknown";
  locationText: string;
  participantIds: string[];
  visibility: DraftVisibility;
  /** members 可见性时的显式读者（用户 ID，最多 20 人，服务端按家庭校验）。 */
  readerUserIds: string[];
  coverItemId: string | null;
  items: DraftItem[];
};
export type Draft = DraftContent & {
  id: string;
  revision: number;
  mutationId: string;
  status: "editing" | "published" | "discarded";
  memoryEventId: string | null;
  createdAt: string;
  updatedAt: string;
};
export function emptyDraftContent(): DraftContent {
  return { title: "", text: "", occurredAt: null, occurredAtPrecision: "exact", locationText: "", participantIds: [], visibility: "family", readerUserIds: [], coverItemId: null, items: [] };
}
/** Incomplete dates may remain drafts; only unknown may be published without a date. */
export function isDraftDateComplete(content: Pick<DraftContent, "occurredAt" | "occurredAtPrecision">): boolean {
  return content.occurredAtPrecision === "unknown" ||
    (content.occurredAt !== null && Number.isFinite(Date.parse(content.occurredAt)));
}
export function parseDraftContent(value: unknown): DraftContent {
  const invalid = () => { throw new Error("invalid_draft"); };
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  const v = value as Record<string, unknown>;
  const string = (x: unknown, max: number): string => typeof x === "string" && x.length <= max ? x : invalid();
  const id = (x: unknown): string => typeof x === "string" && /^[\w-]{1,128}$/u.test(x) ? x : invalid();
  const nullableId = (x: unknown): string | null => x === null ? null : id(x);
  const participantIds = Array.isArray(v.participantIds) && v.participantIds.length <= 50 ? v.participantIds.map(id) : invalid();
  if (new Set(participantIds).size !== participantIds.length) return invalid();
  if (!Array.isArray(v.items) || v.items.length > 200) return invalid();
  const items = v.items.map((x): DraftItem => {
    if (!x || typeof x !== "object" || Array.isArray(x)) return invalid();
    const item = x as Record<string, unknown>;
    const assetId = nullableId(item.assetId), localCaptureRef = nullableId(item.localCaptureRef);
    if (!assetId && !localCaptureRef && item.preservationState !== "missing") return invalid();
    const group = item.livePhotoGroupId == null ? undefined : id(item.livePhotoGroupId);
    const role = item.livePhotoRole == null ? undefined : item.livePhotoRole;
    if (group ? role !== "image" && role !== "video" : role !== undefined) return invalid();
    return { ...(group ? { livePhotoGroupId: group, livePhotoRole: role as "image" | "video" } : {}), id: id(item.id), assetId, localCaptureRef, caption: string(item.caption, 2000), ...(!assetId && !localCaptureRef ? { preservationState: "missing" as const } : {}) };
  });
  if (new Set(items.map(i => i.id)).size !== items.length) return invalid();
  assertLivePhotoPairs(items);
  for (const item of items) if (item.livePhotoGroupId) {
    const other = items.find(i => i.id !== item.id && i.livePhotoGroupId === item.livePhotoGroupId)!;
    if ((item.assetId && item.assetId === other.assetId) || (item.localCaptureRef && item.localCaptureRef === other.localCaptureRef)) return invalid();
  }
  const seen = new Map<string, DraftItem>();
  for (const item of items) if (item.assetId) {
    const previous = seen.get(item.assetId);
    if (previous && !(previous.livePhotoGroupId && item.livePhotoGroupId && previous.livePhotoGroupId !== item.livePhotoGroupId && previous.livePhotoRole === item.livePhotoRole)) return invalid();
    seen.set(item.assetId, item);
  }
  const coverItemId = nullableId(v.coverItemId);
  if (coverItemId && !items.some(i => i.id === coverItemId)) return invalid();
  const occurredAt = v.occurredAt === null ? null : string(v.occurredAt, 32);
  if (occurredAt !== null && (!/^\d{4}-\d\d-\d\dT/u.test(occurredAt) || !Number.isFinite(Date.parse(occurredAt)))) return invalid();
  if (!isOccurredAtPrecision(v.occurredAtPrecision)) return invalid();
  // §6：缺锚点在保存阶段允许（旧草稿如此）；发布时按精度裁决——
  // 非 unknown 必须有时间，unknown 由服务端以创建时刻做内部锚点。
  // 兼容历史草稿载荷：旧客户端没有 readerUserIds 字段，按空清单处理。
  if (v.visibility !== "family" && v.visibility !== "members" && v.visibility !== "private") return invalid();
  const visibility = v.visibility as DraftVisibility;
  const readerUserIds = v.readerUserIds === undefined || v.readerUserIds === null
    ? []
    : Array.isArray(v.readerUserIds) && v.readerUserIds.length <= 20
      ? v.readerUserIds.map(id)
      : invalid();
  if (new Set(readerUserIds).size !== readerUserIds.length) return invalid();
  if (visibility !== "members" && readerUserIds.length > 0) return invalid();
  return { title: string(v.title, 100), text: string(v.text, 5000), occurredAt, occurredAtPrecision: v.occurredAtPrecision as DraftContent["occurredAtPrecision"], locationText: string(v.locationText, 200), participantIds, visibility, readerUserIds, coverItemId, items };
}

/** Relationship is explicit; missing originals retain both placeholders but cannot publish. */
export function assertLivePhotoPairs(items: Pick<DraftItem, "livePhotoGroupId" | "livePhotoRole">[]): void {
  const groups = new Map<string, string[]>();
  for (const item of items) {
    if (item.livePhotoGroupId == null) { if (item.livePhotoRole != null) throw new Error("invalid_live_photo"); continue; }
    if (typeof item.livePhotoGroupId !== "string") throw new Error("invalid_live_photo");
    if (!/^[\w-]{1,128}$/u.test(item.livePhotoGroupId) || !["image", "video"].includes(item.livePhotoRole ?? "")) throw new Error("invalid_live_photo");
    groups.set(item.livePhotoGroupId, [...(groups.get(item.livePhotoGroupId) ?? []), item.livePhotoRole!]);
  }
  for (const roles of groups.values()) if (roles.length !== 2 || new Set(roles).size !== 2) throw new Error("invalid_live_photo");
}
export function removeDraftItem(content: DraftContent, id: string): Pick<DraftContent, "items" | "coverItemId"> {
  const target = content.items.find(i => i.id === id);
  const items = content.items.filter(i => i.id !== id && (!target?.livePhotoGroupId || i.livePhotoGroupId !== target.livePhotoGroupId));
  return { items, coverItemId: items.some(i => i.id === content.coverItemId) ? content.coverItemId : null };
}
/** Dedupe ordinary references, while retaining explicit complete pairs and every local original. */
export function reconcileDraftAsset(content: DraftContent, id: string, assetId: string): Pick<DraftContent, "items" | "coverItemId"> {
  const item = content.items.find(i => i.id === id)!;
  const duplicate = content.items.find(i => i.id !== id && i.assetId === assetId);
  const remove = duplicate ? (item.livePhotoGroupId ? (duplicate.livePhotoGroupId ? null : duplicate.id) : item.id) : null;
  const items = content.items.filter(i => i.id !== remove).map(i => i.id === id ? { ...i, assetId } : i);
  return { items, coverItemId: content.coverItemId === remove ? (remove === id ? duplicate!.id : id) : content.coverItemId };
}

/** Explicit user pairing for separately imported components; never infer from filenames. */
export function pairDraftItems(content: DraftContent, imageId: string, videoId: string, groupId: string): Pick<DraftContent, "items"> {
  const image = content.items.find(i => i.id === imageId), video = content.items.find(i => i.id === videoId);
  if (!image || !video || imageId === videoId || image.livePhotoGroupId || video.livePhotoGroupId) throw new Error("请选两份尚未配对的原件。");
  const items = content.items.map(i => i.id === imageId || i.id === videoId ? { ...i, livePhotoGroupId: groupId, livePhotoRole: i.id === imageId ? "image" as const : "video" as const } : i);
  return { items: parseDraftContent({ ...content, items }).items };
}
