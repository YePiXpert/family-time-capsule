import { Text, TextInput } from "../components/typography";
import { getServerCacheRevision, useServerCacheRevision } from "../storage/cache-lifecycle";
import { NativeMediaReader } from "../media/NativeMediaReader";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp, NativeStackScreenProps } from "@react-navigation/native-stack";
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import {
  ApiError,
  createMobileLibraryItem,
  fetchMobileLibraryDetail,
  fetchMobileLibraryPage,
  mutateMobileLibraryItem,
} from "../api/client";
import type { RootStackParamList } from "../navigation/types";
import { useApp } from "../state/AppContext";
import {
  deleteMeta,
  cacheMobileLibraryDetail,
  cacheMobileLibraryPage,
  getCachedMobileLibraryDetail,
  getCachedMobileLibraryPage,
  listLocalImportSessions,
} from "../storage/database";
import { useSharedStyles } from "../theme";
import type { JournalPalette } from "../design/tokens";
import type {
  MobileLibraryDetail,
  MobileLibraryDomain,
  MobileLibraryItem,
  MobileLibraryPage,
} from "../types";
import { dateLabel } from "../utils/format";

type Navigation = NativeStackNavigationProp<RootStackParamList>;
type DetailRoute = "PersonDetail" | "ImportSessionDetail";

const DOMAIN_COPY: Record<MobileLibraryDomain, { eyebrow: string; title: string; empty: string }> = {
  people: { eyebrow: "Family", title: "家人", empty: "还没有其他家人人物。" },
  imports: { eyebrow: "Import sessions", title: "导入会话", empty: "还没有服务器端导入会话。" },
};

function useThemedStyles() {
  const s = useSharedStyles();
  return useMemo(() => createStyles(s.colors), [s.colors]);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function booleanValue(value: unknown): boolean {
  return value === true;
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null && !Array.isArray(entry))
    : [];
}

function canWriteDomain(domain: MobileLibraryDomain, viewer: ReturnType<typeof useApp>["viewer"]): boolean {
  if (!viewer) return false;
  if (domain === "people") return viewer.role === "owner" || viewer.role === "admin";
  return viewer.canCapture;
}

function statusLabel(status: string | null): string {
  const labels: Record<string, string> = {
    child: "孩子",
    family: "家人",
    draft: "草稿",
    published: "已发布",
    sealed: "已封存",
    opened: "已开启",
    open: "开放中",
    paused: "已暂停",
    closed: "已关闭",
    collecting: "收集中",
    uploading: "上传中",
    reviewing: "待整理",
    completed: "已完成",
    cancelled: "已取消",
  };
  return status ? labels[status] ?? status : "";
}

function useLibraryPage(domain: MobileLibraryDomain) {
  const { credentials } = useApp();
  const epoch = useServerCacheRevision();
  const currentKey = JSON.stringify([credentials, domain, epoch]);
  const activeKey = useRef(currentKey);
  useLayoutEffect(() => { activeKey.current = currentKey; }, [currentKey]);
  const request = useRef(0);
  const [page, setPage] = useState<{ key: string; value: MobileLibraryPage } | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async (refresh = false) => {
    const serial = ++request.current;
    const key = JSON.stringify([credentials, domain, epoch]);
    const current = () => request.current === serial && activeKey.current === key && getServerCacheRevision() === epoch;
    setLoading(!refresh); setRefreshing(refresh); setError(null);
    try {
      const cached = await getCachedMobileLibraryPage(domain);
      if (!current()) return;
      setPage(cached ? { key, value: cached } : null);
      if (!credentials) { setError(cached ? "当前离线，正在显示上次打开的资料。" : "连接家庭服务器后可读取这部分档案。"); return; }
      try {
        const next = await fetchMobileLibraryPage(credentials, domain);
        if (!current()) return;
        if (!await cacheMobileLibraryPage(domain, next, epoch) || !current()) return;
        setPage({ key, value: next });
      } catch (reason) {
        if (!current()) return;
        if (reason instanceof ApiError && [401,403,404].includes(reason.status)) {
          setPage(null);
          await deleteMeta(`library_page:${domain}`);
          if (current()) setError("这份资料已不可读取，旧缓存已移除。");
        } else {
          setError(cached ? "暂时无法刷新，已保留上次成功缓存。" : reason instanceof Error ? reason.message : "读取失败。");
        }
      }
    } finally { if (current()) { setLoading(false); setRefreshing(false); } }
  }, [credentials, domain, epoch]);
  useFocusEffect(useCallback(() => { void load(); return () => { request.current++; }; }, [load]));
  return { page: page?.key === currentKey ? page.value : null, loading, refreshing, error, reload: () => load(true) };
}

