import { classifyImportedFile } from "@/mobile/src/storage/import-policy";
import type { UploadResponse } from "@/components/upload-request";
/** Resumable upload shared by all media types, including documents. */
export async function uploadDraftOriginal(file: File, captureId: string, draftId: string, guard: () => void = () => {}): Promise<UploadResponse> {
  guard();
  const created = await fetch("/api/uploads", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ captureId, draftId, filename: file.name, declaredMime: classifyImportedFile(file.name, file.type)?.mimeType || file.type || "application/octet-stream", totalBytes: file.size, source: "web", importSessionId: null, lastModified: file.lastModified > 0 ? file.lastModified : null }), signal: AbortSignal.timeout(30000) });
  if (!created.ok) {
    const result = await created.json().catch(() => null);
    const reason = created.status === 401 ? "登录已过期，请重新登录后重试。"
      : created.status === 403 ? "当前账号没有上传权限。"
      : created.status === 413 ? "文件超过服务器大小限制（视频最多 500MB）。"
      : result?.error === "mime_not_allowed" || created.status === 415 ? "服务器尚不支持这个文件格式，请更新服务器后重试。"
      : created.status === 409 ? "已有上传与这份原件不一致，请核对后重试。"
      : "服务器暂时无法开始上传，请稍后重试。";
    throw new Error(`${reason}本机原件仍保留。`);
  }
  const descriptor = await created.json();
  if (descriptor.assetId) return { status: "stored", assetId: descriptor.assetId, inboxItemId: descriptor.inboxItemId };
  const endpoint = `/api/uploads/${descriptor.uploadId}`;
  let offset = Number(descriptor.uploadOffset);
  if (["failed", "cancelled", "expired"].includes(descriptor.status)) {
    const retry = await fetch(`${endpoint}/retry`, { method: "POST", signal: AbortSignal.timeout(30000) });
    if (!retry.ok) throw new Error("上传暂时无法恢复，请稍后重试。");
    offset = Number((await retry.json()).uploadOffset);
  }
  while (offset < file.size) {
    guard();
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("服务器返回的上传位置无效。");
    const end = Math.min(offset + 8 * 1024 * 1024, file.size);
    const response = await fetch(endpoint, { method: "PATCH", headers: { "content-type": "application/offset+octet-stream", "upload-offset": String(offset) }, body: file.slice(offset, end), signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error("原件尚未完整上传，可以稍后继续。");
    const next = Number(response.headers.get("upload-offset"));
    if (!Number.isSafeInteger(next) || next <= offset || next > file.size) throw new Error("服务器返回的上传位置无效。");
    offset = next;
  }
  guard();
  const complete = await fetch(`${endpoint}/complete`, { method: "POST", signal: AbortSignal.timeout(120000) });
  if (!complete.ok) throw new Error("服务器尚未确认原件保存成功，请重试。");
  return complete.json();
}
