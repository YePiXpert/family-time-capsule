import { useState } from "react";
import { ActivityIndicator, FlatList, Linking, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { searchMobile } from "../api/client";
import { useApp } from "../state/AppContext";
import type { RootStackParamList } from "../navigation/types";
import { colors, sharedStyles } from "../theme";
import type { MobileSearchPage } from "../types";
import { resolveSearchTarget } from "../navigation/intents";

type Props = NativeStackScreenProps<RootStackParamList, "Search">;

export function SearchScreen({ navigation }: Props) {
  const { credentials } = useApp();
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<MobileSearchPage["items"]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const search = async (nextCursor: string | null = null) => {
    if (!credentials || !query.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const page = await searchMobile(credentials, query.trim(), nextCursor);
      setItems((current) => nextCursor ? [...current, ...page.items] : page.items);
      setCursor(page.nextCursor);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "搜索失败。");
    } finally {
      setLoading(false);
    }
  };
  const openItem = async (item: MobileSearchPage["items"][number]) => {
    const target = resolveSearchTarget(item);
    if (!target) return;
    if (target.kind === "memory") {
      navigation.navigate("Memory", { id: target.id });
      return;
    }
    if (!credentials) return;
    try {
      await Linking.openURL(`${credentials.serverUrl}${target.path}`);
    } catch {
      setError("无法打开 Web 故事，请检查系统浏览器设置。");
    }
  };
  if (!credentials) return <View style={sharedStyles.empty}><Text style={sharedStyles.emptyTitle}>搜索需要连接家庭服务器</Text><Text style={sharedStyles.emptyText}>本机记录仍会完整保留。</Text></View>;
  return <View style={sharedStyles.screen}>
    <View style={styles.searchBar}><TextInput autoFocus onChangeText={setQuery} onSubmitEditing={() => void search()} placeholder="搜索记忆、讲述或故事" returnKeyType="search" style={[sharedStyles.input, styles.input]} value={query} /><Pressable onPress={() => void search()} style={sharedStyles.primaryButton}><Text style={sharedStyles.primaryText}>搜索</Text></Pressable></View>
    {error ? <Text style={[sharedStyles.error, styles.error]}>{error}</Text> : null}
    <FlatList contentContainerStyle={items.length === 0 ? { flexGrow: 1 } : styles.list} data={items} keyExtractor={(item) => `${item.type}:${item.id}`} ListEmptyComponent={!loading ? <View style={sharedStyles.empty}><Text style={sharedStyles.emptyTitle}>{query ? "没有找到相关内容" : "找回一段家庭记忆"}</Text><Text style={sharedStyles.emptyText}>输入人物、地点、标题或讲述中的字词。</Text></View> : null} ListFooterComponent={loading ? <ActivityIndicator color={colors.coral} /> : cursor ? <Pressable onPress={() => void search(cursor)} style={sharedStyles.secondaryButton}><Text style={sharedStyles.secondaryText}>加载更多</Text></Pressable> : null} renderItem={({ item }) => {
      const target = resolveSearchTarget(item);
      return <Pressable disabled={!target} onPress={() => void openItem(item)} style={({ pressed }) => [sharedStyles.card, pressed && sharedStyles.pressed]}><Text style={styles.kind}>{item.type === "memory" ? "记忆" : item.type === "contribution" ? "家人讲述" : item.type === "story" ? "故事" : "档案内容"}</Text><Text style={sharedStyles.cardTitle}>{item.title}</Text><Text numberOfLines={3} style={sharedStyles.body}>{item.snippet}</Text>{target?.kind === "web" ? <Text style={styles.webLink}>在 Web 打开 →</Text> : null}</Pressable>;
    }} />
  </View>;
}

const styles = StyleSheet.create({
  searchBar: { flexDirection: "row", gap: 8, padding: 14, borderBottomColor: colors.line, borderBottomWidth: 1 },
  input: { flex: 1 },
  list: { padding: 14, paddingBottom: 36, gap: 10 },
  error: { padding: 14 },
  kind: { color: colors.coral, fontSize: 11, fontWeight: "800" },
  webLink: { color: colors.coralDark, fontSize: 12, fontWeight: "800" },
});
