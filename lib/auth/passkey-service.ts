import "server-only";

import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { passkey } from "@/db/schema/auth";
import type { PasskeyListItem } from "./passkey";

/** 通行密钥读取面（UI 与测试用）；写路径全部经 /api/auth/passkey/* 端点。 */
export async function listPasskeysForUser(userId: string) {
  return getDb()
    .select({
      id: passkey.id,
      label: passkey.label,
      createdAt: passkey.createdAt,
      lastUsedAt: passkey.lastUsedAt,
      deviceType: passkey.deviceType,
      backedUp: passkey.backedUp,
    })
    .from(passkey)
    .where(eq(passkey.userId, userId))
    .orderBy(desc(passkey.createdAt));
}

export type { PasskeyListItem };
