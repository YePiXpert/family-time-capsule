import "server-only";

import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { user as userTable } from "@/db/schema/auth";
import { getAuth } from "./auth";

/**
 * 两步验证（ID-6/ID-8）服务封装：
 * better-auth twoFactor 插件承载协议与存储（AEAD 加密密钥/恢复码），
 * 这里只提供 UI/测试需要的读取面；启用/验证/禁用/重生成恢复码走插件的
 * HTTP 端点（浏览器 cookie 刷新由插件完成，不在 server action 里调内部
 * API——内部调用无法把轮换后的会话 cookie 写回浏览器）。
 */

export type TwoFactorStatus = {
  enabled: boolean;
};

export async function getTwoFactorStatus(userId: string): Promise<TwoFactorStatus> {
  const rows = await getDb()
    .select({ enabled: userTable.twoFactorEnabled })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1);
  return { enabled: rows[0]?.enabled === true };
}

/** 服务端渲染 totpURI 二维码（不在客户端打包 qrcode）。 */
export async function renderTotpQrDataUrl(totpUri: string): Promise<string | null> {
  if (!/^otpauth:\/\/totp\//u.test(totpUri) || totpUri.length > 2048) return null;
  const QRCode = (await import("qrcode")).default;
  return QRCode.toDataURL(totpUri, { margin: 1, width: 220, errorCorrectionLevel: "M" });
}
