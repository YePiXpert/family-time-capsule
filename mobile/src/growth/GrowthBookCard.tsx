import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { Pressable, ScrollView, View } from "react-native";
import { Text } from "../components/typography";
import { JournalArtwork } from "../components/JournalArtwork";
import { ApiError, requestMobileJson } from "../api/client";
import { useApp } from "../state/AppContext";
import type { AppNavigation } from "../navigation/types";
import { colors, sharedStyles as s } from "../theme";
import { growthErrorMessage, type GrowthOverview } from "./types";
export function GrowthBookCard() {
  const { credentials, family, viewer } = useApp();
  const navigation = useNavigation<AppNavigation>();
  const scope = JSON.stringify([credentials?.serverUrl, credentials?.instanceId, family?.id, viewer?.id]);
  const currentScope = useRef(scope);
  useLayoutEffect(() => { currentScope.current = scope; return () => { currentScope.current = ""; }; }, [scope]);
  const [month, setMonth] = useState(1), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [result, setResult] = useState<{ scope: string; data: GrowthOverview } | null>(null);
  const loaded = result?.scope === scope ? result.data : null;
  const data = loaded?.month === month ? loaded : null;
  useEffect(() => () => { currentScope.current = ""; }, []);
  useFocusEffect(useCallback(() => {
    if (!credentials) return;
    let active = true;
    void requestMobileJson(credentials, `/api/growth?month=${month}`).then(value => {
      if (active && currentScope.current === scope) { setResult({ scope, data: value as GrowthOverview }); setError(""); }
    }).catch(() => { if (active && currentScope.current === scope) setError("联网后可以准备成长册，本机记录仍保留。"); });
    return () => { active = false; };
  }, [credentials, month, scope]));
  async function open() {
    if (!credentials || !data || busy) return;
    setBusy(true); setError("");
    try {
      const value = await requestMobileJson(credentials, "/api/growth/book", { method: "POST", body: JSON.stringify({ month: data.month }) }) as { id?: string };
      if (currentScope.current !== scope) return;
      if (typeof value.id !== "string") throw new Error("invalid_response");
      navigation.navigate("BookDetail", { id: value.id });
    } catch (e) { if (currentScope.current === scope) setError(e instanceof ApiError && e.code ? growthErrorMessage(e.code) : "暂时无法准备成长册，请重试。"); }
    finally { if (currentScope.current === scope) setBusy(false); }
  }
  if (!credentials) return <View style={s.card}><JournalArtwork kind="album" /><Text style={s.cardTitle}>从第一条记录，写成一本成长册</Text><Text style={s.body}>连接家庭服务器后，可以按宝宝生日整理。已经下载的成长册仍可离线阅读。</Text></View>;
  return <View style={[s.card, { padding: 20, gap: 14 }]}>
    <JournalArtwork kind="album" />
    <Text style={{ color: colors.coral, fontSize: 14 }}>全家可见 · 按月成长册</Text>
    {loaded?.stages.length ? <ScrollView horizontal contentContainerStyle={{ gap: 8 }} showsHorizontalScrollIndicator={false}>{loaded.stages.filter(stage => stage.key !== "birth").map(stage => <Pressable key={stage.key} disabled={busy} accessibilityRole="tab" accessibilityState={{ selected: Number(stage.key) === month }} onPress={() => setMonth(Number(stage.key))} style={Number(stage.key) === month ? s.primaryButton : s.secondaryButton}><Text style={Number(stage.key) === month ? s.primaryText : s.secondaryText}>{stage.label}</Text></Pressable>)}</ScrollView> : null}
    <Text style={s.cardTitle}>{data?.title ?? "正在读取成长记录…"}</Text>
    {data ? <Text style={s.body}>{data.pendingBirthday ? "确认宝宝生日后，就能把这段日子整理成册。" : data.memoryCount ? `已有 ${data.memoryCount} 条记录。打开时收入新增内容，保留手改文字、封面和删去的页面。` : "从第一条记录开始，满月前也能预览。"}</Text> : null}
    <Text style={{ color: colors.muted, fontSize: 13 }}>仅收入全家可读、日期明确的记录。</Text>
    {data?.pendingBirthday ? <Pressable accessibilityRole="button" onPress={() => navigation.navigate("People")} style={s.primaryButton}><Text style={s.primaryText}>确认宝宝生日</Text></Pressable> : data?.canCreate && data.memoryCount > 0 ? <Pressable accessibilityRole="button" disabled={busy} onPress={() => void open()} style={s.primaryButton}><Text style={s.primaryText}>{busy ? "正在准备…" : data.bookId ? "打开成长册" : "预览成长册"}</Text></Pressable> : data?.bookId ? <Pressable accessibilityRole="button" onPress={() => navigation.navigate("BookDetail", { id: data.bookId! })} style={s.primaryButton}><Text style={s.primaryText}>打开成长册</Text></Pressable> : null}
    {error ? <Text accessibilityRole="alert" style={s.error}>{error}</Text> : null}
  </View>;
}
