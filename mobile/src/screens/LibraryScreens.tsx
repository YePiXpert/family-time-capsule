import { useCallback, useState } from "react";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp, NativeStackScreenProps } from "@react-navigation/native-stack";
import QRCode from "react-native-qrcode-svg";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  createMobileLibraryItem,
  fetchMobileLibraryDetail,
  fetchMobileLibraryPage,
  mutateMobileLibraryItem,
} from "../api/client";
import type { RootStackParamList } from "../navigation/types";
import { useApp } from "../state/AppContext";
import {
  cacheMobileLibraryDetail,
  cacheMobileLibraryPage,
  getCachedMobileLibraryDetail,
  getCachedMobileLibraryPage,
  listLocalImportSessions,
} from "../storage/database";
import { colors, sharedStyles } from "../theme";
import type {
  MobileLibraryDetail,
  MobileLibraryDomain,
  MobileLibraryItem,
  MobileLibraryPage,
} from "../types";
import { dateLabel } from "../utils/format";

type Navigation = NativeStackNavigationProp<RootStackParamList>;
type DetailRoute = "PersonDetail" | "StoryDetail" | "CapsuleDetail" | "RequestDetail" | "ContributionPortalDetail" | "ImportSessionDetail";

const DOMAIN_COPY: Record<MobileLibraryDomain, { eyebrow: string; title: string; empty: string }> = {
  people: { eyebrow: "Family", title: "家人", empty: "还没有其他家人人物。" },
  stories: { eyebrow: "Stories", title: "故事", empty: "还没有故事草稿。" },
  capsules: { eyebrow: "Time capsules", title: "时间胶囊", empty: "还没有时间胶囊。" },
  requests: { eyebrow: "Oral history", title: "口述史", empty: "还没有向家人发起问题。" },
  portals: { eyebrow: "Contribution portals", title: "家庭投递箱", empty: "还没有家庭投递箱。" },
  imports: { eyebrow: "Import sessions", title: "导入会话", empty: "还没有服务器端导入会话。" },
};

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
  if (domain === "people") return viewer.role === "admin";
  if (domain === "stories" || domain === "capsules") return viewer.role === "admin" || viewer.role === "editor";
  if (domain === "requests" || domain === "portals") return viewer.canCreateContributions;
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
  const [page, setPage] = useState<MobileLibraryPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    const cached = await getCachedMobileLibraryPage(domain);
    if (cached) setPage(cached);
    if (!credentials) {
      setError(cached ? "当前离线，正在显示上次打开的资料。" : "连接家庭服务器后可读取这部分档案。");
      setLoading(false);
      setRefreshing(false);
      return;
    }
    try {
      const next = await fetchMobileLibraryPage(credentials, domain);
      await cacheMobileLibraryPage(domain, next);
      setPage(next);
    } catch (reason) {
      setError(cached
        ? "暂时无法刷新，已保留上次成功缓存。"
        : reason instanceof Error ? reason.message : "读取失败。");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [credentials, domain]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));
  return { page, loading, refreshing, error, reload: () => load(true) };
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
  const navigation = useNavigation<Navigation>();
  const copy = DOMAIN_COPY[domain];
  const { page, loading, refreshing, error, reload } = useLibraryPage(domain);
  const open = (item: MobileLibraryItem) => {
    if (!detailRoute) return;
    navigation.navigate(detailRoute as "PersonDetail", { id: item.id });
  };
  return <View style={sharedStyles.screen}>
    <FlatList
      contentContainerStyle={page?.items.length ? styles.list : styles.emptyList}
      data={page?.items ?? []}
      keyExtractor={(item) => item.id}
      ListHeaderComponent={<View style={styles.header}>
        <Text style={sharedStyles.eyebrow}>{copy.eyebrow}</Text>
        <Text style={sharedStyles.title}>{copy.title}</Text>
        {header}
        {error ? <View style={error.includes("上次") || error.includes("离线") ? sharedStyles.notice : sharedStyles.warning}><Text style={error.includes("上次") || error.includes("离线") ? sharedStyles.noticeText : sharedStyles.warningText}>{error}</Text></View> : null}
      </View>}
      ListEmptyComponent={!loading ? <View style={sharedStyles.empty}><Text style={sharedStyles.emptyTitle}>{copy.empty}</Text><Text style={sharedStyles.emptyText}>已有缓存会在离线时继续显示。</Text></View> : null}
      ListFooterComponent={loading ? <ActivityIndicator color={colors.coral} /> : null}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reload} tintColor={colors.coral} />}
      renderItem={({ item }) => <Pressable disabled={!detailRoute} onPress={() => open(item)} style={({ pressed }) => [styles.row, pressed && sharedStyles.pressed]}>
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

function InlineCreate({ domain }: { domain: "people" | "stories" | "capsules" | "portals" }) {
  const navigation = useNavigation<Navigation>();
  const { viewer } = useApp();
  const [expanded, setExpanded] = useState(false);
  const [first, setFirst] = useState("");
  const [second, setSecond] = useState("");
  const [third, setThird] = useState("");
  const { create, busy, error } = useCreate(domain, (id, token) => {
    setExpanded(false);
    setFirst(""); setSecond(""); setThird("");
    const route = domain === "people" ? "PersonDetail" : domain === "stories" ? "StoryDetail" : domain === "capsules" ? "CapsuleDetail" : "ContributionPortalDetail";
    if (route === "ContributionPortalDetail") navigation.navigate(route, { id, token });
    else navigation.navigate(route, { id });
  });
  if (!canWriteDomain(domain, viewer)) return null;
  if (domain === "stories") return <View style={sharedStyles.card}>
    <Text style={sharedStyles.cardTitle}>本周故事草稿</Text>
    <Text style={sharedStyles.body}>用已确认的记忆和真实讲述生成有来源的结构化草稿，不调用 AI，也不会自动发布。</Text>
    {error ? <Text style={sharedStyles.error}>{error}</Text> : null}
    <Pressable disabled={busy} onPress={() => void create({ anchor: new Date().toISOString() })} style={[sharedStyles.primaryButton, busy && sharedStyles.disabled]}><Text style={sharedStyles.primaryText}>{busy ? "创建中…" : "创建本周草稿"}</Text></Pressable>
  </View>;
  const labels = domain === "people"
    ? ["姓名", "与孩子的关系", "出生日期（可留空，YYYY-MM-DD）"]
    : domain === "capsules"
      ? ["胶囊名称", "开启日期（YYYY-MM-DD）", ""]
      : ["投递箱标题", "给家人的简短说明", ""];
  const submit = () => {
    if (domain === "people") void create({ displayName: first, relationToChild: second, birthDate: third });
    else if (domain === "capsules") void create({ title: first, unlockType: "date", unlockValue: second });
    else void create({ title: first, description: second });
  };
  return <View style={sharedStyles.card}>
    <Pressable onPress={() => setExpanded((value) => !value)}><Text style={styles.link}>{expanded ? "收起创建表单" : domain === "people" ? "+ 新增家人" : domain === "capsules" ? "+ 创建胶囊" : "+ 创建投递箱"}</Text></Pressable>
    {expanded ? <>
      <TextInput onChangeText={setFirst} placeholder={labels[0]} style={sharedStyles.input} value={first} />
      <TextInput multiline={domain === "portals"} onChangeText={setSecond} placeholder={labels[1]} style={sharedStyles.input} value={second} />
      {labels[2] ? <TextInput onChangeText={setThird} placeholder={labels[2]} style={sharedStyles.input} value={third} /> : null}
      {error ? <Text style={sharedStyles.error}>{error}</Text> : null}
      <Pressable disabled={busy} onPress={submit} style={[sharedStyles.primaryButton, busy && sharedStyles.disabled]}><Text style={sharedStyles.primaryText}>{busy ? "保存中…" : "保存"}</Text></Pressable>
    </> : null}
  </View>;
}

export function PeopleScreen() {
  return <LibraryListScreen detailRoute="PersonDetail" domain="people" header={<InlineCreate domain="people" />} />;
}
export function StoriesScreen() {
  return <LibraryListScreen detailRoute="StoryDetail" domain="stories" header={<InlineCreate domain="stories" />} />;
}
export function CapsulesScreen() {
  return <LibraryListScreen detailRoute="CapsuleDetail" domain="capsules" header={<InlineCreate domain="capsules" />} />;
}
export function ContributionPortalsScreen() {
  return <LibraryListScreen detailRoute="ContributionPortalDetail" domain="portals" header={<InlineCreate domain="portals" />} />;
}
export function ImportSessionsScreen() {
  return <LibraryListScreen detailRoute="ImportSessionDetail" domain="imports" header={<LocalImportSessions />} />;
}

function LocalImportSessions() {
  const navigation = useNavigation<Navigation>();
  const [sessions, setSessions] = useState<Awaited<ReturnType<typeof listLocalImportSessions>>>([]);
  useFocusEffect(useCallback(() => {
    let active = true;
    void listLocalImportSessions().then((rows) => { if (active) setSessions(rows); });
    return () => { active = false; };
  }, []));
  if (sessions.length === 0) return <View style={sharedStyles.notice}><Text style={sharedStyles.noticeText}>通过系统分享或 Files 选入的原件会先形成本机会话；即使没有服务器也会保留。</Text></View>;
  return <View style={sharedStyles.card}>
    <Text style={sharedStyles.cardTitle}>本机接管 · {sessions.length}</Text>
    {sessions.slice(0, 8).map((session) => <View key={session.id} style={styles.compactRow}><Text style={styles.itemTitle}>{session.source === "share" ? "系统分享" : "Files / DocumentsProvider"}</Text><Text style={styles.meta}>{statusLabel(session.status)} · {session.completedCount}/{session.totalCount}{session.failedCount ? ` · ${session.failedCount} 项需重试` : ""}</Text></View>)}
    <Pressable onPress={() => navigation.navigate("MainTabs", { screen: "Capture", params: { intent: "library", requestKey: Date.now() } })} style={sharedStyles.secondaryButton}><Text style={sharedStyles.secondaryText}>从 Files 继续导入</Text></Pressable>
  </View>;
}

export function RequestsScreen() {
  const navigation = useNavigation<Navigation>();
  const { viewer } = useApp();
  return <LibraryListScreen detailRoute="RequestDetail" domain="requests" header={canWriteDomain("requests", viewer) ? <Pressable onPress={() => navigation.navigate("RequestCreate")} style={sharedStyles.primaryButton}><Text style={sharedStyles.primaryText}>向家人发起问题</Text></Pressable> : undefined} />;
}

type RequestCreateProps = NativeStackScreenProps<RootStackParamList, "RequestCreate">;
export function RequestCreateScreen({ route }: RequestCreateProps) {
  const { credentials } = useApp();
  const [recipient, setRecipient] = useState("");
  const [prompt, setPrompt] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const { create, busy, error } = useCreate("requests", (_id, token) => {
    if (credentials && token) setLink(`${credentials.serverUrl}/respond/${token}`);
  });
  if (link) return <ScrollView contentContainerStyle={sharedStyles.content} style={sharedStyles.screen}>
    <Text style={sharedStyles.eyebrow}>只显示这一次</Text><Text style={sharedStyles.title}>回答链接已创建</Text>
    <LinkShareCard link={link} />
    <View style={sharedStyles.notice}><Text style={sharedStyles.noticeText}>服务器只保存 token 的 SHA-256 哈希。离开后不会从缓存找回这个明文链接；问题本身仍会保留。</Text></View>
  </ScrollView>;
  return <ScrollView contentContainerStyle={sharedStyles.content} style={sharedStyles.screen}>
    <Text style={sharedStyles.eyebrow}>Family voices</Text><Text style={sharedStyles.title}>创建口述史问题</Text>
    <TextInput onChangeText={setRecipient} placeholder="称呼，例如：外婆" style={sharedStyles.input} value={recipient} />
    <TextInput multiline onChangeText={setPrompt} placeholder="一个具体、容易回答的问题" style={[sharedStyles.input, styles.multiline]} value={prompt} />
    {error ? <Text style={sharedStyles.error}>{error}</Text> : null}
    <Pressable disabled={busy} onPress={() => void create({ recipientLabel: recipient, promptText: prompt, recipientPersonId: route.params?.personId ?? null })} style={[sharedStyles.primaryButton, busy && sharedStyles.disabled]}><Text style={sharedStyles.primaryText}>{busy ? "创建中…" : "创建安全回答链接"}</Text></Pressable>
  </ScrollView>;
}

type RequestDetailProps = NativeStackScreenProps<RootStackParamList, "RequestDetail">;
export function RequestDetailScreen({ route }: RequestDetailProps) {
  return <DetailShell domain="requests" id={route.params.id}>{(detail, controls) => <>
    <Text style={sharedStyles.eyebrow}>Oral history · {statusLabel(stringValue(detail.status))}</Text>
    <Text style={sharedStyles.title}>{detail.title}</Text>
    <Text style={sharedStyles.intro}>给{stringValue(detail.recipientLabel) ?? "家人"} · 有效期至 {stringValue(detail.expiresAt)?.slice(0, 10)}</Text>
    <Section title="回答状态"><Info label="已收到" value={`${String(detail.submissionCount ?? 0)} 条`} /><Info label="待整理" value={`${String(detail.pendingCount ?? 0)} 条`} /></Section>
    <View style={sharedStyles.notice}><Text style={sharedStyles.noticeText}>为保护访客入口，明文回答链接只在创建成功当次显示；服务器和离线缓存都不能从哈希恢复 token。</Text></View>
    {booleanValue(detail.canWrite) && stringValue(detail.status) === "open" ? <Pressable onPress={() => Alert.alert("关闭问题？", "回答链接会立即失效，已有回答仍保留在收件箱。", [{ text: "取消", style: "cancel" }, { text: "关闭", style: "destructive", onPress: () => void controls.mutate({ operation: "close" }) }])} style={styles.dangerButton}><Text style={styles.dangerText}>关闭问题</Text></Pressable> : null}
  </>}</DetailShell>;
}

function LinkShareCard({ link }: { link: string }) {
  return <View style={[sharedStyles.card, styles.linkCard]}>
    <QRCode backgroundColor={colors.card} color={colors.ink} quietZone={8} size={190} value={link} />
    <Text selectable style={styles.selectableLink}>{link}</Text>
    <Text style={styles.meta}>长按上方链接可复制，或使用系统分享。</Text>
    <Pressable onPress={() => void Share.share({ message: link, url: link })} style={sharedStyles.primaryButton}><Text style={sharedStyles.primaryText}>系统分享链接</Text></Pressable>
  </View>;
}

function useLibraryDetail(domain: MobileLibraryDomain, id: string) {
  const { credentials } = useApp();
  const [detail, setDetail] = useState<MobileLibraryDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const cached = await getCachedMobileLibraryDetail(domain, id);
    if (cached) setDetail(cached);
    if (!credentials) {
      setError(cached ? "当前离线，正在显示上次打开的详情。" : "这份详情尚未缓存，需要联网打开一次。");
      setLoading(false);
      return;
    }
    try {
      const next = await fetchMobileLibraryDetail(credentials, domain, id);
      await cacheMobileLibraryDetail(domain, next);
      setDetail(next);
    } catch (reason) {
      setError(cached ? "刷新失败，已保留上次成功缓存。" : reason instanceof Error ? reason.message : "读取失败。");
    } finally {
      setLoading(false);
    }
  }, [credentials, domain, id]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  return { detail, loading, error, reload: load };
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
  const state = useLibraryDetail(domain, id);
  const controls = useMutation(domain, id, state.reload);
  return <ScrollView contentContainerStyle={sharedStyles.content} refreshControl={<RefreshControl refreshing={state.loading} onRefresh={() => void state.reload()} tintColor={colors.coral} />} style={sharedStyles.screen}>
    {state.error ? <View style={state.detail ? sharedStyles.notice : sharedStyles.warning}><Text style={state.detail ? sharedStyles.noticeText : sharedStyles.warningText}>{state.error}</Text></View> : null}
    {controls.error ? <Text style={sharedStyles.error}>{controls.error}</Text> : null}
    {state.detail ? children(state.detail, controls) : state.loading ? <ActivityIndicator color={colors.coral} /> : <View style={sharedStyles.empty}><Text style={sharedStyles.emptyTitle}>没有可显示的详情</Text></View>}
  </ScrollView>;
}

