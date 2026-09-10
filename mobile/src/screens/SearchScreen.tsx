import { Text, TextInput } from "../components/typography";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { ApiError, searchMobile, type MobileSearchFilterInput } from "../api/client";
import { useApp } from "../state/AppContext";
import type { RootStackParamList } from "../navigation/types";
import { useSharedStyles } from "../theme";
import type { JournalPalette } from "../design/tokens";
import type { MobileSearchPage } from "../types";
import { resolveSearchTarget } from "../navigation/intents";
import { memoryCacheScope } from "../memories/cache-scope";
import { offlineSearch, type OfflineSearchFilters, type OfflineSearchResult } from "../search/offline-search";

type Props = NativeStackScreenProps<RootStackParamList, "Search">;

type DisplayItem = {
  key: string;
  kindLabel: string;
  title: string;
  snippet: string;
  open: (() => void) | null;
};

type MediaFilter = "all" | "image" | "video" | "audio" | "document";

const MEDIA_OPTIONS: { value: MediaFilter; label: string }[] = [
  { value: "all", label: "全部类型" },
  { value: "image", label: "照片" },
  { value: "video", label: "视频" },
  { value: "audio", label: "音频" },
  { value: "document", label: "文档" },
];

const DATE = /^\d{4}-\d{2}-\d{2}$/u;
const QUERY_MAX = 100;

/**
 * 搜索（FIND-2，正式 1.0 正确性重写）：
 * - 请求代际：每次新查询/筛选递增代数，旧请求（含分页）结果一律丢弃；
 *   卸载后不写状态；写回前重新核对连接与授权范围仍与发起时一致。
 * - 错误分类：只有真实网络不可达才自动降级本机内容；401/403/400/429/5xx
 *   按各自语义提示，并提供明确的「只搜本机」入口，绝不把权限失败伪装成断网。
 * - 离线筛选：人物/日期范围/媒体类型与在线语义一致。
 */
