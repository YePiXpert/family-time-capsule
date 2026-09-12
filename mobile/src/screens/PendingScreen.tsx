import { useCallback, useState, useSyncExternalStore } from "react";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { Pressable, ScrollView, View } from "react-native";
import { Text } from "../components/typography";
import { useAppData } from "../state/AppContext";
import { listLocalImportSessions } from "../storage/database";
import type { AppNavigation } from "../navigation/types";
import { useSharedStyles } from "../theme";
import { listLocalDrafts, type LocalDraft } from "../drafts/store";
import { requestMobileJson } from "../api/client";
import type { Draft } from "../drafts/model";
import { listMemoryEdits, memoryEditsVersion, subscribeMemoryEdits } from "../memories/edit-store";
import { memoryEditScope, sameMemoryEdit, type LocalMemoryEdit } from "../memories/edit-model";
import { journalSpace } from "../design/tokens";
import { Disclosure } from "../components/Disclosure";
import { Button } from "../components/ui";
import { formatOccurredLabel } from "../utils/occurred-precision";

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
  const memoryScope = memoryEditScope(credentials, viewer?.id, family?.id);
  const memoryVersion = useSyncExternalStore(subscribeMemoryEdits, memoryEditsVersion, memoryEditsVersion);
  const [memoryState, setMemoryState] = useState<{ scope: string; rows: LocalMemoryEdit[]; error: string | null }>();
  useFocusEffect(useCallback(() => {
    if (!memoryScope) return;
    let active = true;
    void listMemoryEdits(memoryScope).then(rows => {
      if (!active) return;
      const pending = rows.filter(row => row.scope === memoryScope && (
        row.savedContent || row.submission || row.conflict || row.blocked || !sameMemoryEdit(row.content, row.base)
      )).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.memoryId.localeCompare(b.memoryId));
      setMemoryState({ scope: memoryScope, rows: pending, error: null });
    }).catch(() => {
      if (!active) return;
      setMemoryState(current => ({
        scope: memoryScope,
        rows: current?.scope === memoryScope ? current.rows : [],
        error: "暂时无法读取回忆修改，请重新打开此页。",
      }));
    });
    return () => { active = false; };
  }, [memoryScope, memoryVersion]));
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
  const memoryEdits = memoryScope && memoryState?.scope === memoryScope ? memoryState : null;
  const memoryEditsReady = !memoryScope || memoryEdits !== null;
  const imports = usePendingImports();
  const count = viewer?.canReviewInbox ? home?.inbox.count ?? 0 : 0;
  return <ScrollView style={s.screen} contentContainerStyle={s.content}>
    {draftError?.scope === scope ? <Text accessibilityRole="alert" style={s.body}>{draftError.message}</Text> : null}
    {count > 0 ? <Pressable accessibilityRole="button" onPress={() => navigation.navigate("Inbox")} style={s.secondaryButton}><Text style={s.secondaryText}>待确认内容 · {count} 条</Text></Pressable> : null}
    {imports.map(item => <Pressable key={item.id} accessibilityRole="button" onPress={() => item.local ? navigation.navigate("LocalIntake", { id: item.id }) : navigation.navigate("ImportSessionDetail", { id: item.id })} style={s.card}><Text style={s.cardTitle}>{item.title}</Text><Text style={s.body}>继续处理</Text></Pressable>)}
    {drafts?.local.map(d => <Pressable key={d.id} accessibilityRole="button" onPress={() => navigation.navigate("Capture", { localDraftId: d.id })} style={s.card}><Text style={s.cardTitle}>{d.content.title || d.content.text.slice(0, 40) || "照片与声音"}</Text><Text style={s.body}>{d.status === "queued" ? "待同步" : "继续记录"}</Text></Pressable>)}
    {drafts?.remote.map(d => <Pressable key={d.id} accessibilityRole="button" onPress={() => navigation.navigate("Capture", { draftId: d.id })} style={s.card}><Text style={s.cardTitle}>{d.title || d.text.slice(0, 40) || "照片与声音"}</Text><Text style={s.body}>继续记录</Text></Pressable>)}
    {memoryEdits && (memoryEdits.rows.length > 0 || memoryEdits.error) ? <View style={{ gap: journalSpace.medium }}>
      <Text accessibilityRole="header" style={s.cardTitle}>回忆修改{memoryEdits.rows.length ? ` · ${memoryEdits.rows.length}` : ""}</Text>
      {memoryEdits.error ? <Text accessibilityRole="alert" style={s.body}>{memoryEdits.error}</Text> : null}
      {memoryEdits.rows.map(edit => <View
        key={edit.memoryId}
        style={s.card}
      >
        <Text numberOfLines={2} style={s.cardTitle}>{edit.content.title || "一段回忆"}</Text>
        <Text style={s.body}>{memoryEditStatus(edit)}</Text>
        {edit.problem && (edit.conflict || edit.blocked) ? <Text style={s.body}>{edit.problem}</Text> : null}
        <Button title="打开回忆" accessibilityLabel={`打开回忆：${edit.content.title || "一段回忆"}`} onPress={() => navigation.navigate("Memory", { id: edit.memoryId })} />
        {edit.blocked ? <Disclosure title="查看本机输入"><LocalMemoryInput edit={edit} /></Disclosure> : null}
      </View>)}
    </View> : null}
    {!memoryEditsReady ? <Text style={s.body}>正在读取回忆修改…</Text> : null}
    {drafts && memoryEditsReady && !memoryEdits?.error && !memoryEdits?.rows.length && !count && !imports.length && !drafts.local.length && !drafts.remote.length ? <Text style={s.body}>都处理好了。</Text> : null}
  </ScrollView>;
}

function memoryEditStatus(edit: LocalMemoryEdit): string {
  if (edit.conflict) return "待核对 · 家人也修改了这段回忆";
  if (edit.blocked) return "待处理 · 打开回忆查看原因";
  const pending = edit.savedContent ?? edit.submission?.content;
  if (pending) return sameMemoryEdit(edit.content, pending)
    ? "待同步 · 修改已保存在本机"
    : "待同步 · 还有尚未提交的输入";
  return "继续编辑 · 输入已暂存，尚未提交";
}

function LocalMemoryInput({ edit }: { edit: LocalMemoryEdit }) {
  const s = useSharedStyles();
  const { content } = edit;
  let date = content.precision === "unknown" ? "时间不确定" : content.occurredAt || "时间不确定";
  try {
    date = formatOccurredLabel(content.precision, content.occurredAt ?? "", edit.timezone);
  } catch {
    // A damaged timezone must not prevent recovery of the rest of the input.
  }
  const fields = [
    ["标题", content.title],
    ["正文", content.bodyText],
    ["地点", content.location],
    ["日期", date],
  ] as const;
  return <View style={{ gap: journalSpace.medium }}>
    <Text style={s.body}>这里保留着你的本机输入，长按文字可复制。</Text>
    {fields.map(([label, value]) => <View key={label} style={{ gap: journalSpace.hair }}>
      <Text style={s.label}>{label}</Text>
      <Text selectable style={[s.body, { color: s.colors.ink }]}>{value || "（未填写）"}</Text>
    </View>)}
  </View>;
}