function LibraryListScreen({
  domain,
  detailRoute,
  header,
}: {
  domain: MobileLibraryDomain;
  detailRoute?: DetailRoute;
  header?: React.ReactNode;
}) {
  const s = useSharedStyles();
  const styles = useThemedStyles();
  const navigation = useNavigation<Navigation>();
  const copy = DOMAIN_COPY[domain];
  const { page, loading, refreshing, error, reload } = useLibraryPage(domain);
  const open = (item: MobileLibraryItem) => {
    if (!detailRoute) return;
    navigation.navigate(detailRoute as "PersonDetail", { id: item.id });
  };
  return <View style={s.screen}>
    <FlatList
      contentContainerStyle={page?.items.length ? styles.list : styles.emptyList}
      data={page?.items ?? []}
      keyExtractor={(item) => item.id}
      ListHeaderComponent={<View style={styles.header}>
        <Text style={s.eyebrow}>{copy.eyebrow}</Text>
        <Text style={s.title}>{copy.title}</Text>
        {header}
        {error ? <View style={error.includes("上次") || error.includes("离线") ? s.notice : s.warning}><Text style={error.includes("上次") || error.includes("离线") ? s.noticeText : s.warningText}>{error}</Text></View> : null}
      </View>}
      ListEmptyComponent={!loading ? <View style={s.empty}><Text style={s.emptyTitle}>{copy.empty}</Text><Text style={s.emptyText}>已有缓存会在离线时继续显示。</Text></View> : null}
      ListFooterComponent={loading ? <ActivityIndicator color={s.colors.coral} /> : null}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reload} tintColor={s.colors.coral} />}
      renderItem={({ item }) => <Pressable disabled={!detailRoute} onPress={() => open(item)} style={({ pressed }) => [styles.row, pressed && s.pressed]}>
        <View style={styles.grow}>
          <Text style={styles.itemTitle}>{item.title}</Text>
          {item.subtitle ? <Text numberOfLines={2} style={styles.meta}>{item.subtitle}</Text> : null}
          <Text style={styles.meta}>{statusLabel(item.status)}{item.meta.submissionCount !== undefined ? ` · ${String(item.meta.submissionCount)} 份提交` : ""}{item.meta.totalCount !== undefined ? ` · ${String(item.meta.completedCount ?? 0)}/${String(item.meta.totalCount)}` : ""}</Text>
        </View>
        {detailRoute ? <Text style={styles.arrow}>›</Text> : null}
      </Pressable>}
    />
  </View>;
}

function useCreate(domain: MobileLibraryDomain, onCreated?: (id: string, token?: string) => void) {
  const { credentials, online } = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const create = async (input: Record<string, unknown>) => {
    if (!credentials || online === false) {
      setError("这个写操作需要联网；尚未向服务器提交任何内容。");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await createMobileLibraryItem(credentials, domain, input);
      if (!result.id) throw new Error("服务器没有返回新条目。");
      onCreated?.(result.id, result.token);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "创建失败。");
    } finally {
      setBusy(false);
    }
  };
  return { create, busy, error };
}

