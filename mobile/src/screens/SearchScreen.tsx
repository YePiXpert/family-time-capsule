import { useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { searchMobile } from "../api/client";
import { useApp } from "../state/AppContext";
import type { RootStackParamList } from "../navigation/types";
import { colors, sharedStyles } from "../theme";
import type { MobileSearchPage } from "../types";
import { resolveSearchTarget } from "../navigation/intents";
import { offlineSearch, type OfflineSearchResult } from "../search/offline-search";

type Props = NativeStackScreenProps<RootStackParamList, "Search">;

type DisplayItem = {
  key: string;
  kindLabel: string;
  title: string;
  snippet: string;
  open: (() => void) | null;
};

/**
 * 搜索（FIND-2）：联网时优先完整服务器搜索；离线或服务器不可达时自动
 * 改为「仅搜索这台设备已保存的内容」，并明确告知范围——没搜到不代表
 * 家庭档案里没有。点击结果只打开这台设备真正能打开的内容；缓存原件
 * 已被清理时如实说明需要联网重新获取。
 */
export function SearchScreen({ navigation }: Props) {
  const { credentials, online, viewer, family } = useApp();
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<DisplayItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeText, setNoticeText] = useState<string | null>(null);

  const serverItem = (item: MobileSearchPage["items"][number]): DisplayItem => {
    const target = resolveSearchTarget(item);
    return {
      key: `${item.type}:${item.id}`,
      kindLabel:
        item.type === "memory" ? "记忆"
          : item.type === "contribution" ? "家人讲述"
            : item.type === "story" ? "故事"
              : "档案内容",
      title: item.title,
      snippet: item.snippet,
      open: target
        ? () => navigation.navigate(target.kind === "memory" ? "Memory" : "StoryDetail", target.kind === "memory" ? { id: target.id } : { id: target.id })
        : null,
    };
  };

  const localItem = (item: OfflineSearchResult): DisplayItem => {
    if (item.kind === "memory") {
      const canOpen = online !== false || item.hasDetail === true;
      return {
        key: `memory:${item.id}`,
        kindLabel: "记忆",
        title: item.title,
        snippet: item.snippet,
        open: canOpen
          ? () => navigation.navigate("Memory", { id: item.id })
          : () => setNoticeText("这份内容目前只保留了索引，需要联网重新获取。"),
      };
    }
    if (item.kind === "local") {
      return {
        key: `local:${item.id}`,
        kindLabel: "本机记录",
        title: item.title,
        snippet: item.snippet,
        open: () => navigation.navigate("LocalCapture", { captureId: item.id }),
      };
    }
    return {
      key: `reading:${item.id}`,
      kindLabel: item.readingKind === "book" ? "作品" : "相册",
      title: item.title,
      snippet: item.snippet,
      open: () => navigation.navigate("OfflineReading", { key: item.id }),
    };
  };

  const searchLocal = async (q: string, reason: "offline" | "no-credentials" | "server-unreachable") => {
    const local = await offlineSearch({ credentials, userId: viewer?.id, familyId: family?.id, query: q });
    setItems(local.map(localItem));
    setCursor(null);
    setNotice(
      reason === "offline" ? "当前离线，仅搜索这台设备已保存的内容。"
        : reason === "no-credentials" ? "尚未连接家庭服务器，仅搜索这台设备已保存的内容。"
          : "无法连接服务器，已改为仅搜索这台设备已保存的内容。",
    );
  };

  const search = async (nextCursor: string | null = null) => {
    const q = query.trim();
    if (!q) return;
    if (nextCursor === null) {
      setNotice(null);
      setNoticeText(null);
    }
    setLoading(true);
    setError(null);
    try {
      if (!credentials) {
        await searchLocal(q, "no-credentials");
        return;
      }
      if (online === false) {
        if (nextCursor === null) await searchLocal(q, "offline");
        return;
      }
      const page = await searchMobile(credentials, q, nextCursor);
      if (nextCursor === null) setNotice(null);
      setItems((current) => nextCursor ? [...current, ...page.items.map(serverItem)] : page.items.map(serverItem));
      setCursor(page.nextCursor);
    } catch (reason) {
      if (nextCursor === null) {
        const message = reason instanceof Error ? reason.message : "搜索失败。";
        if (online !== true) {
          // 服务器不可达：自动退回本机内容，不让用户误以为档案不存在。
          await searchLocal(q, "server-unreachable");
          setError(null);
          return;
        }
        setError(message);
      } else {
        setError(reason instanceof Error ? reason.message : "加载失败。");
      }
    } finally {
      setLoading(false);
    }
  };

  return <View style={sharedStyles.screen}>
    <View style={styles.searchBar}>
      <TextInput
        accessibilityLabel="搜索家庭记忆"
        onChangeText={setQuery}
        onSubmitEditing={() => void search()}
        placeholder="搜索记忆、讲述或故事"
        returnKeyType="search"
        style={[sharedStyles.input, styles.input]}
        value={query}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="开始搜索"
        onPress={() => void search()}
        style={sharedStyles.primaryButton}
      >
        <Text style={sharedStyles.primaryText}>搜索</Text>
      </Pressable>
    </View>
    {notice ? <Text style={styles.notice}>{notice}</Text> : null}
    {noticeText ? <Text style={styles.noticeText}>{noticeText}</Text> : null}
    {error ? <Text style={[sharedStyles.error, styles.error]}>{error}</Text> : null}
    <FlatList
      contentContainerStyle={items.length === 0 ? { flexGrow: 1 } : styles.list}
      data={items}
      keyExtractor={(item) => item.key}
      ListEmptyComponent={!loading ? (
        <View style={sharedStyles.empty}>
          <Text style={sharedStyles.emptyTitle}>{query ? "没有找到相关内容" : "找回一段家庭记忆"}</Text>
          <Text style={sharedStyles.emptyText}>
            {notice ? "这台设备上没有已保存的相关内容；联网后可以搜索完整家庭档案。" : "输入人物、地点、标题或讲述中的字词。"}
          </Text>
        </View>
      ) : null}
      ListFooterComponent={loading ? <ActivityIndicator color={colors.coral} /> : cursor ? (
        <Pressable accessibilityRole="button" onPress={() => void search(cursor)} style={sharedStyles.secondaryButton}>
          <Text style={sharedStyles.secondaryText}>加载更多</Text>
        </Pressable>
      ) : null}
      renderItem={({ item }) => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`打开${item.kindLabel}：${item.title}`}
          disabled={!item.open}
          onPress={() => item.open?.()}
          style={({ pressed }) => [sharedStyles.card, pressed && sharedStyles.pressed, !item.open && sharedStyles.disabled]}
        >
          <Text style={styles.kind}>{item.kindLabel}</Text>
          <Text style={sharedStyles.cardTitle}>{item.title}</Text>
          <Text numberOfLines={3} style={sharedStyles.body}>{item.snippet}</Text>
        </Pressable>
      )}
    />
  </View>;
}

const styles = StyleSheet.create({
  searchBar: { flexDirection: "row", gap: 8, padding: 14, borderBottomColor: colors.line, borderBottomWidth: 1 },
  input: { flex: 1 },
  list: { padding: 14, paddingBottom: 36, gap: 10 },
  error: { padding: 14 },
  notice: { backgroundColor: colors.softSage, color: colors.sage, fontSize: 13, lineHeight: 19, fontWeight: "700", paddingHorizontal: 14, paddingVertical: 8 },
  noticeText: { color: colors.warning, fontSize: 13, lineHeight: 19, fontWeight: "700", paddingHorizontal: 14, paddingVertical: 8 },
  kind: { color: colors.coral, fontSize: 11, fontWeight: "800" },
});
