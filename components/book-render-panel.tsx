"use client";
import { useCallback, useEffect, useState } from "react";
import {
  bookRenderMessage,
  type BookRenderStatus,
} from "@/mobile/src/books/render-types";
async function request<T>(
  url: string,
  body?: unknown,
  method = "POST",
): Promise<T> {
  const response = await fetch(
    url,
    body
      ? {
          method,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }
      : { cache: "no-store" },
  );
  const result = await response.json();
  if (!response.ok) throw new Error(bookRenderMessage(result.error));
  return result;
}
export function BookRenderPanel({
  id,
  audience,
  prepare,
}: {
  id: string;
  audience: "personal" | "family";
  prepare: () => Promise<number | null>;
}) {
  const [jobs, setJobs] = useState<BookRenderStatus[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      setJobs(
        (
          await request<{ jobs: BookRenderStatus[] }>(
            `/api/books/projects/${id}/renders`,
          )
        ).jobs,
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);
  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);
  const active = jobs.some(
    (j) => j.status === "queued" || j.status === "running",
  );
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => void load(), 1500);
    return () => clearInterval(timer);
  }, [active, load]);
  async function start(format: "pdf" | "epub") {
    setBusy(true);
    setError("");
    try {
      const revision = await prepare();
      if (revision === null) return;
      await request(`/api/books/projects/${id}/renders`, { format, revision });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function change(job: string, operation: string) {
    setBusy(true);
    setError("");
    try {
      await request(`/api/books/renders/${job}`, { operation }, "PATCH");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      aria-label="出版与下载"
      className="my-8 rounded-2xl border border-line p-5"
    >
      <h2 className="text-2xl">出版与下载</h2>
      <p className="my-3 text-sm text-muted">
        本次按{audience === "family" ? "家庭可读" : "私人阅读"}范围重新校验。PDF
        中文可搜索；EPUB
        可调整字号。后台排版期间可以继续记录，低清照片不会变成高清原图。
      </p>
      {error ? <p role="alert">{error}</p> : null}
      <div className="my-3 flex flex-wrap gap-3">
        <button
          className="ui-button-primary"
          disabled={busy}
          onClick={() => void start("pdf")}
        >
          生成 PDF
        </button>
        <button
          className="ui-button-secondary"
          disabled={busy}
          onClick={() => void start("epub")}
        >
          生成 EPUB
        </button>
        <button className="ui-button-secondary" onClick={() => void load()}>
          刷新出版状态
        </button>
      </div>
      {jobs.length === 0 ? (
        <p className="text-sm text-muted">
          选择格式后开始生成；作品编辑会先保存。
        </p>
      ) : null}
      <ol className="space-y-4">
        {jobs.map((job) => (
          <li key={job.id} className="rounded-xl border border-line p-4">
            <p>
              版本 {job.revision} · {job.format.toUpperCase()} ·{" "}
              {
                {
                  queued: "等待后台排版",
                  running: "正在排版",
                  succeeded: "已完成",
                  failed: "未完成",
                  cancelled: "已取消",
                }[job.status]
              }
            </p>
            {job.status === "running" ? (
              <progress aria-label="排版进度" max={100} value={job.progress} />
            ) : null}
            {job.bytes ? (
              <p className="text-sm text-muted">
                {(job.bytes / 1024 / 1024).toFixed(1)} MB
                {job.format === "pdf" ? ` · ${job.pages} 页` : ""}
              </p>
            ) : null}
            {job.errorCode ? (
              <p role="alert">{bookRenderMessage(job.errorCode)}</p>
            ) : null}
            {job.status === "succeeded" && !job.downloadable ? (
              <p role="alert">
                来源或权限有变化，旧产物已停止下载，请检查作品并重新生成。
              </p>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-3">
              {job.downloadable ? (
                <>
                  <a
                    className="ui-button-primary"
                    href={`/api/books/renders/${job.id}/download`}
                  >
                    下载 {job.format.toUpperCase()}
                  </a>
                  {job.format === "pdf" ? (
                    <a
                      className="ui-button-secondary"
                      href={`/api/books/renders/${job.id}/download?preview=1`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      打开 PDF 预览
                    </a>
                  ) : null}
                </>
              ) : null}
              {["queued", "running"].includes(job.status) ? (
                <button
                  className="ui-button-secondary"
                  disabled={busy}
                  onClick={() => void change(job.id, "cancel")}
                >
                  取消排版
                </button>
              ) : null}
              {["failed", "cancelled"].includes(job.status) ? (
                <button
                  className="ui-button-secondary"
                  disabled={busy}
                  onClick={() => void change(job.id, "retry")}
                >
                  重试排版
                </button>
              ) : null}
              {job.bytes ? (
                <button
                  className="ui-button-secondary"
                  disabled={busy}
                  onClick={() => void change(job.id, "remove")}
                >
                  清理此下载产物
                </button>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
