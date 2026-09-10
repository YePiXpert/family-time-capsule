import { classifyImportedFile } from "@/mobile/src/storage/import-policy";
import type { UploadResponse } from "@/components/upload-request";

export type DraftUploadProgress = {
  uploadedBytes: number;
  totalBytes: number;
  phase: "uploading" | "retrying" | "confirming";
  retry?: number;
};
const CHUNK_BYTES = 8 * 1024 * 1024;
const MAX_RETRIES = 3;
class UploadHttpError extends Error {
  constructor(message: string, readonly retryable: boolean) { super(message); }
}
function transient(error: unknown): boolean {
  return error instanceof UploadHttpError ? error.retryable
    : error instanceof TypeError || (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name));
}
async function failedResponse(response: Response): Promise<UploadHttpError> {
  const body = await response.json().catch(() => null);
  const retryable = [408, 429, 502, 503, 504].includes(response.status) || response.status >= 500
    || (response.status === 409 && ["offset_mismatch", "upload_busy"].includes(body?.error));
  const reason = response.status === 401 ? "登录已过期，请重新登录后重试。"
    : response.status === 403 ? "当前账号没有上传权限。"
    : response.status === 413 ? "服务器或网络代理拒绝了上传大小，请检查上传限制。"
    : body?.error === "mime_not_allowed" || response.status === 415 ? "服务器尚不支持这个文件格式，请更新服务器后重试。"
    : response.status === 409 ? retryable ? "上传进度暂时冲突，正在重新核对。" : "已有上传与这份原件不一致，请核对后重试。"
    : response.status === 404 || response.status === 410 ? "上传会话已失效，请重新打开这条记录后重试。"
    : `服务器暂时无法接收上传（${response.status}），请稍后重试。`;
  return new UploadHttpError(reason + "本机原件仍保留。", retryable);
}
function offsetValue(value: unknown, size: number): number {
  if ((typeof value !== "number" && typeof value !== "string") || value === "") throw new Error("服务器未返回有效上传进度，本机原件仍保留。");
  const offset = Number(value);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > size) throw new Error("服务器返回的上传位置无效，本机原件仍保留。");
  return offset;
}

/** Confirm offsets after a lost reply; never infer that an unacknowledged chunk arrived. */
export async function uploadDraftOriginal(
  file: File,
  captureId: string,
  draftId: string,
  guard: () => void = () => {},
  onProgress: (progress: DraftUploadProgress) => void = () => {},
): Promise<UploadResponse> {
  const declaration = JSON.stringify({ captureId, draftId, filename: file.name, declaredMime: classifyImportedFile(file.name, file.type)?.mimeType || file.type || "application/octet-stream", totalBytes: file.size, source: "web", importSessionId: null, lastModified: file.lastModified > 0 ? file.lastModified : null });
  let offset = 0;
  const progress = (phase: DraftUploadProgress["phase"], retry?: number) => onProgress({ uploadedBytes: offset, totalBytes: file.size, phase, retry });
  const pause = async (attempt: number) => {
    progress("retrying", attempt);
    await new Promise(resolve => setTimeout(resolve, 500 * 2 ** (attempt - 1)));
    guard();
  };
  const request = async (url: string, init: RequestInit, timeout = 30000) => {
    guard();
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeout) });
    if (!response.ok) throw await failedResponse(response);
    return response;
  };
  const retryRequest = async (url: string, init: RequestInit, timeout = 30000) => {
    for (let attempt = 0; ; attempt++) {
      guard();
      try { return await request(url, init, timeout); }
      catch (error) {
        if (!transient(error) || attempt >= MAX_RETRIES) throw error;
        await pause(attempt + 1);
      }
    }
  };
  const declare = () => request("/api/uploads", { method: "POST", headers: { "content-type": "application/json" }, body: declaration }).then(r => r.json());
  try {
    guard(); progress("uploading");
    const created = await retryRequest("/api/uploads", { method: "POST", headers: { "content-type": "application/json" }, body: declaration });
    const descriptor = await created.json();
    guard();
    if (descriptor.assetId) {
      offset = file.size; progress("confirming");
      return { status: "stored", assetId: descriptor.assetId, inboxItemId: descriptor.inboxItemId };
    }
    if (typeof descriptor.uploadId !== "string" || !descriptor.uploadId) throw new Error("服务器未返回上传会话，本机原件仍保留。");
    const endpoint = `/api/uploads/${encodeURIComponent(descriptor.uploadId)}`;
    offset = offsetValue(descriptor.uploadOffset, file.size);
    if (["failed", "cancelled", "expired"].includes(descriptor.status)) {
      const retry = await retryRequest(`${endpoint}/retry`, { method: "POST" });
      offset = offsetValue((await retry.json()).uploadOffset, file.size);
    }
    const confirmOffset = async () => {
      const response = await request(endpoint, { method: "HEAD" });
      const header = response.headers.get("upload-offset");
      if (header !== null) return offsetValue(header, file.size);
      // Some intermediaries omit nonstandard response headers. The idempotent
      // declaration returns the same receipt in JSON without creating a new upload.
      const receipt = await declare();
      if (receipt.uploadId !== descriptor.uploadId) throw new Error("上传会话发生变化，请重新打开记录后核对。");
      return offsetValue(receipt.uploadOffset, file.size);
    };
    let failures = 0;
    while (offset < file.size) {
      guard(); progress("uploading");
      const start = offset, end = Math.min(start + CHUNK_BYTES, file.size);
      try {
        const response = await request(endpoint, { method: "PATCH", headers: { "content-type": "application/offset+octet-stream", "upload-offset": String(start) }, body: file.slice(start, end) }, 120000);
        const header = response.headers.get("upload-offset");
        const next = header === null ? await confirmOffset() : offsetValue(header, file.size);
        if (next <= start) throw new Error("服务器返回的上传位置未前进，本机原件仍保留。");
        offset = next; failures = 0; progress("uploading");
      } catch (error) {
        guard();
        if (!transient(error) || failures >= MAX_RETRIES) throw error;
        await pause(++failures);
        try {
          const confirmed = await confirmOffset();
          if (confirmed < start) throw new Error("服务器上传进度意外回退，请重新打开记录后核对。");
          offset = confirmed;
          if (offset > start) failures = 0;
        } catch (checkError) {
          if (!transient(checkError)) throw checkError;
          // Replaying these exact bytes at the last acknowledged offset is safe;
          // the server validates a replay rather than appending duplicate bytes.
        }
      }
    }
    guard(); progress("confirming");
    const complete = await retryRequest(`${endpoint}/complete`, { method: "POST" }, 120000);
    guard();
    return await complete.json();
  } catch (error) {
    if (error instanceof UploadHttpError || (error instanceof Error && /[一-鿿]/u.test(error.message))) throw error;
    if (transient(error)) throw new Error("网络中断或上传超时，自动续传暂未成功。点重试会从服务器已收到的位置继续，本机原件仍保留。");
    throw error;
  }
}