type PersonDetailProps = NativeStackScreenProps<RootStackParamList, "PersonDetail">;
export function PersonDetailScreen({ route, navigation }: PersonDetailProps) {
  const { viewer } = useApp();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [relation, setRelation] = useState("");
  const [birthDate, setBirthDate] = useState("");
  return <DetailShell domain="people" id={route.params.id}>{(detail, controls) => {
    const memories = records(detail.memories);
    const narratives = records(detail.narratives);
    const requests = records(detail.requests);
    const beginEdit = () => { setName(detail.title); setRelation(stringValue(detail.relationToChild) ?? ""); setBirthDate(stringValue(detail.birthDate) ?? ""); setEditing(true); };
    return <>
      <Text style={sharedStyles.eyebrow}>Person</Text><Text style={sharedStyles.title}>{detail.title}</Text>
      <Text style={sharedStyles.intro}>{stringValue(detail.relationToChild) ?? "家人"}{stringValue(detail.birthDate) ? ` · ${stringValue(detail.birthDate)}` : ""}</Text>
      {viewer?.role === "admin" ? editing ? <View style={sharedStyles.card}>
        <TextInput onChangeText={setName} placeholder="姓名" style={sharedStyles.input} value={name} />
        <TextInput onChangeText={setRelation} placeholder="关系" style={sharedStyles.input} value={relation} />
        <TextInput onChangeText={setBirthDate} placeholder="YYYY-MM-DD" style={sharedStyles.input} value={birthDate} />
        <Pressable disabled={controls.busy} onPress={() => void controls.mutate({ displayName: name, relationToChild: relation, birthDate }).then((result) => result && setEditing(false))} style={sharedStyles.primaryButton}><Text style={sharedStyles.primaryText}>保存人物</Text></Pressable>
      </View> : <Pressable onPress={beginEdit} style={sharedStyles.secondaryButton}><Text style={sharedStyles.secondaryText}>编辑人物</Text></Pressable> : null}
      <Section title={`共同记忆 · ${memories.length}`}>{memories.map((entry) => <Pressable key={stringValue(entry.id)} onPress={() => navigation.navigate("Memory", { id: stringValue(entry.id) ?? "" })} style={styles.compactRow}><Text style={styles.itemTitle}>{stringValue(entry.title)}</Text><Text style={styles.meta}>{stringValue(entry.occurredAt) ? dateLabel(stringValue(entry.occurredAt)!) : ""}</Text></Pressable>)}</Section>
      <Section title={`独立讲述 · ${narratives.length}`}>{narratives.map((entry) => <View key={stringValue(entry.id)} style={styles.quote}><Text style={sharedStyles.body}>{stringValue(entry.text)}</Text><Text style={styles.meta}>{stringValue(entry.memoryTitle)}</Text></View>)}</Section>
      <Section title={`口述史问题 · ${requests.length}`}>{requests.map((entry) => <View key={stringValue(entry.id)} style={styles.compactRow}><Text style={styles.itemTitle}>{stringValue(entry.promptText)}</Text><Text style={styles.meta}>{statusLabel(stringValue(entry.status))}</Text></View>)}</Section>
    </>;
  }}</DetailShell>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <View style={sharedStyles.card}><Text style={sharedStyles.cardTitle}>{title}</Text>{children}</View>;
}

