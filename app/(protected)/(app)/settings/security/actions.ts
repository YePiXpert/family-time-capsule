"use server";

import { renderTotpQrDataUrl } from "@/lib/auth/two-factor-service";

/**
 * 服务端渲染 TOTP 二维码：qrcode 不进客户端包；
 * 输入限定 otpauth URI，避免把任意内容变成二维码。
 */
export async function renderQrDataUrlAction(totpUri: string): Promise<string | null> {
  return renderTotpQrDataUrl(totpUri);
}