function InlineCreate({ domain }: { domain: "people" }) {
  const s = useSharedStyles();
  const navigation = useNavigation<Navigation>();
  const { viewer } = useApp();
  const [expanded, setExpanded] = useState(false);
  const [name, setName] = useState("");
  const [relation, setRelation] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const { create, busy, error } = useCreate(domain, id => { setExpanded(false); navigation.navigate("PersonDetail", { id }); });
  if (!canWriteDomain(domain, viewer)) return null;
  return <View style={s.card}><Pressable accessibilityRole="button" accessibilityState={{expanded}} onPress={() => setExpanded(value => !value)} style={s.secondaryButton}><Text style={s.secondaryText}>新增家人</Text></Pressable>
    {expanded ? <><TextInput accessibilityLabel="姓名" placeholder="姓名" value={name} onChangeText={setName} style={s.input} /><TextInput accessibilityLabel="关系" placeholder="与孩子的关系" value={relation} onChangeText={setRelation} style={s.input} /><TextInput accessibilityLabel="生日" placeholder="出生日期（可选）" value={birthDate} onChangeText={setBirthDate} style={s.input} />{error ? <Text accessibilityRole="alert">{error}</Text> : null}<Pressable accessibilityRole="button" disabled={busy} onPress={() => void create({displayName:name,relationToChild:relation,birthDate})} style={s.primaryButton}><Text style={s.primaryText}>保存</Text></Pressable></> : null}
  </View>;
}

export function PeopleScreen() {
  return <LibraryListScreen detailRoute="PersonDetail" domain="people" header={<InlineCreate domain="people" />} />;
}

export function ImportSessionsScreen() {
  return <LibraryListScreen detailRoute="ImportSessionDetail" domain="imports" header={<LocalImportSessions />} />;
}

function LocalImportSessions() {
  const s = useSharedStyles();
  const styles = useThemedStyles();
  const { credentials, userId, family } = useApp();
  const scope = credentials?.instanceId && userId && family ? JSON.stringify([credentials.serverUrl, credentials.instanceId, userId, family.id]) : "local";
  const [error, setError] = useState<string | null>(null);
  const navigation = useNavigation<Navigation>();
  const [sessionState, setSessionState] = useState<{ scope: string; rows: Awaited<ReturnType<typeof listLocalImportSessions>> }>({ scope: "", rows: [] });
  const sessions = sessionState.scope === scope ? sessionState.rows : [];
  useFocusEffect(useCallback(() => {
    let active = true;
    void listLocalImportSessions(scope).then((rows) => { if (active) { setSessionState({ scope, rows }); setError(null); } }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [scope]));
  if (error) return <Text accessibilityRole="alert" style={s.error}>{error}</Text>;
  if (sessions.length === 0) return <View style={s.notice}><Text style={s.noticeText}>通过系统分享或 Files 选入的原件会先形成本机会话；即使没有服务器也会保留。</Text></View>;
  return <View style={s.card}>
    <Text style={s.cardTitle}>收到的内容 · {sessions.length}</Text>
    {sessions.map((session) => <Pressable accessibilityRole="button" onPress={() => navigation.navigate("LocalIntake", { id: session.id })} key={session.id} style={s.secondaryButton}><Text style={styles.itemTitle}>{session.source === "share" ? "系统分享" : "文件导入"}</Text><Text style={styles.meta}>{statusLabel(session.status)} · {session.completedCount}/{session.totalCount}{session.failedCount ? ` · ${session.failedCount} 项需重试` : ""}</Text></Pressable>)}
    <Pressable onPress={() => navigation.navigate("MainTabs", { screen: "Capture", params: { intent: "library", requestKey: Date.now() } })} style={s.secondaryButton}><Text style={s.secondaryText}>从 Files 继续导入</Text></Pressable>
  </View>;
}

function useLibraryDetail(domain: MobileLibraryDomain, id: string) {
  const { credentials } = useApp();
  const epoch = useServerCacheRevision();
  const currentKey = JSON.stringify([credentials, domain, id, epoch]);
  const activeKey = useRef(currentKey);
  useLayoutEffect(() => { activeKey.current = currentKey; }, [currentKey]);
  const request = useRef(0);
  const [detail, setDetail] = useState<{ key: string; value: MobileLibraryDetail } | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async (refresh = false) => {
    const serial = ++request.current;
    const key = JSON.stringify([credentials, domain, id, epoch]);
    const current = () => request.current === serial && activeKey.current === key && getServerCacheRevision() === epoch;
    setLoading(!refresh); setRefreshing(refresh); setError(null);
    try {
      const cached = await getCachedMobileLibraryDetail(domain, id);
      if (!current()) return;
      setDetail(cached ? { key, value: cached } : null);
      if (!credentials) { setError(cached ? "当前离线，正在显示上次打开的资料。" : "连接家庭服务器后可读取这部分档案。"); return; }
      try {
        const next = await fetchMobileLibraryDetail(credentials, domain, id);
        if (!current()) return;
        if (!await cacheMobileLibraryDetail(domain, next, epoch) || !current()) return;
        setDetail({ key, value: next });
      } catch (reason) {
        if (!current()) return;
        if (reason instanceof ApiError && [401,403,404].includes(reason.status)) {
          setDetail(null);
          await deleteMeta(`library_detail:${domain}:${id}`);
          if (current()) setError("这份资料已不可读取，旧缓存已移除。");
        } else {
          setError(cached ? "暂时无法刷新，已保留上次成功缓存。" : reason instanceof Error ? reason.message : "读取失败。");
        }
      }
    } finally { if (current()) { setLoading(false); setRefreshing(false); } }
  }, [credentials, domain, id, epoch]);
  useFocusEffect(useCallback(() => { void load(); return () => { request.current++; }; }, [load]));
  return { detail: detail?.key === currentKey ? detail.value : null, loading, refreshing, error, reload: () => load(true) };
}

function useMutation(domain: MobileLibraryDomain, id: string, reload: () => Promise<void>) {
  const { credentials, online } = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mutate = async (input: Record<string, unknown>) => {
    if (!credentials || online === false) {
      setError("这个写操作需要联网；没有在本机假装成功。");
      return null;
    }
    setBusy(true); setError(null);
    try {
      const result = await mutateMobileLibraryItem(credentials, domain, id, input);
      await reload();
      return result;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "操作失败。");
      return null;
    } finally { setBusy(false); }
  };
  return { mutate, busy, error };
}