type StoryDetailProps = NativeStackScreenProps<RootStackParamList, "StoryDetail">;
export function StoryDetailScreen({ route, navigation }: StoryDetailProps) {
  const [title, setTitle] = useState("");
  const [paragraph, setParagraph] = useState("");
  return <DetailShell domain="stories" id={route.params.id}>{(detail, controls) => {
    const paragraphs = records(detail.paragraphs);
    const writable = booleanValue(detail.canWrite);
    return <>
      <Text style={sharedStyles.eyebrow}>Story · {statusLabel(stringValue(detail.status))}</Text><Text style={sharedStyles.title}>{detail.title}</Text>
      <Text style={sharedStyles.intro}>{stringValue(detail.periodStart)?.slice(0, 10)} — {stringValue(detail.periodEnd)?.slice(0, 10)}</Text>
      {paragraphs.map((entry) => <View key={stringValue(entry.id)} style={sharedStyles.card}><Text style={sharedStyles.body}>{stringValue(entry.text)}</Text><Text style={styles.meta}>{records(entry.sources).map((source) => stringValue(source.type) === "memory_event" ? "来源记忆" : stringValue(source.type) === "contribution" ? "真实讲述" : "人工文字").join(" · ")}</Text>{records(entry.sources).filter((source) => stringValue(source.type) === "memory_event").map((source) => <Pressable key={stringValue(source.id)} onPress={() => navigation.navigate("Memory", { id: stringValue(source.id) ?? "" })}><Text style={styles.link}>查看来源记忆 →</Text></Pressable>)}</View>)}
      {writable ? <View style={sharedStyles.card}><Text style={sharedStyles.cardTitle}>编辑草稿</Text>
        <TextInput onChangeText={setTitle} placeholder="新的故事标题" style={sharedStyles.input} value={title} />
        <Pressable disabled={!title.trim() || controls.busy} onPress={() => void controls.mutate({ operation: "title", title }).then((result) => result && setTitle(""))} style={sharedStyles.secondaryButton}><Text style={sharedStyles.secondaryText}>修改标题</Text></Pressable>
        <TextInput multiline onChangeText={setParagraph} placeholder="补一段人工文字（不会冒充引文）" style={[sharedStyles.input, styles.multiline]} value={paragraph} />
        <Pressable disabled={!paragraph.trim() || controls.busy} onPress={() => void controls.mutate({ operation: "paragraph", text: paragraph }).then((result) => result && setParagraph(""))} style={sharedStyles.secondaryButton}><Text style={sharedStyles.secondaryText}>加入段落</Text></Pressable>
        <Pressable disabled={controls.busy} onPress={() => Alert.alert("发布故事？", "发布后草稿将不可继续编辑。", [{ text: "取消", style: "cancel" }, { text: "发布", onPress: () => void controls.mutate({ operation: "publish" }) }])} style={sharedStyles.primaryButton}><Text style={sharedStyles.primaryText}>发布故事</Text></Pressable>
      </View> : null}
    </>;
  }}</DetailShell>;
}

