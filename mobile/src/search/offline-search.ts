import { getDatabase } from "../storage/database";
import { memoryCacheScope } from "../memories/cache-scope";
import type { Credentials, MobileMemory } from "../types";

/**
 * 原生离线搜索（FIND-2 / M7-b，正式 1.0 重写为投影式匹配）。
 *
 * 只搜索这台设备已经合法保存/缓存的内容，绝不为搜索下载更多服务器资料：
 * - timeline_event / memory_detail / people：服务器缓存，逐行 scope =
 *   (serverUrl, instanceId, token, userId, familyId) 的哈希；读路径按 scope
 *   过滤，不依赖「换号时通常会清空」。
 * - local_capture：设备主人自己的本机记录，始终可搜，但结果明确标注属于
 *   这台设备（owner=device），不静默并入当前家庭的档案。
 * - reading_download：已下载的相册/作品（独立缓存库，按阅读 scope 隔离）。
 *
 * 正式 1.0 正确性要求：
 * - 绝不对 detail_json / payload_json / manifest 做整串 LIKE 或摘录——
 *   只把允许展示的字段（标题、正文、讲述、转录、人物显示名、素材显示名、
 *   地点）解析出来参与匹配，摘要也只来自这些字段；token、内部路径、
 *   storageKey、授权字段永不进入搜索或摘要；
 * - 损坏的 JSON 单行跳过，不让一份坏缓存拖垮全部搜索；
 * - 已归档本机记录与对应服务器记忆去重，不重复出现；
 * - 筛选（人物/日期范围/媒体类型）与在线语义一致，信息不足时诚实少显示；
 * - 稳定排序：记忆按发生时间倒序，本机记录按发生时间倒序，阅读包按缓存
 *   更新时间；不因扫描顺序抖动。
 */

export type OfflineSearchFilters = {
  /** 人物显示名（子串，大小写不敏感）。 */
  person?: string;
  /** YYYY-MM-DD（含端点），按事件发生日期过滤。 */
  dateFrom?: string;
  dateTo?: string;
  mediaType?: "image" | "video" | "audio" | "document";
};

export type OfflineSearchResult = {
  kind: "memory" | "local" | "reading";
  id: string;
  title: string;
  snippet: string;
  /** 记忆是否已有完整详情缓存：离线时能否直接打开。 */
  hasDetail?: boolean;
  readingKind?: "book" | "collection";
  /** family = 当前连接家庭的受控缓存；device = 这台设备主人的本机内容。 */
  owner: "family" | "device";
  /** 稳定排序键（发生/更新时间），展示由 UI 自己格式化。 */
  sortKey: string;
};

/** 单字段扫描上限：搜索永远有界，不整库解码。 */
const SCAN_CAPS = {
  timeline: 2000,
  detail: 500,
  local: 1000,
  queryChars: 100,
  total: 50,
};

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/u;

function fold(value: string): string {
  return value.toLowerCase();
}

function matchesQuery(text: string, foldedQuery: string): boolean {
  return fold(text).includes(foldedQuery);
}

function excerpt(text: string, foldedQuery: string, width = 72): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  const at = fold(normalized).indexOf(foldedQuery);
  if (at < 0) return normalized.slice(0, width);
  const start = Math.max(0, at - 18);
  return (start > 0 ? "…" : "") + normalized.slice(start, start + width);
}

function inDateRange(iso: string | null | undefined, filters: OfflineSearchFilters): boolean {
  if (!iso) return false;
  const day = iso.slice(0, 10);
  if (filters.dateFrom && day < filters.dateFrom) return false;
  if (filters.dateTo && day > filters.dateTo) return false;
  return true;
}

function parseJsonArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every((entry) => typeof entry === "string")
      ? (parsed as string[])
      : [];
  } catch {
    return [];
  }
}