export function SearchScreen({ navigation }: Props) {
  const s = useSharedStyles();
  const styles = useMemo(() => createStyles(s.colors), [s.colors]);
  const { credentials, online, viewer, family, people } = useApp();
  const [query, setQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [activeFiltersKey, setActiveFiltersKey] = useState("");
  const [personId, setPersonId] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>("all");
  const [items, setItems] = useState<DisplayItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeText, setNoticeText] = useState<string | null>(null);

  // 请求代际与连接快照：所有异步写回前都要复核。
  const generationRef = useRef(0);
  const mountedRef = useRef(true);
  const credentialsRef = useRef(credentials);
  const viewerIdRef = useRef(viewer?.id);
  const familyIdRef = useRef(family?.id);
  const onlineRef = useRef<boolean | null>(online);
  useEffect(() => {
    credentialsRef.current = credentials;
    viewerIdRef.current = viewer?.id;
    familyIdRef.current = family?.id;
    onlineRef.current = online;
  });
  useEffect(() => () => { mountedRef.current = false; }, []);

  const currentScopeKey = () =>
    memoryCacheScope(credentialsRef.current, viewerIdRef.current ?? undefined, familyIdRef.current ?? undefined) ?? "local";

  /** 分页只追加到同一查询、同一筛选：筛选变化后必须重新搜索。 */
  const filtersKey = () => JSON.stringify([personId, dateFrom, dateTo, mediaFilter]);

  const serverItem = (item: MobileSearchPage["items"][number]): DisplayItem => {
    const target = resolveSearchTarget(item);
    return {
      key: `${item.type}:${item.id}`,
      kindLabel:
        item.type === "memory" ? "记忆"
          : item.type === "contribution" ? "家人讲述"
            : "档案内容",
      title: item.title,
      snippet: item.snippet,
      open: target
        ? () => navigation.navigate("Memory", { id: target.id })
        : null,
    };
  };

  const localItem = (item: OfflineSearchResult): DisplayItem => {
    if (item.kind === "memory") {
      const canOpen = onlineRef.current !== false || item.hasDetail === true;
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
      // 本机记录属于这台设备的主人，与家庭档案分开标注，不静默并入。
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

  const offlineFilters = (): OfflineSearchFilters => {
    const selected = people.find((person) => person.id === personId);
    return {
      person: selected?.displayName,
      dateFrom: DATE.test(dateFrom) ? dateFrom : undefined,
      dateTo: DATE.test(dateTo) ? dateTo : undefined,
      mediaType: mediaFilter === "all" ? undefined : mediaFilter,
    };
  };

  const apiFilters = (): MobileSearchFilterInput => {
    const selected = people.find((person) => person.id === personId);
    return {
      personId: selected?.id,
      dateFrom: DATE.test(dateFrom) ? dateFrom : undefined,
      dateTo: DATE.test(dateTo) ? dateTo : undefined,
      mediaType: mediaFilter === "all" ? undefined : mediaFilter,
    };
  };

  const searchLocal = async (
    generation: number,
    scopeKey: string,
    q: string,
    reason: "offline" | "no-credentials" | "server-unreachable" | "manual",
  ) => {
    const local = await offlineSearch({
      credentials: credentialsRef.current,
      userId: viewerIdRef.current,
      familyId: familyIdRef.current,
      query: q,
      filters: offlineFilters(),
    });
    if (!mountedRef.current || generation !== generationRef.current || scopeKey !== currentScopeKey()) return;
    setItems(local.map(localItem));
    setCursor(null);
    setNotice(
      reason === "offline" ? "当前离线，仅搜索这台设备已保存的内容。"
        : reason === "no-credentials" ? "尚未连接家庭服务器，仅搜索这台设备已保存的内容。"
          : reason === "manual" ? "以下结果只来自这台设备已保存的内容。"
            : "无法连接服务器，已改为仅搜索这台设备已保存的内容。",
    );
  };

  const runSearch = async (generation: number, q: string, mode: "new" | "more", moreCursor: string | null) => {
    const scopeKey = currentScopeKey();
    setLoading(true);
    setError(null);
    try {
      if (!credentialsRef.current) {
        await searchLocal(generation, scopeKey, q, "no-credentials");
        return;
      }
      if (onlineRef.current === false) {
        if (mode === "new") await searchLocal(generation, scopeKey, q, "offline");
        return;
      }
      const page = await searchMobile(credentialsRef.current, q, moreCursor, apiFilters());
      if (!mountedRef.current || generation !== generationRef.current || scopeKey !== currentScopeKey()) return;
      if (mode === "new") {
        setNotice(null);
        setItems(page.items.map(serverItem));
      } else {
        setItems((current) => [...current, ...page.items.map(serverItem)]);
      }
      setCursor(page.nextCursor);
    } catch (reason) {
      if (!mountedRef.current || generation !== generationRef.current || scopeKey !== currentScopeKey()) return;
      if (mode === "new" && reason instanceof ApiError && reason.status === 0) {
        // 真实网络不可达（DNS/超时/连接失败）：自动降级为合法本机内容。
        await searchLocal(generation, scopeKey, q, "server-unreachable");
        setError(null);
        return;
      }
      const message = reason instanceof ApiError ? classifyError(reason) : (reason instanceof Error ? reason.message : "搜索失败。");
      setError(message);
    } finally {
      if (mountedRef.current && generation === generationRef.current) setLoading(false);
    }
  };

  const startSearch = () => {
    const q = query.trim().slice(0, QUERY_MAX);
    if (!q) return;
    const generation = ++generationRef.current;
    setActiveQuery(q);
    setActiveFiltersKey(filtersKey());
    setItems([]);
    setCursor(null);
    setNotice(null);
    setNoticeText(null);
    setError(null);
    void runSearch(generation, q, "new", null);
  };

  const loadMore = () => {
    if (!cursor || loading) return;
    void runSearch(generationRef.current, activeQuery, "more", cursor);
  };

  const searchDeviceOnly = () => {
    const q = activeQuery || query.trim().slice(0, QUERY_MAX);
    if (!q) return;
    const generation = ++generationRef.current;
    setActiveQuery(q);
    setItems([]);
    setCursor(null);
    setNoticeText(null);
    setError(null);
    setLoading(true);
    void (async () => {
      await searchLocal(generation, currentScopeKey(), q, "manual");
      if (mountedRef.current && generation === generationRef.current) setLoading(false);
    })();
  };

  const peopleChips = [{ id: null, displayName: "全部人物" }, ...people.map((person) => ({ id: person.id, displayName: person.displayName }))];

  return <View style={s.screen}>
    <View style={styles.searchBar}>
      <TextInput
        accessibilityLabel="搜索家庭记忆"
        onChangeText={setQuery}
        onSubmitEditing={startSearch}
        placeholder="搜索记忆、讲述或故事"
        returnKeyType="search"
        style={[s.input, styles.input]}
        value={query}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="开始搜索"
        onPress={startSearch}
        style={s.primaryButton}
      >
        <Text style={s.primaryText}>搜索</Text>
      </Pressable>
    </View>
    <ScrollView horizontal accessibilityLabel="筛选人物" contentContainerStyle={styles.chipRow} showsHorizontalScrollIndicator={false}>
      {peopleChips.map((chip) => (
        <Pressable
          key={chip.id ?? "all"}
          accessibilityRole="button"
          accessibilityLabel={`筛选人物：${chip.displayName}`}
          accessibilityState={{ selected: personId === chip.id }}
          onPress={() => setPersonId(chip.id)}
          style={[styles.chip, (personId ?? null) === chip.id && styles.chipActive]}
        >
          <Text style={[styles.chipText, (personId ?? null) === chip.id && styles.chipTextActive]}>{chip.displayName}</Text>
        </Pressable>
      ))}
    </ScrollView>
    <ScrollView horizontal accessibilityLabel="筛选媒体类型" contentContainerStyle={styles.chipRow} showsHorizontalScrollIndicator={false}>
      {MEDIA_OPTIONS.map((option) => (
        <Pressable
          key={option.value}
          accessibilityRole="button"
          accessibilityLabel={`筛选类型：${option.label}`}
          accessibilityState={{ selected: mediaFilter === option.value }}
          onPress={() => setMediaFilter(option.value)}
          style={[styles.chip, mediaFilter === option.value && styles.chipActive]}
        >
          <Text style={[styles.chipText, mediaFilter === option.value && styles.chipTextActive]}>{option.label}</Text>
        </Pressable>
      ))}
    </ScrollView>
    <View style={styles.dateRow}>
      <TextInput
        accessibilityLabel="日期范围起点（年-月-日，可留空）"
        onChangeText={setDateFrom}
        placeholder="开始日期 2020-01-01"
        style={[s.input, styles.dateInput]}
        value={dateFrom}
      />
      <Text style={styles.dateSeparator}>至</Text>
      <TextInput
        accessibilityLabel="日期范围终点（年-月-日，可留空）"
        onChangeText={setDateTo}
        placeholder="结束日期 2026-12-31"
        style={[s.input, styles.dateInput]}
        value={dateTo}
      />
    </View>
    {notice ? <Text style={styles.notice}>{notice}</Text> : null}
    {noticeText ? <Text style={styles.noticeText}>{noticeText}</Text> : null}
    {error ? (
      <View style={styles.errorBox}>
        <Text style={[s.error, styles.errorText]}>{error}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="只搜索这台设备已保存的内容" onPress={searchDeviceOnly} style={s.secondaryButton}>
          <Text style={s.secondaryText}>只搜本机内容</Text>
        </Pressable>
      </View>
    ) : null}
    <FlatList
      contentContainerStyle={items.length === 0 ? { flexGrow: 1 } : styles.list}
      data={items}
      keyExtractor={(item) => item.key}
      ListEmptyComponent={!loading ? (
        <View style={s.empty}>
          <Text style={s.emptyTitle}>{activeQuery ? "没有找到相关内容" : "找回一段家庭记忆"}</Text>
          <Text style={s.emptyText}>
            {notice ? "这台设备上没有已保存的相关内容；联网后可以搜索完整家庭档案。" : "输入人物、地点、标题或讲述中的字词。"}
          </Text>
        </View>
      ) : null}
      ListFooterComponent={loading ? <ActivityIndicator color={s.colors.coral} /> : cursor ? (
        filtersKey() === activeFiltersKey ? (
          <Pressable accessibilityRole="button" accessibilityLabel="加载更多" onPress={loadMore} style={s.secondaryButton}>
            <Text style={s.secondaryText}>加载更多</Text>
          </Pressable>
        ) : (
          <Text style={styles.staleHint}>筛选已变化，点击「搜索」查看新结果。</Text>
        )
      ) : null}
      renderItem={({ item }) => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`打开${item.kindLabel}：${item.title}`}
          disabled={!item.open}
          onPress={() => item.open?.()}
          style={({ pressed }) => [s.card, pressed && s.pressed, !item.open && s.disabled]}
        >
          <Text style={styles.kind}>{item.kindLabel}</Text>
          <Text style={s.cardTitle}>{item.title}</Text>
          <Text numberOfLines={3} style={s.body}>{item.snippet}</Text>
        </Pressable>
      )}
    />
  </View>;
}

