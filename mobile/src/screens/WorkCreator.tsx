import { Text, TextInput } from "../components/typography";
import { useCallback, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { Image, Pressable, View } from "react-native";
import { fetchBookMaterials, requestMobileJson, type BookMaterials } from "../api/client";
import { useAppData } from "../state/AppContext";
import { Disclosure } from "../components/Disclosure";
import { useColorTheme, useSharedStyles } from "../theme";
import { GROWTH_BOOK_TEMPLATES } from "../books/types";
import type { Credentials } from "../types";
import { formatOccurredDateLabel } from "../utils/occurred-precision";

type Material = BookMaterials["entries"][number];
type Selection = Pick<Material, "id" | "kind"> & { status: "pending" | "ready" | "unavailable"; material?: Material };
type Props = { kind: "album" | "book"; initialMemoryIds?: readonly string[]; onCreated: (id: string) => void; onCancel: () => void };

/** A new identity never inherits in-progress selections or an old request result. */
export function WorkCreator(props: Props) {
  const { credentials, userId, viewer, family } = useAppData();
  return <Creator key={JSON.stringify([credentials?.serverUrl, credentials?.instanceId, credentials?.token, userId ?? viewer?.id, family?.id])} {...props} />;
}

function MaterialPreview({ item, credentials }: { item: Material; credentials: Credentials }) {
  const s = useSharedStyles();
  const { colors } = useColorTheme();
  const { family } = useAppData();
  const image = item.images?.find(asset => asset.type === "image");
  const [failed, setFailed] = useState<string | null>(null);
  const date = item.occurredAt && item.occurredAtPrecision
    ? formatOccurredDateLabel(item.occurredAtPrecision, item.occurredAt, family?.timezone || "UTC") : "";
  return <View style={{ flexDirection: "row", alignItems: "center", gap: 12, flex: 1 }}>
    {image && failed !== image.id ? <Image accessibilityLabel={`${item.title}的照片`}
      source={{ uri: `${credentials.serverUrl}/api/media/${encodeURIComponent(image.previewAssetId || image.id)}`, headers: { Authorization: `Bearer ${credentials.token}` } }}
      onError={() => setFailed(image.id)} resizeMode="contain" style={{ width: 64, height: 76, borderRadius: 8, backgroundColor: colors.paper }} /> : null}
    <View style={{ flex: 1, gap: 4 }}>
      <Text style={s.secondaryText} numberOfLines={3}>{item.title || "一段记忆"}</Text>
      {date ? <Text style={{ color: colors.muted, fontSize: 13 }}>{date}</Text> : null}
      {item.images?.length ? <Text style={{ color: colors.muted, fontSize: 13 }}>{item.images.length} 张照片</Text> : null}
    </View>
  </View>;
}

function Creator({ kind, initialMemoryIds = [], onCreated, onCancel }: Props) {
  const s = useSharedStyles();
  const { credentials } = useAppData();
  const [template, setTemplate] = useState<"photos" | "growth">("growth");
  const [source, setSource] = useState<"memory" | "collection">("memory");
  const [monthInput, setMonthInput] = useState("");
  const [month, setMonth] = useState("");
  const [audience, setAudience] = useState<"family" | "personal">(initialMemoryIds.length ? "personal" : "family");
  const [page, setPage] = useState<BookMaterials | null>(null);
  const [selected, setSelected] = useState<Selection[]>(() => [...new Set(initialMemoryIds)].map(id => ({ id, kind: "memory", status: "pending" })));
  const selectedRef = useRef(selected);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectionError, setSelectionError] = useState("");
  const generation = useRef(0);
  const updateSelected = useCallback((update: (old: Selection[]) => Selection[]) => {
    selectedRef.current = update(selectedRef.current);
    setSelected(selectedRef.current);
  }, []);
  const intendedAudience = kind === "album" ? "personal" : audience;
  const load = useCallback(async (cursor = "", mine = generation.current) => {
    if (!credentials) return;
    setLoading(true);
    try {
      const next = await fetchBookMaterials(credentials, source, intendedAudience, cursor, month);
      if (mine !== generation.current) return;
      setPage(old => cursor && old ? { ...next, entries: [...old.entries, ...next.entries] } : next);
      setError("");
    } catch (e) { if (mine === generation.current) setError((e as Error).message); }
    finally { if (mine === generation.current) setLoading(false); }
  }, [credentials, source, intendedAudience, month]);
  const verifySelection = useCallback(async (mine = generation.current) => {
    if (!credentials || !selectedRef.current.length) return;
    const requested = selectedRef.current.map(({ id, kind }) => ({ id, kind }));
    // Metadata for the old intended audience is hidden until it is re-authorized.
    updateSelected(old => old.map(({ id, kind }) => ({ id, kind, status: "pending" })));
    setSelectionError("");
    try {
      const pages = await Promise.all((["memory", "collection"] as const).map(async type => {
        const ids = requested.filter(item => item.kind === type).map(item => item.id);
        return ids.length ? fetchBookMaterials(credentials, type, intendedAudience, "", "", ids) : null;
      }));
      if (mine !== generation.current) return;
      const available = new Map(pages.flatMap(result => result?.entries ?? []).map(item => [`${item.kind}:${item.id}`, item]));
      const requestedKeys = new Set(requested.map(item => `${item.kind}:${item.id}`));
      updateSelected(old => old.map(item => {
        if (!requestedKeys.has(`${item.kind}:${item.id}`)) return item;
        const material = available.get(`${item.kind}:${item.id}`);
        return { id: item.id, kind: item.kind, status: material ? "ready" : "unavailable", material };
      }));
    } catch {
      if (mine === generation.current) setSelectionError("还没能核对已选记录。选择已保留，请连接服务器后重试。");
    }
  }, [credentials, intendedAudience, updateSelected]);
  useFocusEffect(useCallback(() => {
    const mine = ++generation.current;
    setPage(null); void load("", mine); void verifySelection(mine);
    return () => { generation.current++; };
  }, [load, verifySelection]));

  async function create() {
    if (!credentials || busy || !selected.length || selected.length > 100 || selected.some(item => item.status !== "ready")) return;
    const mine = generation.current;
    setBusy(true); setError("");
    try {
      const result = await requestMobileJson(credentials, "/api/works", { method: "POST", body: JSON.stringify({ kind, audience, template, selection: selected.map(({ id, kind }) => ({ id, kind })) }) }) as { id?: unknown };
      if (mine !== generation.current) return;
      if (typeof result.id !== "string") throw new Error("生成结果无效，请返回作品列表查看。");
      onCreated(result.id);
    } catch (e) {
      if (mine === generation.current) {
        setError((e as Error).message);
        if (e && typeof e === "object" && "status" in e && e.status === 403) void verifySelection(mine);
      }
    } finally { if (mine === generation.current) setBusy(false); }
  }
  const canCreate = selected.length > 0 && selected.length <= 100 && selected.every(item => item.status === "ready");
  const button = (title: string, action: () => void, disabled = false) => <Pressable accessibilityRole="button" disabled={busy || disabled} onPress={action} style={s.secondaryButton}><Text style={s.secondaryText}>{title}</Text></Pressable>;
  const materials = <View style={{ gap: 10 }}>
    <Disclosure title="筛选素材">
      {kind === "book" ? button(source === "memory" ? "素材：记忆" : "素材：相册", () => setSource(value => value === "memory" ? "collection" : "memory")) : null}
      {source === "memory" ? <><TextInput accessibilityLabel="月份" placeholder="例如 2026-09，留空看全部" value={monthInput} onChangeText={setMonthInput} editable={!busy} style={s.input} />{button("应用月份", () => {
        if (monthInput && !/^\d{4}-(0[1-9]|1[0-2])$/.test(monthInput)) { setError("请输入有效月份，例如 2026-09。"); return; }
        setMonth(monthInput);
      })}</> : null}
    </Disclosure>
    {(page?.entries ?? []).map(item => {
      const checked = selected.some(row => row.id === item.id && row.kind === item.kind);
      return <Pressable key={`${item.kind}:${item.id}`} accessibilityRole="checkbox" accessibilityLabel={item.title} accessibilityState={{ checked }} disabled={busy || (!checked && selected.length >= 100)} onPress={() => updateSelected(old => checked ? old.filter(row => row.id !== item.id || row.kind !== item.kind) : [...old, { id: item.id, kind: item.kind, status: "ready", material: item }])} style={[s.secondaryButton, { flexDirection: "row", gap: 10 }]}>
        <Text style={s.secondaryText}>{checked ? "✓" : "+"}</Text>
        {credentials ? <MaterialPreview item={item} credentials={credentials} /> : null}
      </Pressable>;
    })}
    {loading ? <Text accessibilityLiveRegion="polite" style={s.body}>正在读取…</Text> : page && !page.entries.length ? <Text style={s.body}>还没有可选记忆，先记录一刻或调整筛选。</Text> : null}
    {page?.nextCursor ? <Pressable accessibilityRole="button" disabled={busy || loading} onPress={() => void load(page.nextCursor!)} style={s.secondaryButton}><Text style={s.secondaryText}>更多素材</Text></Pressable> : null}
  </View>;
  return <View style={s.card}>
    <Text style={s.cardTitle}>{selected.length ? `用这 ${selected.length} 条记忆${kind === "book" ? "成册" : "制作相册"}` : "选出想留下的记忆"}</Text>
    {!credentials ? <Text style={s.body}>连接家庭服务器后可以创建作品。</Text> : <>
      <Text style={s.body}>{kind === "album" ? "按原记忆权限显示" : audience === "family" ? "全家可见" : "仅自己可见"} · 已选 {selected.length} 条</Text>
      {selected.map((item, index) => <View key={`${item.kind}:${item.id}`} style={[s.notice, { gap: 8 }]}>
        {item.status === "ready" && item.material ? <MaterialPreview item={item.material} credentials={credentials} /> : <Text style={s.body}>
          {item.status === "pending" ? `正在核对第 ${index + 1} 条记忆…` : audience === "family" && kind === "book" ? `第 ${index + 1} 条记忆目前不能加入全家可见的成长册。可改为仅自己，或移除此条。` : `第 ${index + 1} 条记忆已删除或当前无法读取。请重试，或移除此条。`}
        </Text>}
        <Pressable accessibilityRole="button" accessibilityLabel={`移除第 ${index + 1} 条记忆`} disabled={busy} onPress={() => updateSelected(old => old.filter(row => row.id !== item.id || row.kind !== item.kind))} style={[s.secondaryButton, { alignSelf: "flex-start" }]}><Text style={s.secondaryText}>移除</Text></Pressable>
      </View>)}
      {selectionError ? <Text accessibilityRole="alert" style={s.error}>{selectionError}</Text> : null}
      {selectionError || selected.some(item => item.status === "unavailable") ? <Pressable accessibilityRole="button" disabled={busy} onPress={() => void verifySelection()} style={s.secondaryButton}><Text style={s.secondaryText}>重新核对已选记录</Text></Pressable> : null}
      {selected.length > 100 ? <Text accessibilityRole="alert" style={s.error}>一本最多加入 100 条记忆，请移除部分记录后再生成。</Text> : null}
      {error ? <><Text accessibilityRole="alert" style={s.error}>{error}</Text><Pressable accessibilityRole="button" disabled={busy} onPress={() => void load()} style={s.secondaryButton}><Text style={s.secondaryText}>重新读取</Text></Pressable></> : null}
      {selected.length ? <>
        <Text style={s.body}>先生成一份可以翻阅的预览，之后还能调整封面和内容。</Text>
        <Pressable accessibilityRole="button" disabled={busy || !canCreate} onPress={() => void create()} style={[s.primaryButton, (busy || !canCreate) && s.disabled]}><Text style={s.primaryText}>{busy ? "正在生成…" : "生成预览"}</Text></Pressable>
        <Disclosure title="添加更多记忆">{materials}</Disclosure>
      </> : materials}
      {kind === "book" ? <Disclosure title="样式与读者">
        <Text style={s.label}>谁可以阅读</Text>
        {(["personal", "family"] as const).map(value => <Pressable key={value} accessibilityRole="radio" accessibilityLabel={value === "personal" ? "仅自己" : "全家可见"} accessibilityState={{ checked: audience === value }} disabled={busy} onPress={() => setAudience(value)} style={audience === value ? s.notice : s.secondaryButton}><Text style={s.secondaryText}>{value === "personal" ? "仅自己" : "全家可见"}</Text></Pressable>)}
        <Text style={s.label}>成长册样式</Text>
        {GROWTH_BOOK_TEMPLATES.map(option => <Pressable key={option.id} accessibilityRole="radio" accessibilityLabel={option.title} accessibilityState={{ checked: template === option.id }} disabled={busy} onPress={() => setTemplate(option.id as "photos" | "growth")} style={template === option.id ? s.notice : s.secondaryButton}><Text style={s.secondaryText}>{option.title}</Text><Text style={s.body}>{option.description}</Text></Pressable>)}
      </Disclosure> : null}
    </>}
    {button("取消", onCancel)}
  </View>;
}
