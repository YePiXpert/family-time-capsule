import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { ScrollView, View } from "react-native";
import { Text } from "../components/typography";
import { JournalArtwork } from "../components/JournalArtwork";
import { JournalIcon } from "../components/JournalIcon";
import { Button, Chip } from "../components/ui";
import { ApiError, requestMobileJson } from "../api/client";
import { useAppData } from "../state/AppContext";
import type { AppNavigation } from "../navigation/types";
import { journalType } from "../design/tokens";
import { useColorTheme, useSharedStyles } from "../theme";
import { growthErrorMessage, type GrowthOverview } from "./types";
export function GrowthBookCard() {
  const { credentials, family, viewer } = useAppData();
  const navigation = useNavigation<AppNavigation>();
  const { colors } = useColorTheme();
  const s = useSharedStyles();
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
  if (!credentials) return <View style={[s.card, { alignItems: "center", paddingVertical: 24, gap: 12 }]}>
    <JournalArtwork kind="album" />
    <Text style={[s.cardTitle, { textAlign: "center" }]}>从第一条记录，写成一本成长册</Text>
    <Text style={[s.body, { textAlign: "center" }]}>连接家庭服务器后，可以按宝宝生日整理。已经下载的成长册仍可离线阅读。</Text>
  </View>;
  return <View style={[s.card, { padding: 20, gap: 14 }]}>
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 14 }}>
      <View style={{ flex: 1, gap: 6 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <JournalIcon name="book" color={colors.coral} size={14} />
          <Text style={{ color: colors.coral, fontSize: 13, fontWeight: "700", letterSpacing: 0.6 }}>全家可见 · 按月成长册</Text>
        </View>
        <Text style={{ color: colors.ink, fontSize: journalType.heading, fontWeight: "700" }}>{data?.title ?? "正在读取成长记录…"}</Text>
        {data ? <Text style={s.body}>{data.pendingBirthday ? "确认宝宝生日后，就能把这段日子整理成册。" : data.memoryCount ? `已有 ${data.memoryCount} 条记录。打开时收入新增内容，保留手改文字、封面和删去的页面。` : "从第一条记录开始，满月前也能预览。"}</Text> : null}
      </View>
      <JournalArtwork kind="album" compact />
    </View>
    {loaded?.stages.length ? <ScrollView horizontal contentContainerStyle={{ gap: 8, alignItems: "center" }} showsHorizontalScrollIndicator={false} pointerEvents={busy ? "none" : "auto"}>{loaded.stages.filter(stage => stage.key !== "birth").map(stage => <Chip key={stage.key} label={stage.label} selected={Number(stage.key) === month} onPress={() => setMonth(Number(stage.key))} />)}</ScrollView> : null}
    <Text style={{ color: colors.muted, fontSize: 13 }}>仅收入全家可读、日期明确的记录。</Text>
    {data?.pendingBirthday
      ? <Button variant="primary" icon="calendar" title="确认宝宝生日" onPress={() => navigation.navigate("People")} />
      : data?.canCreate && data.memoryCount > 0
        ? <Button variant="primary" icon="book" title={busy ? "正在准备…" : data.bookId ? "打开成长册" : "预览成长册"} disabled={busy} onPress={() => void open()} />
        : data?.bookId
          ? <Button variant="primary" icon="book" title="打开成长册" onPress={() => navigation.navigate("BookDetail", { id: data.bookId! })} />
          : null}
    {error ? <Text accessibilityRole="alert" style={s.error}>{error}</Text> : null}
  </View>;
}