/** 按真实请求错误分类（§4.2）：不凭 online 标志猜测错误性质。 */
function classifyError(error: ApiError): string {
  if (error.status === 401) return "登录已过期，请重新登录后再搜索家庭档案。";
  if (error.status === 403) return "当前账号没有搜索这个家庭档案的权限。";
  if (error.status === 400) return error.message || "搜索请求的内容无效，请调整关键词或筛选后重试。";
  if (error.status === 429) return "搜索请求过于频繁，请稍后再试。";
  if (error.status >= 500) return "服务器暂时无法完成搜索，请稍后再试。";
  return error.message || "搜索失败。";
}

function createStyles(palette: JournalPalette) {
  return StyleSheet.create({
  searchBar: { flexDirection: "row", gap: 8, padding: 14, borderBottomColor: palette.line, borderBottomWidth: 1 },
  input: { flex: 1 },
  chipRow: { flexDirection: "row", gap: 8, paddingHorizontal: 14, paddingTop: 10 },
  chip: { borderColor: palette.line, borderRadius: 16, borderWidth: 1, minHeight: 48, justifyContent: "center", paddingHorizontal: 14 },
  chipActive: { backgroundColor: palette.softSage, borderColor: palette.sage },
  chipText: { color: palette.ink, fontSize: 14 },
  chipTextActive: { color: palette.sage, fontWeight: "700" },
  dateRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, paddingTop: 10 },
  dateInput: { flex: 1 },
  dateSeparator: { color: palette.ink, fontSize: 14 },
  staleHint: { color: palette.muted, fontSize: 12, lineHeight: 18, padding: 4, textAlign: "center" },
  list: { padding: 14, paddingBottom: 36, gap: 10 },
  notice: { backgroundColor: palette.softSage, color: palette.sage, fontSize: 13, lineHeight: 19, fontWeight: "700", paddingHorizontal: 14, paddingVertical: 8, marginTop: 10 },
  noticeText: { color: palette.warning, fontSize: 13, lineHeight: 19, fontWeight: "700", paddingHorizontal: 14, paddingVertical: 8, marginTop: 10 },
  errorBox: { paddingHorizontal: 14, paddingVertical: 10, gap: 8 },
  errorText: { padding: 0 },
  kind: { color: palette.coral, fontSize: 11, fontWeight: "800" },
  });
}
