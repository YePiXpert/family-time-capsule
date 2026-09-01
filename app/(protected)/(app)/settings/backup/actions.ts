"use server";

import { revalidatePath } from "next/cache";
import { requireFamilyCapability } from "@/lib/authz/context";
import { runWebDavBackup } from "@/lib/webdav/service";

export type BackupActionState = { error?: string; message?: string };

export async function runBackupAction(
  _prev: BackupActionState | undefined,
  _formData: FormData,
): Promise<BackupActionState> {
  void _prev;
  void _formData;
  const context = await requireFamilyCapability("backup:manage");
  const result = await runWebDavBackup(context);
  revalidatePath("/settings/backup");
  if (!result.ok) {
    return {
      error:
        result.error === "not_configured"
          ? "尚未配置 WebDAV 目标：请在部署环境设置 WEBDAV_URL / WEBDAV_USERNAME / WEBDAV_PASSWORD。"
          : result.error === "unsafe_url"
            ? "目标 URL 不安全（仅允许 https，或本机 loopback http）。"
            : `备份失败：${result.error}`,
    };
  }
  return {
    message: `备份完成（${result.strategy === "verified-upload" ? "验证上传 + 原子改名" : "验证上传 + 直接落位"}，SHA-256 ${result.sha256.slice(0, 12)}…）。`,
  };
}
