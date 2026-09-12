import { Text, TextInput } from "../components/typography";
import { useCallback, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { Pressable, View } from "react-native";
import { fetchBookMaterials, requestMobileJson, type BookMaterials } from "../api/client";
import { useAppData } from "../state/AppContext";
import { Disclosure } from "../components/Disclosure";
import { useSharedStyles } from "../theme";

import { GROWTH_BOOK_TEMPLATES } from "../books/types";

type Material = BookMaterials["entries"][number];
export function WorkCreator({ kind, onCreated, onCancel }: { kind: "album" | "book"; onCreated: (id: string) => void; onCancel: () => void }) {
  const s = useSharedStyles();
  const { credentials } = useAppData();
  const [template, setTemplate] = useState<"photos" | "growth">("growth");
  const [source, setSource] = useState<"memory" | "collection">("memory");
  const [monthInput, setMonthInput] = useState("");
  const [month, setMonth] = useState("");
  const [audience, setAudience] = useState<"family" | "personal">("family");
  const [page, setPage] = useState<BookMaterials | null>(null);
  const [selected, setSelected] = useState<Material[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const load = useCallback(async (cursor = "", mine = generation.current) => {
    if (!credentials) return;
    setLoading(true);
    try {
      const next = await fetchBookMaterials(credentials, source, kind === "album" ? "personal" : audience, cursor, month);
      if (mine !== generation.current) return;
      setPage(old => cursor && old ? { ...next, entries: [...old.entries, ...next.entries] } : next);
      setError("");
    } catch (e) { if (mine === generation.current) setError((e as Error).message); }
    finally { if (mine === generation.current) setLoading(false); }
  }, [credentials, source, audience, month, kind]);
  useFocusEffect(useCallback(() => {
    const mine = ++generation.current;
    setPage(null); void load("", mine);
    return () => { generation.current++; };
  }, [load]));
  async function create() {
    if (!credentials || busy) return;
    setBusy(true); setError("");
    try {
      const result = await requestMobileJson(credentials, "/api/works", { method: "POST", body: JSON.stringify({ kind, audience, template, selection: selected.map(({ id, kind }) => ({ id, kind })) }) }) as { id?: unknown };
      if (typeof result.id !== "string") throw new Error("生成结果无效，请返回作品列表查看。");
      onCreated(result.id);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  const button = (title: string, action: () => void, disabled = false) => <Pressable accessibilityRole="button" disabled={busy || disabled} onPress={action} style={s.secondaryButton}><Text style={s.secondaryText}>{title}</Text></Pressable>;
  return <View style={s.card}>
    <Text style={s.cardTitle}>选出想留下的记忆</Text>
    {!credentials ? <Text style={s.body}>连接家庭服务器后可以创建作品。</Text> : <>
      {kind === "book" ? <View style={{ gap: 8 }}><Text style={s.label}>成长册样式</Text>{GROWTH_BOOK_TEMPLATES.map(option => <Pressable key={option.id} accessibilityRole="radio" accessibilityState={{ checked: template === option.id }} disabled={busy} onPress={() => setTemplate(option.id as "photos" | "growth")} style={template === option.id ? s.notice : s.card}><Text style={s.cardTitle}>{option.title}</Text><Text style={s.body}>{option.description}</Text></Pressable>)}</View> : null}
      <Disclosure title="筛选与读者">
        {kind === "book" ? <>{button(source === "memory" ? "素材：记忆" : "素材：相册", () => setSource(value => value === "memory" ? "collection" : "memory"))}{button(audience === "family" ? "全家可见" : "仅自己", () => { setAudience(value => value === "family" ? "personal" : "family"); setSelected([]); })}</> : null}
        {source === "memory" ? <><TextInput accessibilityLabel="月份" placeholder="例如 2026-09，留空看全部" value={monthInput} onChangeText={setMonthInput} editable={!busy} style={s.input} />{button("应用月份", () => {
          if (monthInput && !/^\d{4}-(0[1-9]|1[0-2])$/.test(monthInput)) { setError("请输入有效月份，例如 2026-09。"); return; }
          setMonth(monthInput);
        })}</> : null}
      </Disclosure>
      <Text style={s.body}>{kind === "album" ? "按原记忆权限显示" : audience === "family" ? "全家可见" : "仅自己"} · 已选 {selected.length} 条</Text>
      {error ? <><Text accessibilityRole="alert" style={s.error}>{error}</Text><Pressable accessibilityRole="button" disabled={busy} onPress={() => void load()} style={s.secondaryButton}><Text style={s.secondaryText}>重新读取</Text></Pressable></> : null}
      {(page?.entries ?? []).map(item => {
        const checked = selected.some(row => row.id === item.id && row.kind === item.kind);
        return <Pressable key={`${item.kind}:${item.id}`} accessibilityRole="checkbox" accessibilityLabel={item.title} accessibilityState={{ checked }} disabled={busy || (!checked && selected.length >= 100)} onPress={() => setSelected(old => checked ? old.filter(row => row.id !== item.id || row.kind !== item.kind) : [...old, item])} style={s.secondaryButton}><Text style={s.secondaryText}>{checked ? "✓ " : ""}{item.title}</Text></Pressable>;
      })}
      {loading ? <Text accessibilityLiveRegion="polite">正在读取…</Text> : page && !page.entries.length ? <Text style={s.body}>还没有可选记忆，先记录一刻或调整筛选。</Text> : null}
      {page?.nextCursor ? <Pressable accessibilityRole="button" disabled={busy || loading} onPress={() => void load(page.nextCursor!)} style={s.secondaryButton}><Text style={s.secondaryText}>更多素材</Text></Pressable> : null}
      <Pressable accessibilityRole="button" disabled={busy || !selected.length} onPress={() => void create()} style={[s.primaryButton, (busy || !selected.length) && s.disabled]}><Text style={s.primaryText}>{busy ? "正在生成…" : "生成预览"}</Text></Pressable>
    </>}
    {button("取消", onCancel)}
  </View>;
}
