import "server-only";

import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { instanceMeta } from "@/db/schema/instance";

/**
 * 可公开的稳定实例标识（1.3）：
 * - 首次读取时生成并持久化（128 位随机，hex 编码）；
 * - 只用于客户端“连接的是哪一个实例”的识别，不是凭据，不参与授权；
 * - 生成使用 INSERT OR IGNORE 语义，多进程并发下也保持唯一值。
 */
const INSTANCE_ID_KEY = "instance_id";

export async function getInstanceId(): Promise<string> {
  const db = getDb();
  const existing = db
    .select({ value: instanceMeta.value })
    .from(instanceMeta)
    .where(eq(instanceMeta.key, INSTANCE_ID_KEY))
    .limit(1)
    .get();
  if (existing) return existing.value;

  const candidate = randomBytes(16).toString("hex");
  db.insert(instanceMeta)
    .values({ key: INSTANCE_ID_KEY, value: candidate })
    .onConflictDoNothing()
    .run();
  const settled = db
    .select({ value: instanceMeta.value })
    .from(instanceMeta)
    .where(eq(instanceMeta.key, INSTANCE_ID_KEY))
    .limit(1)
    .get();
  if (!settled) throw new Error("instance id is unavailable");
  return settled.value;
}