function DetailShell({ domain, id, children }: { domain: MobileLibraryDomain; id: string; children: (detail: MobileLibraryDetail, controls: ReturnType<typeof useMutation>) => React.ReactNode }) {
  const s = useSharedStyles();
  const state = useLibraryDetail(domain, id);
  const controls = useMutation(domain, id, state.reload);
  return <ScrollView contentContainerStyle={s.content} refreshControl={<RefreshControl refreshing={state.loading} onRefresh={() => void state.reload()} tintColor={s.colors.coral} />} style={s.screen}>
    {state.error ? <View style={state.detail ? s.notice : s.warning}><Text style={state.detail ? s.noticeText : s.warningText}>{state.error}</Text></View> : null}
    {controls.error ? <Text style={s.error}>{controls.error}</Text> : null}
    {state.detail ? children(state.detail, controls) : state.loading ? <ActivityIndicator color={s.colors.coral} /> : <View style={s.empty}><Text style={s.emptyTitle}>没有可显示的详情</Text></View>}
  </ScrollView>;
}

type PersonDetailProps = NativeStackScreenProps<RootStackParamList, "PersonDetail">;
export function PersonDetailScreen({ route, navigation }: PersonDetailProps) {
  const s = useSharedStyles();
  const styles = useThemedStyles();
  const { viewer, credentials } = useApp();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [relation, setRelation] = useState("");
  const [birthDate, setBirthDate] = useState("");
  return <DetailShell domain="people" id={route.params.id}>{(detail, controls) => {
    const memories = records(detail.memories);
    const narratives = records(detail.narratives);
    const voices = records(detail.voices);
    const beginEdit = () => { setName(detail.title); setRelation(stringValue(detail.relationToChild) ?? ""); setBirthDate(stringValue(detail.birthDate) ?? ""); setEditing(true); };
    return <>
      <Text style={s.eyebrow}>Person</Text><Text style={s.title}>{detail.title}</Text>
      <Text style={s.intro}>{stringValue(detail.relationToChild) ?? "家人"}{stringValue(detail.birthDate) ? ` · ${stringValue(detail.birthDate)}` : ""}</Text>
      {(viewer?.role === "owner" || viewer?.role === "admin") ? editing ? <View style={s.card}>
        <TextInput onChangeText={setName} placeholder="姓名" style={s.input} value={name} />
        <TextInput onChangeText={setRelation} placeholder="关系" style={s.input} value={relation} />
        <TextInput onChangeText={setBirthDate} placeholder="YYYY-MM-DD" style={s.input} value={birthDate} />
        <Pressable disabled={controls.busy} onPress={() => void controls.mutate({ displayName: name, relationToChild: relation, birthDate }).then((result) => result && setEditing(false))} style={s.primaryButton}><Text style={s.primaryText}>保存人物</Text></Pressable>
      </View> : <Pressable onPress={beginEdit} style={s.secondaryButton}><Text style={s.secondaryText}>编辑人物</Text></Pressable> : null}
      <Section title={`共同记忆 · ${memories.length}`}>{memories.map((entry) => <Pressable key={stringValue(entry.id)} onPress={() => navigation.navigate("Memory", { id: stringValue(entry.id) ?? "" })} style={styles.compactRow}><Text style={styles.itemTitle}>{stringValue(entry.title)}</Text><Text style={styles.meta}>{stringValue(entry.occurredAt) ? dateLabel(stringValue(entry.occurredAt)!) : ""}</Text></Pressable>)}</Section>
      {voices.length ? <Section title={`家人的声音 · 最近 ${voices.length} 段`}><NativeMediaReader credentials={credentials} assets={voices.map(voice=>({id:stringValue(voice.assetId)!,type:"audio",filename:stringValue(voice.memoryTitle)||"家人的声音",mimeType:stringValue(voice.mimeType)||"audio/mp4",author:detail.title,dateLabel:stringValue(voice.createdAt)?dateLabel(stringValue(voice.createdAt)!):undefined}))}/>{voices.map(voice=><Pressable key={stringValue(voice.id)} style={s.secondaryButton} onPress={()=>navigation.navigate("Memory",{id:stringValue(voice.memoryEventId)!})}><Text style={s.secondaryText}>回到来源：{stringValue(voice.memoryTitle)}</Text></Pressable>)}</Section>:null}
      <Section title={`独立讲述 · ${narratives.length}`}>{narratives.map((entry) => <View key={stringValue(entry.id)} style={styles.quote}><Text style={s.body}>{stringValue(entry.text)}</Text><Text style={styles.meta}>{stringValue(entry.memoryTitle)}</Text></View>)}</Section>
    </>;
  }}</DetailShell>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const s = useSharedStyles();
  return <View style={s.card}><Text style={s.cardTitle}>{title}</Text>{children}</View>;
}

