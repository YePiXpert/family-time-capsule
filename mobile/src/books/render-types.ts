export type BookRenderStatus = {
  id: string;
  projectId: string;
  revision: number;
  format: "pdf" | "epub" | "reading_zip";
  audience: "family" | "personal";
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  progress: number;
  pages: number | null;
  bytes: number | null;
  sha256: string | null;
  errorCode: string | null;
  downloadable: boolean;
  updatedAt: string;
};
export function bookRenderMessage(code: string | null) {
  if (code?.startsWith("unsupported_glyph_U"))
    return `嵌入字体缺少字符 ${code.slice("unsupported_glyph_".length)}，请调整文字后重试。`;
  return (
    (
      {
        source_unavailable: "部分来源已删除或当前读者无权阅读，请调整选材。",
        source_changed: "来源已变化，请检查作品并重新生成。",
        render_quota_exceeded: "家庭出版缓存已满，请清理旧产物后重试。",
        output_limit_exceeded: "产物超过容量限制，请拆分作品。",
        page_limit_exceeded: "作品超过 200 页，请拆分成多册。",
        render_timeout: "排版超时，可拆分作品后重试。",
        render_busy: "后台正在排版，请稍后再试。",
        font_missing: "服务器缺少出版字体，请联系管理员恢复字体文件。",
        render_queue_full: "出版队列已满，请稍后再试。",
        worker_interrupted: "后台任务中断，可以重试。",
        render_missing: "产物文件已清理，请重新生成。",
        invalid_job_state: "任务仍在停止中，请稍后刷新。",
      } as Record<string, string>
    )[code || ""] || "排版暂未完成，请重试；编辑内容仍已保存。"
  );
}