type CapsuleDetailProps = NativeStackScreenProps<RootStackParamList, "CapsuleDetail">;
export function CapsuleDetailScreen({ route, navigation }: CapsuleDetailProps) {
  const { events } = useApp();
  return <DetailShell domain="capsules" id={route.params.id}>{(detail, controls) => {
    const unlocked = booleanValue(detail.unlocked);
    const status = stringValue(detail.status);
    const writable = booleanValue(detail.canWrite);
    const contentEvents = records(detail.events);
    return <>
      <Text style={sharedStyles.eyebrow}>Time capsule · {statusLabel(status)}</Text><Text style={sharedStyles.title}>{detail.title}</Text>
      <Text style={sharedStyles.intro}>{stringValue(detail.unlockType) === "age" ? "孩子年龄" : "开启日期"}：{stringValue(detail.unlockValue)}</Text>
      {!unlocked && status !== "draft" ? <View style={sharedStyles.notice}><Text style={sharedStyles.noticeText}>胶囊尚未到期。移动 API 不返回其中的记忆、原件或讲述。</Text></View> : null}
      {(unlocked || status === "draft") ? <Section title={`胶囊内容 · ${contentEvents.length}`}>{contentEvents.map((entry) => <Pressable key={stringValue(entry.id)} onPress={() => navigation.navigate("Memory", { id: stringValue(entry.id) ?? "" })} style={styles.compactRow}><Text style={styles.itemTitle}>{stringValue(entry.title)}</Text></Pressable>)}</Section> : null}
      {writable && status === "draft" ? <Section title="添加最近记忆">{events.filter((entry) => entry.source === "server" && !contentEvents.some((existing) => stringValue(existing.id) === entry.id)).slice(0, 8).map((entry) => <Pressable key={entry.id} onPress={() => void controls.mutate({ operation: "add_event", eventId: entry.id })} style={styles.compactRow}><Text style={styles.itemTitle}>{entry.title}</Text><Text style={styles.link}>加入</Text></Pressable>)}<Pressable onPress={() => Alert.alert("封存胶囊？", "封存后到期前不会通过移动 API 泄露内容。", [{ text: "取消", style: "cancel" }, { text: "封存", onPress: () => void controls.mutate({ operation: "seal" }) }])} style={sharedStyles.primaryButton}><Text style={sharedStyles.primaryText}>封存胶囊</Text></Pressable></Section> : null}
      {writable && status === "sealed" && unlocked ? <Pressable onPress={() => void controls.mutate({ operation: "open" })} style={sharedStyles.primaryButton}><Text style={sharedStyles.primaryText}>开启到期胶囊</Text></Pressable> : null}
    </>;
  }}</DetailShell>;
}

