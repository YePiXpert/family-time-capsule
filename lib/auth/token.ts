import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

/**
 * 常数时间比较。先做 SHA-256 等长化，避免 timingSafeEqual 在长度不同时抛错，
 * 也避免长度差异本身成为时序信号。
 */
export function safeTokenEqual(candidate: string, expected: string): boolean {
  const a = createHash("sha256").update(candidate, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}