function Info({ label, value }: { label: string; value: string }) {
  const styles = useThemedStyles();
  return <View style={styles.info}><Text style={styles.meta}>{label}</Text><Text style={styles.infoValue}>{value}</Text></View>;
}

type ImportDetailProps = NativeStackScreenProps<RootStackParamList, "ImportSessionDetail">;
export function ImportSessionDetailScreen({ route }: ImportDetailProps) {
  const s = useSharedStyles();
  const styles = useThemedStyles();
  return <DetailShell domain="imports" id={route.params.id}>{(detail, controls) => <>
    <Text style={s.eyebrow}>Import session · {statusLabel(stringValue(detail.status))}</Text><Text style={s.title}>{detail.title}</Text>
    <Section title="整体进度"><Info label="来源" value={stringValue(detail.source) ?? ""} /><Info label="完成" value={`${String(detail.completedCount ?? 0)}/${String(detail.totalCount ?? 0)}`} /><Info label="失败" value={String(detail.failedCount ?? 0)} /></Section>
    <Section title="文件">{records(detail.items).map((entry) => <View key={stringValue(entry.id)} style={styles.fileRow}><View style={styles.grow}><Text style={styles.itemTitle}>{stringValue(entry.filename) ?? "未命名文件"}</Text><Text style={styles.meta}>{statusLabel(stringValue(entry.status))} · {String(entry.receivedBytes ?? 0)}/{String(entry.totalBytes ?? 0)} bytes</Text>{stringValue(entry.errorCode) ? <Text style={s.error}>{stringValue(entry.errorCode)}</Text> : null}</View>{stringValue(entry.status) === "failed" && stringValue(entry.uploadId) ? <Pressable onPress={() => void controls.mutate({ operation: "retry", uploadId: entry.uploadId })}><Text style={styles.link}>重试</Text></Pressable> : null}</View>)}</Section>
    {booleanValue(detail.canWrite) && !["completed", "cancelled"].includes(stringValue(detail.status) ?? "") ? <View style={styles.actions}>
      {stringValue(detail.status) === "uploading" ? <Pressable onPress={() => void controls.mutate({ operation: "pause" })} style={s.secondaryButton}><Text style={s.secondaryText}>暂停</Text></Pressable> : <Pressable onPress={() => void controls.mutate({ operation: "resume" })} style={s.secondaryButton}><Text style={s.secondaryText}>继续</Text></Pressable>}
      <Pressable onPress={() => Alert.alert("取消未完成项？", "已完成原件不会回滚；仅清理尚未完成的临时上传。", [{ text: "返回", style: "cancel" }, { text: "取消未完成项", style: "destructive", onPress: () => void controls.mutate({ operation: "cancel" }) }])} style={styles.dangerButton}><Text style={styles.dangerText}>取消未完成项</Text></Pressable>
    </View> : null}
  </>}</DetailShell>;
}

