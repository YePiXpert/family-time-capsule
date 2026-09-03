import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { rateLimit } from "@/db/schema/auth";

export type SecurityRateLimit = {
  allowed: boolean;
  count: number;
  resetAt: Date;
};

/**
 * Atomic fixed-window limiter backed by the existing persistent rate_limit
 * table. Subjects are one-way hashed so bearer tokens and identifiers never
 * enter the database or logs. The `ftc:` namespace cannot collide with Better
 * Auth's own route keys.
 */
export function consumeSecurityRateLimit(input: {
  scope: string;
  subject: string;
  limit: number;
  windowMs: number;
  now?: Date;
}): SecurityRateLimit {
  if (!/^[a-z0-9:_-]{1,40}$/u.test(input.scope)) {
    throw new Error("invalid rate-limit scope");
  }
  if (
    !Number.isInteger(input.limit) ||
    input.limit < 1 ||
    !Number.isInteger(input.windowMs) ||
    input.windowMs < 1_000
  ) {
    throw new Error("invalid rate-limit policy");
  }
  const nowMs = (input.now ?? new Date()).getTime();
  const windowStartThreshold = nowMs - input.windowMs;
  const subjectHash = createHash("sha256")
    .update(`${input.scope}\0${input.subject}`, "utf8")
    .digest("hex");
  const key = `ftc:${input.scope}:${subjectHash}`;
  const row = getDb()
    .insert(rateLimit)
    .values({ id: randomUUID(), key, count: 1, lastRequest: nowMs })
    .onConflictDoUpdate({
      target: rateLimit.key,
      set: {
        count: sql`case when ${rateLimit.lastRequest} <= ${windowStartThreshold} then 1 else ${rateLimit.count} + 1 end`,
        lastRequest: sql`case when ${rateLimit.lastRequest} <= ${windowStartThreshold} then ${nowMs} else ${rateLimit.lastRequest} end`,
      },
    })
    .returning({ count: rateLimit.count, windowStartedAt: rateLimit.lastRequest })
    .get();
  if (!row) throw new Error("rate limit update failed");
  return {
    allowed: row.count <= input.limit,
    count: row.count,
    resetAt: new Date(row.windowStartedAt + input.windowMs),
  };
}
