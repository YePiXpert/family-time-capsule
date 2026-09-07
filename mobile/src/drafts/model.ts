/** Shared Web/native wire contract. A draft owns references, never original bytes. */
export type DraftItem = {
  id: string;
  assetId: string | null;
  localCaptureRef: string | null;
  caption: string;
  preservationState?: "missing";
};
/**
 * 正式 1.0 §5 对象级读者：family=全家；members=作者+指定成员（按用户 ID）；
 * private=仅作者。参与人物不是读者。
 */
export type DraftVisibility = "family" | "members" | "private";
export type DraftContent = {
  title: string;
  text: string;
  occurredAt: string | null;
  occurredAtPrecision: "exact" | "approximate" | "date_only";
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
    return { id: id(item.id), assetId, localCaptureRef, caption: string(item.caption, 2000), ...(!assetId && !localCaptureRef ? { preservationState: "missing" as const } : {}) };
  });
  if (new Set(items.map(i => i.id)).size !== items.length) return invalid();
  const assetIds = items.flatMap(i => i.assetId ? [i.assetId] : []);
  if (new Set(assetIds).size !== assetIds.length) return invalid();
  const coverItemId = nullableId(v.coverItemId);
  if (coverItemId && !items.some(i => i.id === coverItemId)) return invalid();
  const occurredAt = v.occurredAt === null ? null : string(v.occurredAt, 32);
  if (occurredAt !== null && (!/^\d{4}-\d\d-\d\dT/u.test(occurredAt) || !Number.isFinite(Date.parse(occurredAt)))) return invalid();
  if (!["exact", "approximate", "date_only"].includes(String(v.occurredAtPrecision))) return invalid();
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
