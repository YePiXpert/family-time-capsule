import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

/** 键排序后的 JSON：两台手机对同一实体算出同一枚指纹。 */
export function canonical(value: unknown): string {
  return JSON.stringify(value, (_, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v as Record<string, unknown>)
            .sort()
            .map((k) => [k, (v as Record<string, unknown>)[k]]),
        )
      : v,
  );
}
export const hashOf = (value: unknown): string =>
  bytesToHex(sha256(new TextEncoder().encode(canonical(value))));
/** 内容哈希：不含 updatedAt、revision 与 ancestors；时间、草稿计数与世系都不是内容。 */
export function contentHashOf(entity: object): string {
  const {
    revision: _r,
    updatedAt: _u,
    ancestors: _a,
    ...rest
  } = entity as Record<string, unknown>;
  return hashOf(rest);
}
/** 最近的源版本在前，最多保留八枚内容哈希前缀。接受库里冻结的世系。 */
export function lineage(previous: { readonly ancestors?: readonly string[] } & object): string[] {
  return [contentHashOf(previous).slice(0, 16), ...(previous.ancestors ?? [])].slice(0, 8);
}
