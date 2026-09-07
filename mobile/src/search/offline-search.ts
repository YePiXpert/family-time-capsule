import { getDatabase } from "../storage/database";
import { memoryCacheScope } from "../memories/cache-scope";
import type { Credentials } from "../types";

/**
 * 原生离线搜索（FIND-2 / M7-b）。
 *
 * 只搜索这台设备已经合法保存/缓存的内容，绝不为搜索下载更多服务器资料：
 * - timeline_event / memory_detail / people：服务器缓存，scope =
 *   (serverUrl, instanceId, token, userId, familyId) 的哈希；切换目的地或
 *   账号时这些表由 clearServerCaches 清空，A 家庭的内容不会漏给 B。
 * - local_capture：设备主人自己的本机记录，始终可搜。
 * - reading_download：已下载的相册/作品（独立缓存库，同样按 scope 隔离）。
 *
 * 匹配用普通 Unicode 子串（大小写不敏感），中文按包含语义即可，
 * 不引入大型搜索框架。
 */

export type OfflineSearchResult = {
  kind: "memory" | "local" | "reading";
  id: string;
  title: string;
  snippet: string;
  /** 记忆是否已有完整详情缓存：离线时能否直接打开。 */
  hasDetail?: boolean;
  readingKind?: "book" | "collection";
};

function likePattern(query: string): string {
  return `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

function excerpt(text: string, query: string, width = 72): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  const at = normalized.toLowerCase().indexOf(query.toLowerCase());
  if (at < 0) return normalized.slice(0, width);
  const start = Math.max(0, at - 18);
  return (start > 0 ? "…" : "") + normalized.slice(start, start + width);
}

export async function offlineSearch(input: {
  credentials: Credentials | null;
  userId?: string | null;
  familyId?: string | null;
  query: string;
  limit?: number;
}): Promise<OfflineSearchResult[]> {
  const query = input.query.trim();
  if (!query) return [];
  const limit = input.limit ?? 20;
  const pattern = likePattern(query);
  const db = await getDatabase();
  const results: OfflineSearchResult[] = [];
  const scope = memoryCacheScope(
    input.credentials,
    input.userId ?? undefined,
    input.familyId ?? undefined,
  );

  if (scope) {
    const timelineRows = await db.getAllAsync<{
      id: string;
      title: string;
      participant_names_json: string | null;
      location_text: string | null;
    }>(
      `SELECT id, title, participant_names_json, location_text FROM timeline_event
       WHERE (title LIKE ? ESCAPE '\\' OR participant_names_json LIKE ? ESCAPE '\\' OR location_text LIKE ? ESCAPE '\\')
       ORDER BY occurred_at DESC LIMIT ?`,
      pattern,
      pattern,
      pattern,
      limit,
    );
    for (const row of timelineRows) {
      let participants: string[] = [];
      try {
        participants = JSON.parse(row.participant_names_json ?? "[]") as string[];
      } catch {
        participants = [];
      }
      results.push({
        kind: "memory",
        id: row.id,
        title: row.title,
        snippet:
          participants.length > 0
            ? `参与人：${participants.join("、")}`
            : row.location_text
              ? `地点：${excerpt(row.location_text, query, 30)}`
              : "已缓存的时间轴记忆",
        hasDetail: false,
      });
    }

    const detailRows = await db.getAllAsync<{ id: string; detail_json: string }>(
      `SELECT id, detail_json FROM memory_detail WHERE scope = ? AND detail_json LIKE ? ESCAPE '\\' LIMIT ?`,
      scope,
      pattern,
      limit,
    );
    const byId = new Map(results.map((item) => [item.id, item]));
    for (const row of detailRows) {
      let title = "记忆";
      try {
        const parsed = JSON.parse(row.detail_json) as { title?: string };
        title = typeof parsed.title === "string" && parsed.title ? parsed.title : title;
      } catch {
        // 兜底使用默认标题；内容仍按原文匹配。
      }
      const existing = byId.get(row.id);
      if (existing) {
        existing.hasDetail = true;
        continue;
      }
      const item: OfflineSearchResult = {
        kind: "memory",
        id: row.id,
        title,
        snippet: excerpt(row.detail_json, query),
        hasDetail: true,
      };
      byId.set(row.id, item);
      results.push(item);
    }
  }

  const localRows = await db.getAllAsync<{
    id: string;
    title: string | null;
    payload_json: string | null;
  }>(
    `SELECT id, title, payload_json FROM local_capture
     WHERE (title LIKE ? ESCAPE '\\' OR payload_json LIKE ? ESCAPE '\\')
     ORDER BY occurred_at DESC, id DESC LIMIT ?`,
    pattern,
    pattern,
    limit,
  );
  for (const row of localRows) {
    results.push({
      kind: "local",
      id: row.id,
      title: row.title?.trim() || "本机记录",
      snippet: excerpt(row.payload_json ?? "", query) || "这台设备上的本机记录",
    });
  }

  if (input.credentials) {
    try {
      const { searchReadingDownloadsOffline } = await import("../reading/native");
      const reading = await searchReadingDownloadsOffline(
        input.credentials,
        ({ title, manifestJson }) => title.includes(query) || manifestJson.includes(query),
        limit,
      );
      for (const item of reading) {
        results.push({
          kind: "reading",
          id: item.key,
          title: item.title,
          snippet: item.kind === "book" ? "作品 · 已下载，可离线阅读" : "相册 · 已下载，可离线阅读",
          readingKind: item.kind === "book" ? "book" : "collection",
        });
      }
    } catch {
      // 阅读缓存不可用（如从未在线验证）时跳过这一来源，不影响其余结果。
    }
  }

  return results.slice(0, limit * 2);
}