type PortalDetailProps = NativeStackScreenProps<RootStackParamList, "ContributionPortalDetail">;
export function ContributionPortalDetailScreen({ route, navigation }: PortalDetailProps) {
  const { credentials } = useApp();
  const [token, setToken] = useState(route.params.token ?? null);
  const link = token && credentials ? `${credentials.serverUrl}/contribute/${token}` : null;
  return <DetailShell domain="portals" id={route.params.id}>{(detail, controls) => <>
    <Text style={sharedStyles.eyebrow}>Family contribution portal</Text><Text style={sharedStyles.title}>{detail.title}</Text>
    <Text style={sharedStyles.intro}>{stringValue(detail.description)}</Text>
    <Section title="投递状态"><Info label="状态" value={statusLabel(stringValue(detail.status))} /><Info label="收到" value={`${String(detail.submissionCount ?? 0)} 份`} /><Info label="待整理" value={`${String(detail.pendingCount ?? 0)} 份`} /><Info label="有效期" value={stringValue(detail.expiresAt)?.slice(0, 10) ?? ""} /></Section>
    {link ? <><LinkShareCard link={link} /><View style={sharedStyles.notice}><Text style={sharedStyles.noticeText}>明文 token 只保留在当前页面状态，不写入离线缓存。换发后旧链接立即失效。</Text></View></> : <View style={sharedStyles.notice}><Text style={sharedStyles.noticeText}>为保护访客入口，服务器无法从 SHA-256 哈希恢复旧链接。可换发一个新链接，旧链接会立即失效。</Text></View>}
    {records(detail.bundles).length ? <Section title="最近提交">{records(detail.bundles).map((entry) => <Pressable key={stringValue(entry.id)} onPress={() => navigation.navigate("MainTabs", { screen: "Inbox" })} style={styles.compactRow}><Text style={styles.itemTitle}>{stringValue(entry.guestDisplayName) ?? "未填写称呼"}</Text><Text style={styles.meta}>{statusLabel(stringValue(entry.status))}</Text></Pressable>)}</Section> : null}
    {booleanValue(detail.canWrite) ? <View style={styles.actions}>
      {stringValue(detail.status) === "open" ? <Pressable onPress={() => void controls.mutate({ operation: "pause" })} style={sharedStyles.secondaryButton}><Text style={sharedStyles.secondaryText}>暂停投递</Text></Pressable> : null}
      {stringValue(detail.status) === "paused" ? <Pressable onPress={() => void controls.mutate({ operation: "reopen" })} style={sharedStyles.secondaryButton}><Text style={sharedStyles.secondaryText}>重新开放</Text></Pressable> : null}
      <Pressable onPress={() => void controls.mutate({ operation: "extend" })} style={sharedStyles.secondaryButton}><Text style={sharedStyles.secondaryText}>延长 30 天</Text></Pressable>
      <Pressable onPress={() => Alert.alert("换发投递链接？", "旧 token 会立即失效。", [{ text: "取消", style: "cancel" }, { text: "换发", onPress: () => void controls.mutate({ operation: "regenerate" }).then((result) => setToken(result?.token ?? null)) }])} style={sharedStyles.secondaryButton}><Text style={sharedStyles.secondaryText}>换发安全链接</Text></Pressable>
      <Pressable onPress={() => Alert.alert("撤销投递箱？", "旧链接将立即失效；已进入收件箱的原件不会删除。", [{ text: "取消", style: "cancel" }, { text: "撤销", style: "destructive", onPress: () => void controls.mutate({ operation: "revoke" }) }])} style={styles.dangerButton}><Text style={styles.dangerText}>撤销投递箱</Text></Pressable>
    </View> : null}
  </>}</DetailShell>;
}

