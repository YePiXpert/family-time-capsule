/**
 * 搜索分词（M4）：CJK bigram + 拉丁词，纯函数、无副作用。
 *
 * SQLite FTS5 默认 unicode61 分词器把整段中文当一个 token，无法子串匹配；
 * 索引与查询两侧都用本模块预分词后，FTS 即获得 ≥2 字中文词、词组（AND）
 * 与英文单词的匹配能力。单字中文查询由搜索服务回退 LIKE。
 */

const RUN_PATTERN = /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]+|[a-z0-9]+/g;
const CJK_PATTERN = /^[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/u;

/** 索引/查询共用的分词：中文串拆 bigram（单字保留），拉丁/数字串保留整词。 */
export function tokenizeText(input: string): string[] {
  const normalized = input.toLowerCase();
  const runs = normalized.match(RUN_PATTERN) ?? [];
  const tokens: string[] = [];
  for (const run of runs) {
    if (CJK_PATTERN.test(run)) {
      if (run.length === 1) {
        tokens.push(run);
      } else {
        for (let i = 0; i < run.length - 1; i += 1) {
          tokens.push(run.slice(i, i + 2));
        }
      }
    } else {
      tokens.push(run);
    }
  }
  return tokens;
}

/** 索引列内容：空格连接的 token 串。 */
export function tokensForIndex(input: string): string {
  return tokenizeText(input).join(" ");
}

/** 查询列内容；空串表示无法用 FTS（调用方回退 LIKE 或拒绝）。 */
export function tokensForQuery(query: string): string {
  return tokenizeText(query).join(" ");
}

/** FTS MATCH 参数需要引号转义（bigram/单词不含引号，双保险）。 */
export function ftsQueryExpression(query: string): string | null {
  const tokens = tokenizeText(query).map((t) => `"${t.replace(/"/gu, "")}"`);
  if (tokens.length === 0) return null;
  return tokens.join(" ");
}

/** 查询是否为单个 CJK 字符（FTS bigram 无法命中 → LIKE 回退）。 */
export function isSingleCjkChar(query: string): boolean {
  return query.length === 1 && CJK_PATTERN.test(query);
}
