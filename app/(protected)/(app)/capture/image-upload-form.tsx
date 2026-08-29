"use client";

import { useRef, useState } from "react";

/**
 * 图片上传（Issue #005）：手机/电脑选择已有照片或现场拍摄均可——
 * 不加 capture 属性强制调相机，相册与拍摄由用户在系统选择器里决定。
 */

type UploadResult = {
  filename: string;
  status: "stored" | "duplicate" | "error";
  message?: string;
  assetId?: string;
  capturedAt?: string | null;
};

export function ImageUploadForm() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [results, setResults] = useState<UploadResult[]>([]);
  const [uploading, setUploading] = useState(false);

  async function uploadOne(file: File): Promise<UploadResult> {
    const form = new FormData();
    form.append("file", file);
    // File.lastModified 作为文件系统时间 fallback（#006 前）
    form.append("lastModified", String(file.lastModified));
    try {
      const res = await fetch("/api/upload/image", { method: "POST", body: form });
      const data = await res.json();
      if (data.status === "stored") {
        return {
          filename: file.name,
          status: "stored",
          assetId: data.assetId,
          capturedAt: data.capturedAt,
        };
      }
      if (data.status === "duplicate") {
        return {
          filename: file.name,
          status: "duplicate",
          message: data.message,
          assetId: data.existingAssetId,
        };
      }
      return {
        filename: file.name,
        status: "error",
        message: data.message ?? "上传失败",
      };
    } catch {
      return { filename: file.name, status: "error", message: "网络错误，上传失败" };
    }
  }

  async function onChange(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) return;
    setUploading(true);
    const uploaded: UploadResult[] = [];
    for (const file of files) {
      uploaded.push(await uploadOne(file));
    }
    setResults((prev) => [...uploaded, ...prev]);
    setUploading(false);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="mt-6">
      <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-foreground/25 bg-foreground/[0.02] px-6 py-10 text-center transition-colors hover:border-accent">
        <span className="text-sm font-medium">选择照片</span>
        <span className="text-xs leading-5 text-foreground/50">
          手机相册、电脑文件里的已有照片都可以；支持多选
        </span>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          className="sr-only"
          onChange={onChange}
          disabled={uploading}
        />
      </label>
      {uploading && <p className="mt-3 text-sm text-foreground/60">上传中…</p>}

      <ul className="mt-4 flex flex-col gap-2" aria-label="上传结果">
        {results.map((r, i) => (
          <li
            key={`${r.filename}-${i}`}
            className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-lg border border-foreground/10 px-4 py-3 text-sm"
          >
            <span className="max-w-[60%] truncate" title={r.filename}>
              {r.filename}
            </span>
            {r.status === "stored" && (
              <span className="text-foreground/60">已保存，等待整理</span>
            )}
            {r.status === "duplicate" && (
              <span className="text-amber-700 dark:text-amber-400">
                {r.message}
                {r.assetId && (
                  <>
                    {" "}
                    <a
                      className="underline underline-offset-2"
                      href={`/api/media/${r.assetId}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      查看已有原件
                    </a>
                  </>
                )}
              </span>
            )}
            {r.status === "error" && (
              <span className="text-red-700 dark:text-red-400">{r.message}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
