export type ImportPickItem = {
  id: string;
  title: string;
  type: "image" | "video" | "audio" | "document" | "text";
  localUri?: string | null;
  thumbnailUri?: string | null;
  capturedAt?: string | null;
  mimeType?: string;
};

export type ImportPhotoGroup = {
  id: string;
  ids: string[];
  representativeId: string;
  reason: "time" | "batch" | "manual";
};

export type ImportPhotoSelection = {
  selectedIds: string[];
  coverId: string | null;
  /** Includes selected and unselected originals, exactly once per item. */
  groups: ImportPhotoGroup[];
  revision: number;
  updatedAt: string;
};

const TIME_WINDOW_MS = 30_000;

function indexItems(items: readonly ImportPickItem[]): Map<string, ImportPickItem> {
  const indexed = new Map<string, ImportPickItem>();
  for (const item of items) {
    if (typeof item.id !== "string" || !item.id || indexed.has(item.id)) throw new Error("这批素材的编号无效或重复，请重新打开后再挑选。");
    indexed.set(item.id, item);
  }
  return indexed;
}

/** The caller supplies capture metadata, never an import/modified timestamp.
 * Date-only or timezone-free strings cannot establish a 30-second window. */
function captureTimestamp(item: ImportPickItem): number | null {
  if (item.type !== "image" || !item.capturedAt ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(item.capturedAt)) return null;
  const timestamp = Date.parse(item.capturedAt);
  const wall = Date.parse(`${item.capturedAt.slice(0, 19)}Z`);
  if (!Number.isFinite(timestamp) || !Number.isFinite(wall) ||
      new Date(wall).toISOString().slice(0, 19) !== item.capturedAt.slice(0, 19)) return null;
  return timestamp;
}

function representative(ids: string[], items: Map<string, ImportPickItem>): string {
  return ids.find(id => items.get(id)?.type === "image") ?? ids[0]!;
}

function isTimeGroup(ids: string[], items: Map<string, ImportPickItem>): boolean {
  let first = Infinity;
  let last = -Infinity;
  for (const id of ids) {
    const item = items.get(id);
    const timestamp = item ? captureTimestamp(item) : null;
    if (timestamp === null) return false;
    first = Math.min(first, timestamp);
    last = Math.max(last, timestamp);
  }
  return ids.length > 0 && last - first <= TIME_WINDOW_MS;
}

function automaticGroups(items: readonly ImportPickItem[]): ImportPhotoGroup[] {
  const indexed = indexItems(items);
  const timed: { id: string; timestamp: number; order: number }[] = [];
  const batch: string[] = [];
  const order = new Map<string, number>();
  items.forEach((item, index) => {
    order.set(item.id, index);
    const timestamp = captureTimestamp(item);
    if (timestamp === null) batch.push(item.id);
    else timed.push({ id: item.id, timestamp, order: index });
  });
  timed.sort((a, b) => a.timestamp - b.timestamp || a.order - b.order);
  const groups: ImportPhotoGroup[] = [];
  let windowStart = -Infinity;
  let current: ImportPhotoGroup | null = null;
  for (const item of timed) {
    // Anchor to the first photo; a chain of short gaps must not span minutes.
    if (!current || item.timestamp - windowStart > TIME_WINDOW_MS) {
      current = { id: `time:${encodeURIComponent(item.id)}`, ids: [], representativeId: item.id, reason: "time" };
      groups.push(current);
      windowStart = item.timestamp;
    }
    current.ids.push(item.id);
  }
  if (batch.length) groups.push({ id: "batch", ids: batch, representativeId: representative(batch, indexed), reason: "batch" });
  const firstOrder = (group: ImportPhotoGroup) => group.ids.reduce((first, id) => Math.min(first, order.get(id)!), Infinity);
  return groups.sort((a, b) => firstOrder(a) - firstOrder(b));
}

export function createPhotoSelection(items: readonly ImportPickItem[]): ImportPhotoSelection {
  indexItems(items);
  return {
    selectedIds: items.map(item => item.id),
    coverId: items.find(item => item.type === "image")?.id ?? null,
    groups: automaticGroups(items),
    revision: 0,
    updatedAt: new Date().toISOString(),
  };
}

/** Reconcile references, not files. Manual choices and group boundaries survive
 * refresh; new originals start selected and receive their own automatic groups. */
export function reconcilePhotoSelection(selection: ImportPhotoSelection, items: readonly ImportPickItem[]): ImportPhotoSelection {
  const indexed = indexItems(items);
  const knownIds = new Set([
    ...selection.groups.flatMap(group => group.ids),
    ...selection.selectedIds,
    ...(selection.coverId ? [selection.coverId] : []),
  ]);
  const selectedIds = [...new Set(selection.selectedIds.filter(id => indexed.has(id)))];
  for (const item of items) if (!knownIds.has(item.id)) selectedIds.push(item.id);
  const assigned = new Set<string>();
  const groupIds = new Set<string>();
  const groups: ImportPhotoGroup[] = [];
  const appendGroup = (group: ImportPhotoGroup) => {
    const ids = group.ids.filter(id => {
      if (!indexed.has(id) || assigned.has(id)) return false;
      assigned.add(id);
      return true;
    });
    if (!ids.length) return;
    const baseId = group.id || `${group.reason}:${encodeURIComponent(ids[0]!)}`;
    let id = baseId;
    let suffix = 2;
    while (groupIds.has(id)) id = `${baseId}:${suffix++}`;
    groupIds.add(id);
    groups.push({
      id, ids,
      representativeId: ids.includes(group.representativeId) ? group.representativeId : representative(ids, indexed),
      reason: group.reason === "time" && !isTimeGroup(ids, indexed) ? "batch" : group.reason,
    });
  };
  selection.groups.forEach(appendGroup);
  automaticGroups(items.filter(item => !assigned.has(item.id))).forEach(appendGroup);
  return {
    ...selection,
    selectedIds,
    coverId: selection.coverId && selectedIds.includes(selection.coverId) && indexed.get(selection.coverId)?.type === "image"
      ? selection.coverId : null,
    groups,
  };
}
