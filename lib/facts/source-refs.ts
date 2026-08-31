import "server-only";

/**
 * M3-D：精确 FactSource locator 的服务端验证。
 *
 * 协议：AI prompt 中用一次性别名（T1/T2…=transcript，A1/A2…=asset（含其
 * 视觉分析/OCR），C1/C2…=contribution）指代来源；模型只能引用别名并给出
 * 可选引文。服务端负责：
 * 1. 别名映射——模型编造的别名直接丢弃（内部随机 ID 从不进入 prompt，
 *    prompt 注入拿不到任何真实 ID）；
 * 2. 引文锁——quote 必须能在来源当前文本中逐字找到，否则该引用作废；
 * 3. 时间 locator——startMs/endMs 只由服务端从 transcript segment 推导，
 *    模型自报的毫秒数一律不信任；
 * 4. 一条 fact 的引用全部失效 → 整条丢弃（绝不出现无来源的 AI 事实）。
 */

export const MAX_SOURCE_QUOTE_CHARS = 300;
export const MAX_SOURCES_PER_FACT = 5;

export type ResolvedSourceType =
  | "asset"
  | "asset_analysis"
  | "contribution"
  | "transcript";

export type TranscriptSegmentRef = {
  startSeconds: number;
  endSeconds: number;
  text: string;
};

export type SourceAlias = {
  alias: string;
  kind: "transcript" | "asset" | "contribution";
  /** transcript 行 id / asset id / contribution id */
  sourceId: string;
  /** 供引文验证的当前文本（edited 优先）；asset 整体引用不允许引文 */
  searchText: string | null;
  /** transcript 专属：segments（秒）用于推导时间 locator */
  segments: readonly TranscriptSegmentRef[] | null;
  /** 该来源绑定的素材文件名（提示词展示用） */
  label: string;
  /**
   * asset 专属：该素材最新视觉分析的可验证文本（description + OCR）。
   * 带引文且能逐字验证时，来源落为 asset_analysis；sourceId 仍指向
   * asset id（durable、随档恢复），因为分析行本身是可重建的 derivative，
   * 确认事实的引用在灾难恢复后必须仍然可解析。
   */
  analysis: { searchText: string } | null;
};

export type ModelSourceRef = {
  ref?: unknown;
  quote?: unknown;
  startMs?: unknown;
  endMs?: unknown;
};

export type ResolvedSourceRef = {
  sourceType: ResolvedSourceType;
  sourceId: string;
  quote: string | null;
  startMs: number | null;
  endMs: number | null;
};

function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** 空白差异容忍的逐字包含检查。 */
function containsVerbatim(haystack: string, needle: string): boolean {
  return normalizeWhitespace(haystack).includes(normalizeWhitespace(needle));
}

/**
 * 在 segments 中定位引文所在段：优先引文覆盖整段（模型常摘录整句），
 * 其次段文本包含引文。找不到 → null（不猜时间）。
 */
function findSegmentForQuote(
  segments: readonly TranscriptSegmentRef[],
  quote: string,
): TranscriptSegmentRef | null {
  const q = normalizeWhitespace(quote);
  if (!q) return null;
  let fallback: TranscriptSegmentRef | null = null;
  for (const segment of segments) {
    const s = normalizeWhitespace(segment.text);
    if (!s) continue;
    if (q.includes(s)) return segment;
    if (s.includes(q) && !fallback) fallback = segment;
  }
  return fallback;
}

export class SourceAliasRegistry {
  private readonly byAlias = new Map<string, SourceAlias>();

  register(alias: SourceAlias): void {
    this.byAlias.set(alias.alias, alias);
  }

  get(alias: string): SourceAlias | undefined {
    return this.byAlias.get(alias);
  }

  /** 上下文截断时同步下线别名，防止模型引用已不可见的来源。 */
  unregister(alias: string): void {
    this.byAlias.delete(alias);
  }

  entries(): SourceAlias[] {
    return [...this.byAlias.values()];
  }