function Info({ label, value }: { label: string; value: string }) {
  return <View style={styles.info}><Text style={styles.meta}>{label}</Text><Text style={styles.infoValue}>{value}</Text></View>;
}

type ImportDetailProps = NativeStackScreenProps<RootStackParamList, "ImportSessionDetail">;
export function ImportSessionDetailScreen({ route }: ImportDetailProps) {
  return <DetailShell domain="imports" id={route.params.id}>{(detail, controls) => <>
    <Text style={sharedStyles.eyebrow}>Import session · {statusLabel(stringValue(detail.status))}</Text><Text style={sharedStyles.title}>{detail.title}</Text>
    <Section title="整体进度"><Info label="来源" value={stringValue(detail.source) ?? ""} /><Info label="完成" value={`${String(detail.completedCount ?? 0)}/${String(detail.totalCount ?? 0)}`} /><Info label="失败" value={String(detail.failedCount ?? 0)} /></Section>
    <Section title="文件">{records(detail.items).map((entry) => <View key={stringValue(entry.id)} style={styles.fileRow}><View style={styles.grow}><Text style={styles.itemTitle}>{stringValue(entry.filename) ?? "未命名文件"}</Text><Text style={styles.meta}>{statusLabel(stringValue(entry.status))} · {String(entry.receivedBytes ?? 0)}/{String(entry.totalBytes ?? 0)} bytes</Text>{stringValue(entry.errorCode) ? <Text style={sharedStyles.error}>{stringValue(entry.errorCode)}</Text> : null}</View>{stringValue(entry.status) === "failed" && stringValue(entry.uploadId) ? <Pressable onPress={() => void controls.mutate({ operation: "retry", uploadId: entry.uploadId })}><Text style={styles.link}>重试</Text></Pressable> : null}</View>)}</Section>
    {booleanValue(detail.canWrite) && !["completed", "cancelled"].includes(stringValue(detail.status) ?? "") ? <View style={styles.actions}>
      {stringValue(detail.status) === "uploading" ? <Pressable onPress={() => void controls.mutate({ operation: "pause" })} style={sharedStyles.secondaryButton}><Text style={sharedStyles.secondaryText}>暂停</Text></Pressable> : <Pressable onPress={() => void controls.mutate({ operation: "resume" })} style={sharedStyles.secondaryButton}><Text style={sharedStyles.secondaryText}>继续</Text></Pressable>}
      <Pressable onPress={() => Alert.alert("取消未完成项？", "已完成原件不会回滚；仅清理尚未完成的临时上传。", [{ text: "返回", style: "cancel" }, { text: "取消未完成项", style: "destructive", onPress: () => void controls.mutate({ operation: "cancel" }) }])} style={styles.dangerButton}><Text style={styles.dangerText}>取消未完成项</Text></Pressable>
    </View> : null}
  </>}</DetailShell>;
}