/** detail_json → 允许展示的投影字段；损坏返回 null（单行跳过）。 */
function projectMemoryDetail(raw: string): {
  title: string;
  occurredAt: string;
  participantNames: string[];
  searchFields: string[];
  mediaTypes: string[];
} | null {
  let parsed: MobileMemory;
  try {
    parsed = JSON.parse(raw) as MobileMemory;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || typeof parsed.id !== "string") return null;
  const participantNames = Array.isArray(parsed.participants)
    ? parsed.participants.map((p) => (typeof p?.displayName === "string" ? p.displayName : "")).filter(Boolean)
    : [];
  const searchFields: string[] = [];
  if (typeof parsed.title === "string" && parsed.title) searchFields.push(parsed.title);
  if (typeof parsed.locationText === "string" && parsed.locationText) searchFields.push(parsed.locationText);
  for (const note of Array.isArray(parsed.sourceNotes) ? parsed.sourceNotes : []) {
    if (typeof note?.text === "string" && note.text) searchFields.push(note.text);
  }
  for (const contribution of Array.isArray(parsed.contributions) ? parsed.contributions : []) {
    if (typeof contribution?.text === "string" && contribution.text) searchFields.push(contribution.text);
  }
  for (const asset of Array.isArray(parsed.assets) ? parsed.assets : []) {
    if (typeof asset?.filename === "string" && asset.filename) searchFields.push(asset.filename);
  }
  searchFields.push(...participantNames);
  const mediaTypes = (Array.isArray(parsed.assets) ? parsed.assets : [])
    .map((asset) => (typeof asset?.type === "string" ? asset.type : ""))
    .filter(Boolean);
  return {
    title: typeof parsed.title === "string" && parsed.title ? parsed.title : "记忆",
    occurredAt: typeof parsed.occurredAt === "string" ? parsed.occurredAt : "",
    participantNames,
    searchFields,
    mediaTypes,
  };
}

/** local_capture payload → 允许展示的投影字段；损坏按空处理（不中断）。 */
function projectLocalPayload(kind: string, raw: string | null): { texts: string[]; fileName: string | null } {
  if (!raw) return { texts: [], fileName: null };
  try {
    const parsed = JSON.parse(raw) as { text?: unknown; fileName?: unknown };
    const texts = typeof parsed.text === "string" ? [parsed.text] : [];
    const fileName = typeof parsed.fileName === "string" ? parsed.fileName : null;
    return { texts: fileName ? [...texts, fileName] : texts, fileName };
  } catch {
    return { texts: [], fileName: null };
  }
}