  /**
   * 解析模型返回的一条 source 引用。任何不可验证的部分都被静默降级：
   * 未知别名 → null；无法逐字验证的引文 → null；时间永远取 segment 推导值。
   */
  resolveRef(ref: ModelSourceRef): ResolvedSourceRef | null {
    if (typeof ref.ref !== "string") return null;
    const alias = this.byAlias.get(ref.ref);
    if (!alias) return null; // 编造的别名（或注入的内部 ID）一律拒绝

    let quote: string | null = null;
    if (ref.quote !== undefined && ref.quote !== null) {
      if (typeof ref.quote !== "string") return null;
      const trimmed = ref.quote.trim();
      if (trimmed.length === 0 || trimmed.length > MAX_SOURCE_QUOTE_CHARS) {
        return null;
      }
      // 引文锁：quote 必须逐字出现在来源文本中。asset 别名的可验证文本是其
      // 视觉分析（description + OCR）；素材本体没有可引用的文字。
      const quoteTarget =
        alias.kind === "asset"
          ? (alias.analysis?.searchText ?? null)
          : alias.searchText;
      if (!quoteTarget || !containsVerbatim(quoteTarget, trimmed)) {
        return null;
      }
      quote = trimmed;
    }

    switch (alias.kind) {
      case "asset": {
        // 引文已在上方对 analysis 文本验证通过 → asset_analysis 精确引用；
        // 无引文 → asset 整体证据。sourceId 始终是 durable 的 asset id。
        if (quote && alias.analysis) {
          return {
            sourceType: "asset_analysis",
            sourceId: alias.sourceId,
            quote,
            startMs: null,
            endMs: null,
          };
        }
        if (quote) return null; // 引文无法落到任何可验证文本
        return {
          sourceType: "asset",
          sourceId: alias.sourceId,
          quote: null,
          startMs: null,
          endMs: null,
        };
      }
      case "transcript": {
        let startMs: number | null = null;
        let endMs: number | null = null;
        if (
          quote &&
          alias.segments &&
          alias.segments.length > 0
        ) {
          const segment = findSegmentForQuote(alias.segments, quote);
          if (segment) {
            startMs = Math.max(0, Math.round(segment.startSeconds * 1000));
            endMs = Math.max(startMs, Math.round(segment.endSeconds * 1000));
          }
        }
        return {
          sourceType: "transcript",
          sourceId: alias.sourceId,
          quote,
          startMs,
          endMs,
        };
      }
      case "contribution":
        return {
          sourceType: "contribution",
          sourceId: alias.sourceId,
          quote,
          startMs: null,
          endMs: null,
        };
    }
  }
}

export function parseSegmentsJson(
  segmentsJson: string | null,
): TranscriptSegmentRef[] | null {
  if (!segmentsJson) return null;
  try {
    const parsed = JSON.parse(segmentsJson) as unknown;
    if (!Array.isArray(parsed)) return null;
    const segments: TranscriptSegmentRef[] = [];
    for (const item of parsed) {
      if (item === null || typeof item !== "object") continue;
      const seg = item as Record<string, unknown>;
      if (
        typeof seg.startSeconds !== "number" ||
        typeof seg.endSeconds !== "number" ||
        typeof seg.text !== "string"
      ) {
        continue;
      }
      segments.push({
        startSeconds: seg.startSeconds,
        endSeconds: seg.endSeconds,
        text: seg.text,
      });
    }
    return segments;
  } catch {
    return null;
  }
}

/** 把秒级时间码格式化为 00:31 的展示（prompt 内用）。 */
export function formatSegmentClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * 解析模型 facts[].sources 载荷：返回去重后的有效引用（每条上限 5）。
 */
export function resolveFactSources(
  registry: SourceAliasRegistry,
  rawSources: unknown,
): ResolvedSourceRef[] {
  if (!Array.isArray(rawSources)) return [];
  const resolved: ResolvedSourceRef[] = [];
  const seen = new Set<string>();
  for (const item of rawSources) {
    if (item === null || typeof item !== "object") continue;
    const ref = registry.resolveRef(item as ModelSourceRef);
    if (!ref) continue;
    const key = `${ref.sourceType}:${ref.sourceId}:${ref.quote ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    resolved.push(ref);
    if (resolved.length >= MAX_SOURCES_PER_FACT) break;
  }
  return resolved;
}
