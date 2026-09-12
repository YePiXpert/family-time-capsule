import { useCallback, useState } from "react";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { Pressable, ScrollView } from "react-native";
import { Text } from "../components/typography";
import { useAppData } from "../state/AppContext";
import { listLocalImportSessions } from "../storage/database";
import type { AppNavigation } from "../navigation/types";
import { useSharedStyles } from "../theme";
import { listLocalDrafts, type LocalDraft } from "../drafts/store";
import { requestMobileJson } from "../api/client";
import type { Draft } from "../drafts/model";

export function usePendingImports() {
  const { credentials, userId, family, home } = useAppData();
  const scope = credentials?.instanceId && userId && family ? JSON.stringify([credentials.serverUrl, credentials.instanceId, userId, family.id]) : "local";
  const [state, setState] = useState<{ scope: string; ids: string[] }>({ scope: "", ids: [] });
  useFocusEffect(useCallback(() => {
    let active = true;
    void listLocalImportSessions(scope).then(rows => { if (active) setState({ scope, ids: rows.filter(row => row.needsAction).map(row => row.id) }); }).catch(() => {});
    return () => { active = false; };
  }, [scope]));
  const local = state.scope === scope ? state.ids : [];
  return [
    ...local.map(id => ({ id, title: "本机收到的内容", local: true })),
    ...(home?.pendingImports ?? []).filter(item => !local.includes(item.id)).map(item => ({ ...item, local: false })),
  ];
}

export function PendingScreen() {
  const s = useSharedStyles();
  const navigation = useNavigation<AppNavigation>();
  const { home, viewer, credentials, userId, family } = useAppData();
  const scope = credentials?.instanceId && userId && family ? JSON.stringify([credentials.serverUrl, credentials.instanceId, userId, family.id]) : "local";
  const [draftState, setDraftState] = useState<{ scope: string; local: LocalDraft[]; remote: Draft[] }>();
  const [draftError, setDraftError] = useState<{ scope: string; message: string }>();
  useFocusEffect(useCallback(() => {
    let active = true;
    void listLocalDrafts(scope).then(async local => {
      if (!active) return;
      const visible = local.filter(d => ["editing", "queued"].includes(d.status) && (d.content.text || d.content.title || d.content.items.length));
      setDraftState({ scope, local: visible, remote: [] });
      setDraftError(undefined);
      const result = credentials ? await requestMobileJson(credentials, "/api/mobile/v1/drafts").catch(() => null) as { drafts?: Draft[] } | null : null;
      if (active) setDraftState({ scope, local: visible, remote: (result?.drafts ?? []).filter(d => d.status === "editing" && !local.some(row => row.id === d.id)) });
    }).catch(() => { if (active) setDraftError({ scope, message: "暂时无法读取本机记录，请重新打开此页。" }); });
    return () => { active = false; };
  }, [scope, credentials]));
  const drafts = draftState?.scope === scope ? draftState : null;
  const imports = usePendingImports();
  const count = viewer?.canReviewInbox ? home?.inbox.count ?? 0 : 0;
  return <ScrollView style={s.screen} contentContainerStyle={s.content}>
    {draftError?.scope === scope ? <Text accessibilityRole="alert" style={s.body}>{draftError.message}</Text> : null}
    {count > 0 ? <Pressable accessibilityRole="button" onPress={() => navigation.navigate("Inbox")} style={s.secondaryButton}><Text style={s.secondaryText}>待确认内容 · {count} 条</Text></Pressable> : null}
    {imports.map(item => <Pressable key={item.id} accessibilityRole="button" onPress={() => item.local ? navigation.navigate("LocalIntake", { id: item.id }) : navigation.navigate("ImportSessionDetail", { id: item.id })} style={s.card}><Text style={s.cardTitle}>{item.title}</Text><Text style={s.body}>继续处理</Text></Pressable>)}
    {drafts?.local.map(d => <Pressable key={d.id} accessibilityRole="button" onPress={() => navigation.navigate("Capture", { localDraftId: d.id })} style={s.card}><Text style={s.cardTitle}>{d.content.title || d.content.text.slice(0, 40) || "照片与声音"}</Text><Text style={s.body}>{d.status === "queued" ? "待同步" : "继续记录"}</Text></Pressable>)}
    {drafts?.remote.map(d => <Pressable key={d.id} accessibilityRole="button" onPress={() => navigation.navigate("Capture", { draftId: d.id })} style={s.card}><Text style={s.cardTitle}>{d.title || d.text.slice(0, 40) || "照片与声音"}</Text><Text style={s.body}>继续记录</Text></Pressable>)}
    {drafts && !count && !imports.length && !drafts.local.length && !drafts.remote.length ? <Text style={s.body}>都处理好了。</Text> : null}
  </ScrollView>;
}
