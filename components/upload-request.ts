export type UploadResponse = {
  status?: "stored" | "duplicate" | "error";
  message?: string;
  assetId?: string;
  inboxItemId?: string;
  existingAssetId?: string;
  capturedAt?: string | null;
  success?: true;
  error?: string;
};

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

export function describeUploadError(error: unknown): string {
  const code = error instanceof Error ? error.message : String(error ?? "");
  if (/[一-鿿]/.test(code)) return code;
  switch (code) {
    case "http_413":
      return "文件超出大小限制，请压缩或换一份后再试。";
    case "chunk_409":
      return "上传进度发生冲突，请重试。";
    case "offset_404":
      return "上传会话已过期，请刷新页面后重试。";
    case "network_error":
      return "网络中断，请重试。";
    case "upload_timeout":
      return "上传超时，网络可能不稳定，请重试。";
    default:
      return "上传失败，请重试。";
  }
}

export function uploadWithProgress(
  endpoint: string,
  file: File,
  onProgress: (percent: number) => void,
  fields: Record<string, string> = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<UploadResponse> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    const form = new FormData();
    form.append("file", file);
    form.append("lastModified", String(file.lastModified));
    for (const [key, value] of Object.entries(fields)) form.append(key, value);

    request.open("POST", endpoint);
    request.responseType = "json";
    request.timeout = timeoutMs;
    request.addEventListener("timeout", () => {
      request.abort();
      reject(new Error("upload_timeout"));
    });
    request.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable || event.total === 0) return;
      // 100% is reserved for the server's validation/storage response.
      onProgress(Math.min(99, Math.round((event.loaded / event.total) * 100)));
    });
    request.addEventListener("load", () => {
      const response = request.response as UploadResponse | null;
      if (!response || typeof response !== "object") {
        reject(new Error("invalid_response"));
        return;
      }
      onProgress(100);
      resolve(response);
    });
    request.addEventListener("error", () => reject(new Error("network_error")));
    request.addEventListener("abort", () => reject(new Error("aborted")));
    request.send(form);
  });
}