const styles = StyleSheet.create({
  list: { padding: 18, paddingBottom: 44, gap: 10 },
  emptyList: { flexGrow: 1, padding: 18 },
  header: { gap: 14, marginBottom: 4 },
  row: { minHeight: 72, flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.card, borderColor: colors.line, borderWidth: 1, borderRadius: 15, padding: 14 },
  compactRow: { minHeight: 48, justifyContent: "center", borderTopColor: colors.line, borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 8 },
  fileRow: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: 10, borderTopColor: colors.line, borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 8 },
  grow: { flex: 1, gap: 3 },
  itemTitle: { color: colors.ink, fontSize: 15, lineHeight: 21, fontWeight: "800" },
  meta: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  arrow: { color: colors.coral, fontSize: 28 },
  link: { color: colors.coralDark, fontSize: 14, fontWeight: "800" },
  multiline: { minHeight: 110, textAlignVertical: "top" },
  linkCard: { alignItems: "center" },
  selectableLink: { color: colors.coralDark, fontSize: 13, lineHeight: 19, textAlign: "center" },
  quote: { borderLeftColor: colors.coral, borderLeftWidth: 3, paddingLeft: 12, gap: 4 },
  actions: { gap: 10 },
  dangerButton: { minHeight: 48, alignItems: "center", justifyContent: "center", borderColor: "#D9AAA1", borderRadius: 13, borderWidth: 1 },
  dangerText: { color: colors.error, fontSize: 14, fontWeight: "800" },
  info: { minHeight: 38, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 14, borderTopColor: colors.line, borderTopWidth: StyleSheet.hairlineWidth },
  infoValue: { flex: 1, color: colors.ink, fontSize: 13, fontWeight: "700", textAlign: "right" },
});