function createStyles(palette: JournalPalette) {
  return StyleSheet.create({
  list: { padding: 18, paddingBottom: 44, gap: 10 },
  emptyList: { flexGrow: 1, padding: 18 },
  header: { gap: 14, marginBottom: 4 },
  row: { minHeight: 72, flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: palette.card, borderColor: palette.line, borderWidth: 1, borderRadius: 15, padding: 14 },
  compactRow: { minHeight: 48, justifyContent: "center", borderTopColor: palette.line, borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 8 },
  fileRow: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: 10, borderTopColor: palette.line, borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 8 },
  grow: { flex: 1, gap: 3 },
  itemTitle: { color: palette.ink, fontSize: 15, lineHeight: 21, fontWeight: "800" },
  meta: { color: palette.muted, fontSize: 12, lineHeight: 17 },
  arrow: { color: palette.coral, fontSize: 28 },
  link: { color: palette.coralDark, fontSize: 14, fontWeight: "800" },
  multiline: { minHeight: 110, textAlignVertical: "top" },
  linkCard: { alignItems: "center" },
  selectableLink: { color: palette.coralDark, fontSize: 13, lineHeight: 19, textAlign: "center" },
  quote: { borderLeftColor: palette.coral, borderLeftWidth: 3, paddingLeft: 12, gap: 4 },
  actions: { gap: 10 },
  dangerButton: { minHeight: 48, alignItems: "center", justifyContent: "center", borderColor: palette.dangerLine, borderRadius: 13, borderWidth: 1 },
  dangerText: { color: palette.error, fontSize: 14, fontWeight: "800" },
  info: { minHeight: 38, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 14, borderTopColor: palette.line, borderTopWidth: StyleSheet.hairlineWidth },
  infoValue: { flex: 1, color: palette.ink, fontSize: 13, fontWeight: "700", textAlign: "right" },
  });
}
