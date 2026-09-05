import { useCallback, useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
  fetchBookRenders,
  startBookRender,
  changeBookRender,
} from "../api/client";
import type { Credentials } from "../types";
import { sharedStyles as s } from "../theme";
import { bookRenderMessage, type BookRenderStatus } from "./render-types";
import { exportPublication } from "./export-publication";
export function NativeBookPublication({
  credentials,
  id,
  audience,
  prepare,
}: {
  credentials: Credentials;
  id: string;
  audience: "personal" | "family";
  prepare: () => Promise<number | null>;
}) {
  const [jobs, setJobs] = useState<BookRenderStatus[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      setJobs(await fetchBookRenders(credentials, id));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [credentials, id]);
  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);
  const active = jobs.some(
    (j) => j.status === "queued" || j.status === "running",
  );
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => void load(), 2000);
    return () => clearInterval(timer);
  }, [active, load]);
  async function perform(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const button = (label: string, onPress: () => void) => (
    <Pressable
      accessibilityRole="button"
      disabled={busy}
      style={[s.secondaryButton, busy && s.disabled]}
      onPress={onPress}
    >
      <Text style={s.secondaryText}>{label}</Text>
    </Pressable>
  );
  function start(format: "pdf" | "epub") {
    void perform(async () => {
      const revision = await prepare();
      if (revision !== null)
        await startBookRender(credentials, id, revision, format);
    });
  }
  return (
    <View style={s.card}>
      <Text style={s.cardTitle}>出版与导出</Text>
      <Text style={s.body}>
        本次按{audience === "family" ? "家庭可读" : "私人阅读"}范围重新校验。PDF
        中文可搜索，EPUB 可调整字号；音视频请回到作品播放。
      </Text>
      <Text style={s.body}>
        导出的是作品副本，接收者可保存或转发，无法远程收回；它不是完整可恢复备份。
      </Text>
      {error ? (
        <Text accessibilityRole="alert" style={s.error}>
          {error}
        </Text>
      ) : null}
      {button("生成 PDF", () => start("pdf"))}
      {button("生成 EPUB", () => start("epub"))}
      {button("刷新出版任务", () => void load())}
      {jobs.map((job) => (
        <View key={job.id} style={s.notice}>
          <Text style={s.label}>
            {job.format.toUpperCase()} · 版本 {job.revision}
          </Text>
          <Text accessibilityLiveRegion="polite">
            {
              {
                queued: "等待排版",
                running: "正在排版",
                succeeded: "排版完成",
                failed: "排版失败",
                cancelled: "已取消",
              }[job.status]
            }{" "}
            · {job.progress}%
          </Text>
          {job.bytes !== null ? (
            <Text style={s.body}>
              {(job.bytes / 1024 / 1024).toFixed(1)} MB
              {job.format === "pdf" ? ` · ${job.pages} 页` : ""}
            </Text>
          ) : null}
          {job.errorCode ? (
            <Text style={s.error}>{bookRenderMessage(job.errorCode)}</Text>
          ) : null}
          {job.status === "succeeded" && !job.downloadable ? (
            <Text style={s.error}>来源或权限已变化，请重新生成。</Text>
          ) : null}
          {job.downloadable
            ? button(
                "下载并导出副本",
                () => void perform(() => exportPublication(credentials, job)),
              )
            : null}
          {["queued", "running"].includes(job.status)
            ? button(
                "取消排版",
                () =>
                  void perform(() =>
                    changeBookRender(credentials, job.id, "cancel"),
                  ),
              )
            : null}
          {["failed", "cancelled"].includes(job.status)
            ? button(
                "重试排版",
                () =>
                  void perform(() =>
                    changeBookRender(credentials, job.id, "retry"),
                  ),
              )
            : null}
          {!["queued", "running"].includes(job.status)
            ? button(
                "清理服务器产物",
                () =>
                  void perform(() =>
                    changeBookRender(credentials, job.id, "remove"),
                  ),
              )
            : null}
        </View>
      ))}
    </View>
  );
}
