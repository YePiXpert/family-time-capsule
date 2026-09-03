"use client";

import { useRef, useState } from "react";
import { uploadWithProgress } from "@/components/upload-request";

/**
 * 图片上传（Issue #005）：手机/电脑选择已有照片或现场拍摄均可——
 * 不加 capture 属性强制调相机，相册与拍摄由用户在系统选择器里决定。
 */

type UploadResult = {
  id: string;
  file: File;
  filename: string;
  status: "uploading" | "stored" | "duplicate" | "error";
  progress: number;
  message?: string;
  assetId?: string;
  capturedAt?: string | null;
};

export function ImageUploadForm() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [results, setResults] = useState<UploadResult[]>([]);
  const uploading = results.some((result) => result.status === "uploading");

  function updateResult(id: string, update: Partial<UploadResult>) {
    setResults((current) =>
      current.map((result) =>
        result.id === id ? { ...result, ...update } : result,
      ),
    );
  }

  async function uploadOne(result: UploadResult) {
    updateResult(result.id, { status: "uploading", progress: 0, message: undefined });
    try {
      const data = await uploadWithProgress(
        "/api/upload/image",
        result.file,
        (progress) => updateResult(result.id, { progress }),
      );
      if (data.status === "stored") {
        updateResult(result.id, {
          status: "stored",
          progress: 100,
          assetId: data.assetId,
          capturedAt: data.capturedAt,
        });
        return;
      }
      if (data.status === "duplicate") {
        updateResult(result.id, {
          status: "duplicate",
          progress: 100,
          message: data.message,
          assetId: data.existingAssetId,
        });
        return;
      }
      updateResult(result.id, {
        status: "error",
        message: data.message ?? "上传失败",
      });
    } catch {
      updateResult(result.id, {
        status: "error",
        message: "网络错误，上传失败",
      });
    }
  }

  async function onChange(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) return;
    const pending = files.map((file, index) => ({
      id: `${Date.now()}-${index}-${file.name}`,
      file,
      filename: file.name,
      status: "uploading" as const,
      progress: 0,
    }));
    setResults((current) => [...pending, ...current]);
    if (inputRef.current) inputRef.current.value = "";
    for (const result of pending) await uploadOne(result);
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
      {uploading && (
        <p className="mt-3 text-sm text-foreground/60" role="status">
          正在逐份安全保存…
        </p>
      )}

      <ul
        className="mt-4 flex flex-col gap-2"
        aria-label="上传结果"
        aria-live="polite"
        aria-busy={uploading}
      >
        {results.map((r) => (
          <li
            key={r.id}
            className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-lg border border-foreground/10 px-4 py-3 text-sm"
          >
            <span className="max-w-[60%] truncate" title={r.filename}>
              {r.filename}
            </span>
            {r.status === "uploading" && (
              <span className="flex min-w-36 items-center gap-2 text-foreground/60">
                <progress
                  className="h-2 w-24 accent-accent"
                  max={100}
                  value={r.progress}
                  aria-label={`${r.filename} 上传进度`}
                />
                {r.progress}%
              </span>
            )}
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
              <span className="flex items-center gap-3 text-red-700 dark:text-red-400">
                {r.message}
                <button
                  type="button"
                  onClick={() => void uploadOne(r)}
                  className="min-h-11 rounded-lg border border-current px-3 py-2 text-sm"
                >
                  重试
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