export async function offlineSearch(input: {
  credentials: Credentials | null;
  userId?: string | null;
  familyId?: string | null;
  query: string;
  filters?: OfflineSearchFilters;
  limit?: number;
}): Promise<OfflineSearchResult[]> {
  const query = input.query.trim().slice(0, SCAN_CAPS.queryChars);
  if (!query) return [];
  const limit = Math.min(input.limit ?? 20, SCAN_CAPS.total);
  let filters = input.filters ?? {};
  if (filters.dateFrom && !DATE_ONLY.test(filters.dateFrom)) filters = { ...filters, dateFrom: undefined };
  if (filters.dateTo && !DATE_ONLY.test(filters.dateTo)) filters = { ...filters, dateTo: undefined };
  const folded = fold(query);
  const db = await getDatabase();
  const results: OfflineSearchResult[] = [];
  const scope = memoryCacheScope(
    input.credentials,
    input.userId ?? undefined,
    input.familyId ?? undefined,
  );

  const memoryById = new Map<string, OfflineSearchResult>();
  const detailMediaTypes = new Map<string, string[]>();

  if (scope) {
    // 时间轴索引：title/参与人显示名/地点；参与人 JSON 只含显示名字符串数组。
    const timelineRows = await db.getAllAsync<{
      id: string;
      title: string;
      occurred_at: string;
      location_text: string | null;
      participant_names_json: string | null;
    }>(
      `SELECT id, title, occurred_at, location_text, participant_names_json
       FROM timeline_event WHERE scope = ?
       ORDER BY occurred_at DESC LIMIT ?`,
      scope,
      SCAN_CAPS.timeline,
    );
    for (const row of timelineRows) {
      const participants = parseJsonArray(row.participant_names_json);
      if (filters.person && !participants.some((name) => matchesQuery(name, fold(filters.person!)))) continue;
      if ((filters.dateFrom || filters.dateTo) && !inDateRange(row.occurred_at, filters)) continue;
      const candidates = [row.title, ...(row.location_text ? [row.location_text] : []), ...participants];
      const hit = candidates.find((text) => text && matchesQuery(text, folded));
      if (!hit) continue;
      memoryById.set(row.id, {
        kind: "memory",
        id: row.id,
        title: row.title,
        snippet:
          hit === row.title
            ? excerpt(row.title, folded)
            : participants.includes(hit)
              ? `参与人：${hit}`
              : `地点：${excerpt(hit, folded, 30)}`,
        hasDetail: false,
        owner: "family",
        sortKey: row.occurred_at,
      });
    }

    // 详情缓存：解析投影字段后匹配；损坏 JSON 单行跳过。
    const detailRows = await db.getAllAsync<{ id: string; detail_json: string; updated_at: string }>(
      `SELECT id, detail_json, updated_at FROM memory_detail WHERE scope = ?
       ORDER BY updated_at DESC LIMIT ?`,
      scope,
      SCAN_CAPS.detail,
    );
    const detailIds: string[] = [];
    for (const row of detailRows) {
      detailIds.push(row.id);
      const projection = projectMemoryDetail(row.detail_json);
      if (!projection) continue;
      detailMediaTypes.set(row.id, projection.mediaTypes);
      if (filters.person && !projection.participantNames.some((name) => matchesQuery(name, fold(filters.person!)))) continue;
      if ((filters.dateFrom || filters.dateTo) && !inDateRange(projection.occurredAt, filters)) continue;
      const hitField = projection.searchFields.find((text) => matchesQuery(text, folded));
      if (!hitField) continue;
      const existing = memoryById.get(row.id);
      if (existing) {
        existing.hasDetail = true;
        continue;
      }
      memoryById.set(row.id, {
        kind: "memory",
        id: row.id,
        title: projection.title,
        snippet: excerpt(hitField, folded),
        hasDetail: true,
        owner: "family",
        sortKey: projection.occurredAt || row.updated_at,
      });
    }

    // hasDetail 语义：当前 scope 内是否有可读详情，而不是「正文刚好命中」。
    if (detailIds.length > 0) {
      const placeholders = detailIds.map(() => "?").join(", ");
      const known = new Set(
        (await db.getAllAsync<{ id: string }>(
          `SELECT id FROM memory_detail WHERE scope = ? AND id IN (${placeholders})`,
          scope,
          ...detailIds,
        )).map((row) => row.id),
      );
      for (const entry of memoryById.values()) if (known.has(entry.id)) entry.hasDetail = true;
    }

    // 媒体类型筛选统一按详情投影的素材类型裁决；只有索引、无法核实素材
    // 类型的记忆诚实排除，而不是猜测。
    if (filters.mediaType) {
      for (const id of memoryById.keys()) {
        const types = detailMediaTypes.get(id);
        if (!types || !types.includes(filters.mediaType)) memoryById.delete(id);
      }
    }
  }

  const memories = [...memoryById.values()].sort((a, b) => (a.sortKey < b.sortKey ? 1 : a.sortKey > b.sortKey ? -1 : a.id < b.id ? -1 : 1));
  results.push(...memories.slice(0, limit));
  const memoryIds = new Set(memories.map((entry) => entry.id));

  // 本机记录：设备主人内容；已归档且对应服务器记忆已在结果中时去重。
  if (results.length < limit) {
    const localRows = await db.getAllAsync<{
      id: string;
      title: string | null;
      occurred_at: string;
      media_type: string | null;
      memory_event_id: string | null;
      payload_json: string | null;
    }>(
      `SELECT id, title, occurred_at, media_type, memory_event_id, payload_json
       FROM local_capture ORDER BY occurred_at DESC, id DESC LIMIT ?`,
      SCAN_CAPS.local,
    );
    for (const row of localRows) {
      if (row.memory_event_id && memoryIds.has(row.memory_event_id)) continue;
      if ((filters.dateFrom || filters.dateTo) && !inDateRange(row.occurred_at, filters)) continue;
      if (filters.person) continue; // 本机记录没有参与人信息，筛选时诚实不显示
      const projection = projectLocalPayload("text", row.payload_json);
      if (filters.mediaType) {
        const localType = row.media_type ?? null;
        if (localType !== filters.mediaType) continue;
      }
      const candidates = [row.title ?? "", ...projection.texts];
      const hit = candidates.find((text) => text && matchesQuery(text, folded));
      if (!hit) continue;
      results.push({
        kind: "local",
        id: row.id,
        title: row.title?.trim() || projection.fileName || "本机记录",
        snippet: excerpt(hit, folded) || "这台设备上的本机记录",
        owner: "device",
        sortKey: row.occurred_at,
      });
      if (results.length >= limit) break;
    }
  }

  // 已下载相册/作品：manifest 解析为投影字段后匹配；无法核实日期/人物
  // 筛选时诚实不显示。
  if (input.credentials && results.length < limit && !filters.dateFrom && !filters.dateTo && !filters.person) {
    try {
      const { searchReadingDownloadsOffline } = await import("../reading/native");
      const reading = await searchReadingDownloadsOffline(input.credentials, folded, limit - results.length);
      for (const item of reading) {
        results.push({
          kind: "reading",
          id: item.key,
          title: item.title,
          snippet: item.matchedText ? excerpt(item.matchedText, folded) : (item.kind === "book" ? "作品 · 已下载，可离线阅读" : "相册 · 已下载，可离线阅读"),
          readingKind: item.kind === "book" ? "book" : "collection",
          owner: "family",
          sortKey: "",
        });
      }
    } catch {
      // 阅读缓存不可用（如从未在线验证）时跳过这一来源，不影响其余结果。
    }
  }

  return results.slice(0, SCAN_CAPS.total);
}
