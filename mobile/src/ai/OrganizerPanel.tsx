import { useCallback, useRef, useState } from "react";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { Pressable, View } from "react-native";
import { Text } from "../components/typography";
import { ApiError, fetchOrganizerReview, mutateOrganizerReview, parseOrganizerReview } from "../api/client";
import { memoryCacheScope } from "../memories/cache-scope";
import { NameEditor } from "../names/NameEditor";
import { TranscriptEditor } from "../transcripts/TranscriptEditor";
import { useApp } from "../state/AppContext";
import { deleteMeta, getMeta, setMeta } from "../storage/database";
import { useSharedStyles } from "../theme";
import type { AppNavigation } from "../navigation/types";
import { aiJobFailureMessage } from "./job-messages";
import type { OrganizerTarget, OrganizerOperation, OrganizerReview } from "./organizer-types";

type Props = OrganizerTarget & { label?: string; onSaved?: () => void; assetOperation?: "name" | "transcribe"; defaultOpen?: boolean };
export function OrganizerPanel(props: Props) {
  const s = useSharedStyles();
  const { credentials, viewer, family } = useApp();
  const scope = memoryCacheScope(credentials, viewer?.id, family?.id);
  if (!credentials || !scope) return <Text style={s.body}>本机内容已保存，同步后才能使用服务端 AI。</Text>;
  if (!["owner", "admin", "editor"].includes(viewer?.role ?? "")) return props.kind === "asset" && props.assetOperation !== "name" ? <TranscriptEditor assetId={props.id} label={props.label ?? "录音或视频"} /> : null;
  return <Panel key={JSON.stringify([scope, props.kind, props.id])} {...props} scope={scope} />;
}
function Panel({ kind, id, label, onSaved, scope, assetOperation = "transcribe", defaultOpen = false }: Props & { scope: string }) {
  const s = useSharedStyles();
  const { credentials, online } = useApp();
  const navigation = useNavigation<AppNavigation>();
  const [opened, setOpened] = useState(defaultOpen), [review, setReview] = useState<OrganizerReview | null>(null), [verified, setVerified] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [refreshVersion, setRefreshVersion] = useState(0);
  const generation = useRef(0), timer = useRef<ReturnType<typeof setTimeout> | null>(null), previous = useRef("");
  const cacheKey = `organizer:${scope}:${kind}:${id}`;
  const receive = useCallback((next: OrganizerReview | null) => {
    const signature = JSON.stringify([next?.names, next?.transcripts]);
    if (previous.current && previous.current !== signature) setRefreshVersion(value => value + 1);
    previous.current = signature; setReview(next);
  }, []);
  const load = useCallback(async function load() {
    if (!opened) return;
    const request = ++generation.current;
    if (timer.current) clearTimeout(timer.current);
    setVerified(false); setBusy(true); setError(null);
    let cached: OrganizerReview | null = null;
    try {
      const raw = await getMeta(cacheKey);
      try { if (raw) { const parsed = parseOrganizerReview(JSON.parse(raw)); if (parsed.target.kind === kind && parsed.target.id === id) cached = parsed; } } catch { /* Invalid cache grants no authority. */ }
      if (request !== generation.current) return;
      if (!credentials || online === false) { receive(cached); setError("当前离线，可查看缓存结果；联网复核后才能处理。"); return; }
      const next = await fetchOrganizerReview(credentials, { kind, id });
      if (request !== generation.current) return;
      await setMeta(cacheKey, JSON.stringify(next));
      if (request !== generation.current) return;
      receive(next); setVerified(true);
      if (next.tasks.some(task => task.active)) timer.current = setTimeout(() => void load(), 3000);
    } catch (reason) {
      if (request !== generation.current) return;
      if (reason instanceof ApiError && [401, 403, 404].includes(reason.status)) { receive(null); await deleteMeta(cacheKey); }
      else receive(cached);
      if (request === generation.current) setError(reason instanceof ApiError && reason.status === 404 ? "当前服务器或素材尚不支持此操作，请核对配套版本。" : reason instanceof Error ? reason.message : "无法读取整理结果。");
    } finally { if (request === generation.current) setBusy(false); }
  }, [cacheKey, credentials, id, kind, online, opened, receive]);
  useFocusEffect(useCallback(() => { void load(); return () => { generation.current++; if (timer.current) clearTimeout(timer.current); }; }, [load]));
  const mutate = async (operation: OrganizerOperation, jobId?: string) => {
    if (!credentials || !verified || online === false || busy) return;
    const request = ++generation.current;
    if (timer.current) clearTimeout(timer.current);
    setBusy(true); setError(null);
    try {
      const next = await mutateOrganizerReview(credentials, { kind, id }, operation, jobId);
      if (request !== generation.current) return;
      await setMeta(cacheKey, JSON.stringify(next));
      if (request !== generation.current) return;
      receive(next); timer.current = setTimeout(() => void load(), 1500);
    } catch (reason) {
      if (request !== generation.current) return;
      setVerified(false);
      if (reason instanceof ApiError && [401, 403, 404].includes(reason.status)) { receive(null); await deleteMeta(cacheKey); }
      if (request === generation.current) setError(reason instanceof ApiError && reason.code ? aiJobFailureMessage(reason.code) : reason instanceof Error ? reason.message : "整理请求未完成。");
    } finally { if (request === generation.current) setBusy(false); }
  };
  const transcription = kind === "asset" && assetOperation === "transcribe";
  const capability = review?.settings.capabilities.find(row => row.capability === (transcription ? "transcription" : "text"));
  const active = review?.tasks.some(task => task.active), disabled = busy || !verified || online === false;
  return <View>
    <View style={s.card}>
      <Pressable onPress={() => setOpened(!opened)} style={s.secondaryButton}><Text style={s.secondaryText}>{transcription ? "转成文字" : "AI 帮我起名"}</Text></Pressable>
      {opened ? <>
        <Text style={s.body}>仅处理所选素材。原件随时可看可听，建议经你确认后才会采用。</Text>
        {error ? <Text accessibilityRole="alert" style={s.warningText}>{error}</Text> : null}
        {review ? <>
          <Text style={s.body}>{!review.settings.configured ? "AI 未配置" : !capability?.available ? "所需模型未配置" : !capability.consented ? "等待管理员同意外部处理" : `${review.settings.provider} · ${capability.model}`}</Text>
          {review.settings.configured && !review.settings.workerAvailable ? <Text style={s.warningText}>后台暂不可用，任务会保留等待；记录与播放仍可使用。</Text> : null}
          <Pressable disabled={disabled || active || !capability?.available || !capability.consented} onPress={() => void mutate(transcription ? "transcribe" : "name")} style={[s.primaryButton, disabled && s.disabled]}><Text style={s.primaryText}>{transcription ? "开始转成文字" : "生成标题建议"}</Text></Pressable>
          {review.tasks.map((task, index) => <View key={task.id} style={s.card}>
            <Text accessibilityLiveRegion="polite" style={s.body}>{task.message}</Text>
            {task.steps.map((step, i) => <Text key={i} style={s.body}>{step.label} · {({ pending: "等待中", running: "处理中", completed: "完成", failed: "失败", cancelled: "已取消" })[step.status]}</Text>)}
            {task.canCancel ? <Pressable disabled={disabled} onPress={() => void mutate("cancel", task.id)} style={s.secondaryButton}><Text style={s.secondaryText}>取消任务</Text></Pressable> : null}
            {task.canRetry && index === 0 ? <Pressable disabled={disabled || active} onPress={() => void mutate("retry", task.id)} style={s.secondaryButton}><Text style={s.secondaryText}>重试失败步骤</Text></Pressable> : null}
            {task.canRegenerate && index === 0 ? <Pressable disabled={disabled || active} onPress={() => void mutate("regenerate", task.id)} style={s.secondaryButton}><Text style={s.secondaryText}>重新生成建议（可能计费）</Text></Pressable> : null}
          </View>)}
          {review.names?.suggestions.filter(row => row.status === "pending" && row.valid).map(row => <Text key={row.id} style={s.body}>AI 建议：{row.title}，请在下方审核后采用。</Text>)}
        </> : null}
        <Pressable disabled={busy} onPress={() => void load()} style={s.secondaryButton}><Text style={s.secondaryText}>刷新整理状态</Text></Pressable>
        <Pressable onPress={() => navigation.navigate("Settings")} style={s.secondaryButton}><Text style={s.secondaryText}>查看 AI 设置、检测与授权</Text></Pressable>
      </> : null}
    </View>
    {transcription ? <TranscriptEditor assetId={id} label={label ?? "录音或视频"} onSaved={onSaved} refreshVersion={refreshVersion} /> : <NameEditor kind={kind} id={id} onSaved={onSaved} refreshVersion={refreshVersion} defaultOpen={defaultOpen} />}
  </View>;
}
