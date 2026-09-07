import type { UploadResponse } from "@/components/upload-request";
/** Resumable upload shared by all media types, including documents. */
export async function uploadDraftOriginal(file: File, captureId: string): Promise<UploadResponse> {
  const created = await fetch("/api/uploads", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ captureId, filename: file.name, declaredMime: file.type || "application/octet-stream", totalBytes: file.size, source: "web", importSessionId: null, lastModified: file.lastModified > 0 ? file.lastModified : null }), signal: AbortSignal.timeout(30000) });
  if (!created.ok) throw new Error("未能开始上传，本机原件仍保留。请检查格式、网络与权限。");
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
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("服务器返回的上传位置无效。");
    const end = Math.min(offset + 8 * 1024 * 1024, file.size);
    const response = await fetch(endpoint, { method: "PATCH", headers: { "content-type": "application/offset+octet-stream", "upload-offset": String(offset) }, body: file.slice(offset, end), signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error("原件尚未完整上传，可以稍后继续。");
    const next = Number(response.headers.get("upload-offset"));
    if (!Number.isSafeInteger(next) || next <= offset || next > file.size) throw new Error("服务器返回的上传位置无效。");
    offset = next;
  }
  const complete = await fetch(`${endpoint}/complete`, { method: "POST", signal: AbortSignal.timeout(120000) });
  if (!complete.ok) throw new Error("服务器尚未确认原件保存成功，请重试。");
  return complete.json();
}

/**
 * §5 私密原件直传：带 visibility=private，服务端不进入全家可见的
 * 收件箱/资料库窗口。大文件的断点续传通道暂不支持私密标记（如实限制）。
 */
export async function uploadDraftOriginalPrivate(file: File): Promise<UploadResponse> {
  const endpoint = file.type.startsWith("image/") ? "/api/upload/image" : "/api/upload/media";
  const form = new FormData();
  form.append("file", file, file.name);
  form.append("filename", file.name);
  if (file.lastModified > 0) form.append("lastModified", String(file.lastModified));
  form.append("visibility", "private");
  const response = await fetch(endpoint, { method: "POST", body: form, signal: AbortSignal.timeout(120000) });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body || (body.status !== "stored" && body.status !== "duplicate")) {
    throw new Error(body?.message ?? "私密原件上传未完成，本机原件仍保留。");
  }
  return { status: body.status, assetId: body.assetId ?? body.existingAssetId ?? null, inboxItemId: body.inboxItemId ?? null, message: body.message };
}
