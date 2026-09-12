import { Text } from "../components/typography";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Pressable, ScrollView, View } from "react-native";
import * as Crypto from "expo-crypto";
import { chooseLocalIntake, getLocalIntake, type IntakeDetail } from "../native/intake-store";
import { listLocalDrafts, type LocalDraft } from "../drafts/store";
import { NativeMediaReader } from "../media/NativeMediaReader";
import { resolveNativeCaptureAccess } from "../authz/product-access";
import { useAppData, useAppActions } from "../state/AppContext";
import type { RootStackParamList } from "../navigation/types";
import { useSharedStyles } from "../theme";

export function LocalIntakeScreen({ route, navigation }: NativeStackScreenProps<RootStackParamList, "LocalIntake">) {
  const s = useSharedStyles();
  const { credentials, userId, family, viewer, syncConsent } = useAppData();
  const { queued, grantSyncConsent } = useAppActions();
  const scope = credentials?.instanceId && userId && family ? JSON.stringify([credentials.serverUrl, credentials.instanceId, userId, family.id]) : "local";
  const scopeRef = useRef(scope);
  useLayoutEffect(() => { scopeRef.current = scope; return () => { scopeRef.current = ""; }; }, [scope]);
  const [state, setState] = useState<{ scope: string; detail: IntakeDetail | null; drafts: LocalDraft[] } | null>(null);
  const [error, setError] = useState<string | null>(null), [message, setMessage] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const detail = state?.scope === scope ? state.detail : null;
  const editable = resolveNativeCaptureAccess(Boolean(credentials), viewer) !== "readonly";
  const reload = useCallback(async (isCurrent: () => boolean = () => scopeRef.current === scope) => {
    const [detail, drafts] = await Promise.all([getLocalIntake(route.params.id, scope), listLocalDrafts(scope)]);
    if (isCurrent()) setState({ scope, detail, drafts: drafts.filter(draft => draft.status === "editing") });
  }, [scope, route.params.id]);
  useFocusEffect(useCallback(() => {
    let active = true;
    void reload(() => active).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [reload]));
  const choose = async (destination: "draft" | "library", draft?: LocalDraft) => {
    if (!detail || busy) return;
    setBusy(true); setError(null);
    try {
      const result = await chooseLocalIntake({ id: detail.id, scope, expectedRevision: detail.choice.revision, destination,
        ...(destination === "draft" ? { draftId: draft?.id ?? Crypto.randomUUID(), draftRevision: draft?.revision ?? 0 } : {}), mutationId: Crypto.randomUUID() });
      if (scopeRef.current !== scope) return;
      await reload();
      if (scopeRef.current !== scope) return;
      if (result.draftId) navigation.navigate("MainTabs", { screen: "Capture", params: { localDraftId: result.draftId, requestKey: Date.now() } });
      else {
        setMessage(scope === "local" ? "原件已保存在本机。连接家庭后，可以在这里确认上传去向。文字仍保留在本页。" : "去向已保存，原件将在后台送达资料库。文字仍保留在本页。尚未创建记忆。");
        // Local commit precedes network consent and progress refresh.
        if (result.uploadIds.length && credentials && family) void grantSyncConsent(syncConsent?.scope === "all" ? "all" : "selected", [...new Set([...(syncConsent?.ids ?? []), ...result.uploadIds])]).catch(e => setError(e.message));
        else void queued();
      }
    } catch (e) { if (scopeRef.current === scope) setError(e instanceof Error ? e.message : "本机保存失败，请重试。"); }
    finally { setBusy(false); }
  };
  return <ScrollView style={s.screen} contentContainerStyle={s.content}>
    <Text style={s.body}>先看一看，明天再整理也可以。加入草稿只保存引用，原件仍保留。</Text>
    {error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
    {message && <Text accessibilityLiveRegion="polite" style={s.body}>{message}</Text>}
    {!detail ? <Text style={s.body}>正在读取本机收件，或它属于其他账号。</Text> : <>
      <Text style={s.body}>{detail.items.length} 项 · {detail.choice.destination === "pending" ? "尚未选择去向" : detail.choice.destination === "draft" ? "已加入草稿" : "仅存资料库"}</Text>
      {detail.items.map(item => <View key={item.captureId} style={s.card}>
        <Text style={s.cardTitle}>{item.original?.title || "未能复制的内容"}</Text>
        {item.error || !item.original ? <Text accessibilityRole="alert" style={s.error}>这一项没有完整保全，请从原应用重新分享。其他项仍然可用。</Text> : <>
          {item.original.text && <Text style={s.body}>{item.original.text}</Text>}
          {item.original.localUri && item.original.mediaType && <NativeMediaReader credentials={null} assets={[{ id: item.captureId, type: item.original.mediaType, filename: item.original.title, mimeType: item.original.mimeType ?? "", localUri: item.original.localUri }]} />}
          <Text style={s.body}>本机已保存 · {item.original.syncState === "pending" ? "服务器尚未收到" : "服务器已收到"}</Text>
        </>}
      </View>)}
      {editable && detail.choice.destination === "pending" && <>
        <IntakeButton busy={busy} label="加入新草稿" onPress={() => void choose("draft")} />
        {(state?.drafts ?? []).map(draft => <View key={draft.id}><IntakeButton busy={busy} label={`加入草稿：${draft.content.title || draft.content.text.slice(0, 30) || "未命名的一件事"}`} onPress={() => void choose("draft", draft)} /></View>)}
        <IntakeButton busy={busy} label={scope === "local" ? "仅存本机资料库" : `仅存资料库 · ${family?.name}`} onPress={() => void choose("library")} />
        <Text style={s.body}>暂不选择也已保存在本机。部分复制失败的项会留下错误凭据。</Text>
      </>}
      {editable && detail.choice.destination === "library" && <IntakeButton busy={busy} label={scope === "local" ? "原件留在本机" : `确认送到资料库 · ${family?.name}`} onPress={() => void choose("library")} />}
      {editable && detail.choice.draft_id && <IntakeButton busy={busy} label="继续这件事" onPress={() => navigation.navigate("MainTabs", { screen: "Capture", params: { localDraftId: detail.choice.draft_id!, requestKey: Date.now() } })} />}
      {!editable && <Text style={s.body}>当前家庭账号只能阅读；分享副本已留在本机，尚未授权上传。</Text>}
    </>}
  </ScrollView>;
}

function IntakeButton({ label, onPress, busy }: { label: string; onPress: () => void; busy: boolean }) {
  const s = useSharedStyles();
  return <Pressable accessibilityRole="button" disabled={busy} style={s.secondaryButton} onPress={onPress}><Text style={s.secondaryText}>{label}</Text></Pressable>;
}
