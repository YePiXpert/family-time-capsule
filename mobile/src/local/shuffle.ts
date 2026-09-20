/**
 * 随便翻翻：从 ids 里随机挑一条，有得选时绝不挑 current（连着翻不会翻到同一段）；
 * 空列表返回 undefined。random 可注入，便于测试。
 */
export function pickAnother(
  ids: readonly string[],
  current?: string,
  random: () => number = Math.random,
): string | undefined {
  const pool = ids.length > 1 ? ids.filter((id) => id !== current) : ids;
  if (!pool.length) return undefined;
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
}
