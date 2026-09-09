import { useCallback, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { Alert, Pressable, Text, View } from "react-native";
import { ApiError, changeAiConsent, fetchAiSettings, parseAiSettings } from "../api/client";
import { memoryCacheScope } from "../memories/cache-scope";
import { useApp } from "../state/AppContext";
import { deleteMeta, getMeta, setMeta } from "../storage/database";
import { sharedStyles } from "../theme";
import type { AiSettings, OrganizerCapability } from "./types";

const labels = { text: "文字起名", vision: "图片与视频画面理解", transcription: "录音与视频音轨转写" };
const content = { text: "所选文字、分析或转录中最少必要的内容", vision: "去除 EXIF 的受限图片预览或少量视频画面", transcription: "所选录音或视频的音轨" };

export function AiSettingsSection() {
  const { credentials, viewer, family } = useApp();
  const scope = memoryCacheScope(credentials, viewer?.id, family?.id);
  if (!credentials || !scope || !["owner", "admin", "editor"].includes(viewer?.role ?? "")) return <View style={sharedStyles.notice}><Text style={sharedStyles.noticeText}>AI 默认关闭；服务器同步授权与 AI 外部处理授权分别管理。保存、查看与播放无需等待 AI。</Text></View>;
  return <SettingsContent key={scope} scope={scope} />;
}

function SettingsContent({ scope }: { scope: string }) {
  const { credentials, online } = useApp();
  const [status, setStatus] = useState<AiSettings | null>(null);
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const version = useRef(0);
  const cacheKey = `ai-settings:${scope}`;

  const load = useCallback(async () => {
    const request = ++version.current;
    setVerified(false);
    setBusy(true);
    setError(null);
    let cached: AiSettings | null = null;
    try {
      const raw = await getMeta(cacheKey);
      try { if (raw) cached = parseAiSettings(JSON.parse(raw)); } catch { /* Invalid/old cache is not authority. */ }
      if (request !== version.current) return;
      if (!credentials || online === false) {
        setStatus(cached);
        setError("当前离线，显示上次读取的状态；联网复核后才能修改授权。");
        return;
      }
      const next = await fetchAiSettings(credentials);
      if (request !== version.current) return;
      await setMeta(cacheKey, JSON.stringify(next));
      if (request !== version.current) return;
      setStatus(next);
      setVerified(true);
    } catch (reason) {
      if (request !== version.current) return;
      if (reason instanceof ApiError && [401, 403, 404].includes(reason.status)) {
        setStatus(null);
        await deleteMeta(cacheKey);
      } else setStatus(cached);
      if (request === version.current) setError(reason instanceof ApiError && reason.status === 404 ? "当前服务器尚未提供 AI 整理设置，请升级配套服务端。" : reason instanceof Error ? reason.message : "暂时无法读取 AI 状态。");
    } finally { if (request === version.current) setBusy(false); }
  }, [cacheKey, credentials, online]);

  useFocusEffect(useCallback(() => {
    void load();
    return () => { version.current++; };
  }, [load]));

  const confirm = (capability: OrganizerCapability, enabled: boolean) => {
    if (!status || !credentials || !verified || online === false || busy) return;
    const request = version.current;
    const apply = async () => {
      if (request !== version.current) return;
      const mutation = ++version.current;
      setBusy(true);
      try {
        const next = await changeAiConsent(credentials, capability, enabled ? "disable" : "enable", status.configurationId);
        if (mutation !== version.current) return;
        await setMeta(cacheKey, JSON.stringify(next));
        if (mutation === version.current) { setStatus(next); setError(null); }
      } catch (reason) {
        if (mutation !== version.current) return;
        setVerified(false);
        if (reason instanceof ApiError && [401, 403].includes(reason.status)) { setStatus(null); await deleteMeta(cacheKey); }
        if (mutation === version.current) setError(reason instanceof Error ? reason.message : "授权未保存，请刷新状态后重试。");
      } finally { if (mutation === version.current) setBusy(false); }
    };
    const capabilityRow = status.capabilities.find(row => row.capability === capability);
    const model = capabilityRow?.model;
    const receiver = capabilityRow?.receiver ?? status.provider;
    Alert.alert(enabled ? "关闭这项外部处理？" : `允许${labels[capability]}？`, enabled
      ? "等待中的相关 AI 任务会取消，已发出的远端请求不能保证撤回。记录、同步与其他后台任务仍可使用。"
      : `接收服务：${receiver}\n模型：${model}\n会发送：${content[capability]}。\n仅适用于有权家人手动选中的内容，从确认后起效，不补处理历史资料，不自动确认人物、时间或合并。服务可能收费，可随时在此关闭。`,
    [{ text: "取消", style: "cancel" }, { text: enabled ? "确认关闭" : "同意手动处理", onPress: () => void apply() }]);
  };

  return <View style={sharedStyles.card}>
    <Text style={sharedStyles.cardTitle}>AI 整理与隐私</Text>
    <Text style={sharedStyles.body}>{!status ? "读取服务器状态" : !status.valid ? "配置无效，请联系部署管理员" : !status.configured ? "AI 未配置或已关闭" : `接收服务：${status.provider}`}</Text>
    {status?.configured ? <Text style={sharedStyles.body}>{status.workerAvailable ? "后台处理服务可用" : "后台处理服务不可用；原件仍可打开和播放"}</Text> : null}
    {status?.quota ? <View>
      {Object.values(status.quota.limits).every(limit => limit === 0) ? <>
        <Text style={sharedStyles.body}>自用模式 · 不设每日限额</Text>
        <Text style={sharedStyles.body}>今日已用（UTC {status.quota.day}）：请求 {status.quota.used.requests} 次 · 图片 {status.quota.used.images} 张 · 音频 {status.quota.used.audioSeconds} 秒。仅统计用量，不按每日额度拦截。</Text>
      </> : <Text style={sharedStyles.body}>今日用量（UTC {status.quota.day}）：请求 {status.quota.used.requests}/{status.quota.limits.maxRequests || "不限"} · 图片 {status.quota.used.images}/{status.quota.limits.maxImages || "不限"} · 音频 {status.quota.used.audioSeconds} 秒/{status.quota.limits.maxAudioSeconds || "不限"}。</Text>}
    </View> : null}
    {error ? <Text accessibilityRole="alert" style={sharedStyles.warningText}>{error}</Text> : null}
    {status?.capabilities.map(row => <View key={row.capability}>
      <Text style={sharedStyles.body}>{labels[row.capability]} · {!row.available ? "未配置" : row.consented ? "已同意" : "等待同意"}</Text>
      {row.available ? <Text style={sharedStyles.body}>{row.receiver ? `接收服务：${row.receiver} · ` : ""}模型：{row.model} · {row.check.state === "passed" ? "测试通过" : row.check.state === "failed" ? "测试失败" : "尚未测试"}</Text> : null}
      {row.available && status.canConfigure && status.external ? <Pressable disabled={!verified || busy || online === false} onPress={() => confirm(row.capability, row.consented)} style={[sharedStyles.secondaryButton, (!verified || busy || online === false) && sharedStyles.disabled]}><Text style={sharedStyles.secondaryText}>{row.consented ? "关闭这项外部处理" : "查看并同意手动处理"}</Text></Pressable> : null}
    </View>)}
    <Text style={sharedStyles.body}>配置与能力检测由部署管理员在 VPS 使用 ftc ai 完成。App 不保存模型 Key，也不继承开发工具的模型账号。</Text>
    <Pressable disabled={busy} onPress={() => void load()} style={sharedStyles.secondaryButton}><Text style={sharedStyles.secondaryText}>{busy ? "读取中…" : "刷新 AI 状态"}</Text></Pressable>
  </View>;
}
