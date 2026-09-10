import { useCallback, useState } from "react";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { Pressable, ScrollView } from "react-native";
import { Text } from "../components/typography";
import { useApp } from "../state/AppContext";
import { listLocalImportSessions } from "../storage/database";
import type { AppNavigation } from "../navigation/types";
import { useSharedStyles } from "../theme";

export function usePendingImports() {
  const { credentials, userId, family, home } = useApp();
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
  const { home, viewer } = useApp();
  const imports = usePendingImports();
  const count = viewer?.canReviewInbox ? home?.inbox.count ?? 0 : 0;
  return <ScrollView style={s.screen} contentContainerStyle={s.content}>
    {count > 0 ? <Pressable accessibilityRole="button" onPress={() => navigation.navigate("Inbox")} style={s.secondaryButton}><Text style={s.secondaryText}>待确认内容 · {count} 条</Text></Pressable> : null}
    {imports.map(item => <Pressable key={item.id} accessibilityRole="button" onPress={() => item.local ? navigation.navigate("LocalIntake", { id: item.id }) : navigation.navigate("ImportSessionDetail", { id: item.id })} style={s.card}><Text style={s.cardTitle}>{item.title}</Text><Text style={s.body}>继续处理</Text></Pressable>)}
    {!count && !imports.length ? <Text style={s.body}>都处理好了。</Text> : null}
  </ScrollView>;
}
