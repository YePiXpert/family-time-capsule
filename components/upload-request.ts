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

export function uploadWithProgress(
  endpoint: string,
  file: File,
  onProgress: (percent: number) => void,
  fields: Record<string, string> = {},
): Promise<UploadResponse> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    const form = new FormData();
    form.append("file", file);
    form.append("lastModified", String(file.lastModified));
    for (const [key, value] of Object.entries(fields)) form.append(key, value);

    request.open("POST", endpoint);
    request.responseType = "json";
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
