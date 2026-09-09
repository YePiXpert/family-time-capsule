import { Text, TextInput } from "../components/typography";
import { useCallback, useRef, useState } from "react";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { Alert, Image, Pressable, ScrollView, View } from "react-native";
import * as Crypto from "expo-crypto";
import { requestMobileJson } from "../api/client";
import { useApp } from "../state/AppContext";
import { memoryCacheScope } from "../memories/cache-scope";
import { NativeMediaReader } from "../media/NativeMediaReader";
import { OrganizerPanel } from "../ai/OrganizerPanel";
import { DateTimeField } from "../components/DateTimeField";
import { utcToZonedWallTimeInput, zonedWallTimeToUtc } from "../utils/wall-time";
import { sharedStyles as s } from "../theme";
import type { AppNavigation } from "../navigation/types";
import type { LibraryPage, LibraryDetail } from "../assets/types";
const labels: Record<string, string> = { image: "照片", video: "视频", audio: "录音", document: "文档", none: "AI 尚未整理", pending: "AI 等待中", running: "AI 整理中", completed: "AI 已处理", failed: "AI 未完成", cancelled: "AI 已取消" };
function Button({ title, onPress, disabled = false }: { title: string; onPress: () => void; disabled?: boolean }) { return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[s.secondaryButton, disabled && s.disabled]}><Text style={s.secondaryText}>{title}</Text></Pressable>; }
export function NativeLibraryActions({ ids, canWrite, onDone }: { ids: string[]; canWrite: boolean; onDone?: () => void }) {
  const { credentials } = useApp(), navigation = useNavigation<AppNavigation>();
  const [mode, setMode] = useState<"draft" | "memory" | "collection" | null>(null), [targets, setTargets] = useState<{ id: string; title: string; revision?: number }[]>([]), [cursor, setCursor] = useState<string | null>(null), [query, setQuery] = useState(""), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const load = async (kind: "draft" | "memory" | "collection", next = "") => {
    if (!credentials) return;
    try {
      setMode(kind); setMessage(""); if (!next) setTargets([]);
      const body = await requestMobileJson(credentials, kind === "draft" ? "/api/mobile/v1/drafts" : kind === "collection" ? `/api/collections?cursor=${encodeURIComponent(next)}` : `/api/mobile/v1/search?q=${encodeURIComponent(query)}&cursor=${encodeURIComponent(next)}`) as { drafts?: { id: string; title: string; text: string; revision: number }[]; entries?: { id: string; title: string; revision: number }[]; items?: { type: string; id: string; title: string }[]; nextCursor?: string | null };
      const rows = body.drafts?.map(d => ({ ...d, title: d.title || d.text.slice(0, 30) || "未命名草稿" })) ?? body.entries ?? body.items?.filter(i => i.type === "memory") ?? [];
      setTargets(old => next ? [...old, ...rows] : rows); setCursor(body.nextCursor ?? null);
    } catch (error) { setMessage((error as Error).message); }
  };
  const add = async (operation: "draft" | "memory" | "collection", targetId: string, revision = 0) => {
    if (!credentials) return;
    setBusy(true); setMessage("");
    try {
      await requestMobileJson(credentials, "/api/mobile/v1/assets", { method: "POST", body: JSON.stringify({ operation, targetId, revision, mutationId: Crypto.randomUUID(), assetIds: ids }) });
      if (operation === "draft") navigation.navigate("MainTabs", { screen: "Capture", params: { draftId: targetId } });
      else { setMessage(`已加入${operation === "memory" ? "记忆" : "相册"}，原件仍在资料库。`); onDone?.(); }
    } catch (error) { setMessage((error as Error).message); } finally { setBusy(false); }
  };
  return <View style={s.card}><Text style={s.body}>已选 {ids.length} 份资料</Text><Button disabled={!ids.length || busy} title="加入一条新记忆" onPress={() => void add("draft", Crypto.randomUUID())} /><Button disabled={!ids.length || busy} title="加入已有草稿" onPress={() => void load("draft")} />{canWrite && <><Button disabled={!ids.length || busy} title="加入已有记忆" onPress={() => { setMode("memory"); setTargets([]); }} /><Button disabled={!ids.length || busy} title="加入相册" onPress={() => void load("collection")} /></>}{mode === "memory" && <><TextInput accessibilityLabel="搜索要加入的记忆" placeholder="输入标题或文字" style={s.input} value={query} onChangeText={setQuery} /><Button title="查找记忆" onPress={() => void load("memory")} /></>}{mode && <>{targets.map(target => <Button key={target.id} title={target.title} disabled={busy} onPress={() => void add(mode, target.id, target.revision)} />)}{cursor && <Button title="继续查找" onPress={() => void load(mode, cursor)} />}<Button title="收起选择" onPress={() => setMode(null)} /></>}{message ? <Text accessibilityRole="alert" style={s.body}>{message}</Text> : null}</View>;
}
export function AssetLibraryScreen() {
  const { credentials, userId, family, viewer } = useApp();
  return <Library key={`${memoryCacheScope(credentials, userId ?? undefined, family?.id) ?? "local"}:${viewer?.role}:${viewer?.canEditEvents}`} />;
}
function Library() {
  const { credentials, family } = useApp(), navigation = useNavigation<AppNavigation>();
  const [page, setPage] = useState<LibraryPage | null>(null), [selected, setSelected] = useState<string[]>([]), [type, setType] = useState(""), [error, setError] = useState("");
  const generation = useRef(0);
  const load = useCallback(async (cursor = "") => {
    const requestId = ++generation.current;
    if (!credentials) { setError("连接家庭后可查看服务器资料，本机原件仍可从记忆页打开。"); return; }
    try { const next = await requestMobileJson(credentials, `/api/mobile/v1/assets?type=${type}&cursor=${encodeURIComponent(cursor)}`) as LibraryPage; if (requestId !== generation.current) return; setPage(old => cursor && old ? { ...next, entries: [...old.entries, ...next.entries] } : next); setError(""); }
    catch (e) { if (requestId !== generation.current) return; setPage(null); setError((e as Error).message); }
  }, [credentials, type]);
  useFocusEffect(useCallback(() => { void load(); return () => { generation.current++; }; }, [load]));
  const retryDeletion = async (id: string) => {
    if (!credentials) return;
    try { const result = await requestMobileJson(credentials, `/api/mobile/v1/assets/${id}`, { method: "DELETE", body: JSON.stringify({ confirmed: true }) }) as { cleanupPending: boolean }; await load(); if (result.cleanupPending) setError("磁盘清理未完成，请联系维护者检查存储。"); }
    catch (e) { setError((e as Error).message); }
  };
  return <ScrollView style={s.screen} contentContainerStyle={s.content}><Text style={s.title}>资料库</Text><Text style={s.intro}>所有保留下来的原件，随时可以打开，稍后再整理。</Text><View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{["", "image", "video", "audio", "document"].map(value => <Button key={value} title={labels[value] ?? "全部"} onPress={() => { setType(value); setSelected([]); }} />)}</View>{error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}{page?.pendingDeletions.map(row => <View key={row.id} style={s.card}><Text accessibilityRole="alert" style={s.body}>原件已移出资料库，但磁盘清理尚未完成。请重试或联系维护者。</Text><Button title="重试清理已删除原件" onPress={() => void retryDeletion(row.id)} /></View>)}<Button title="刷新资料" onPress={() => void load()} />{page?.canCapture && <NativeLibraryActions ids={selected} canWrite={page.canWrite} onDone={() => void load()} />}{page?.entries.map(item => <View key={item.id} style={s.card}>{page.canCapture && <Pressable accessibilityRole="checkbox" accessibilityLabel={`选择 ${item.title}`} accessibilityState={{ checked: selected.includes(item.id) }} style={s.secondaryButton} onPress={() => setSelected(old => old.includes(item.id) ? old.filter(id => id !== item.id) : [...old, item.id])}><Text style={s.secondaryText}>{selected.includes(item.id) ? "已选" : "选择"}</Text></Pressable>}<Pressable accessibilityRole="button" onPress={() => navigation.navigate("AssetDetail", { id: item.id })}>{item.previewId && credentials && <Image accessibilityLabel={item.title} source={{ uri: `${credentials.serverUrl}/api/media/${item.previewId}`, headers: { Authorization: `Bearer ${credentials.token}` } }} style={{ width: "100%", height: 200 }} resizeMode="contain" />}<Text style={s.cardTitle}>{item.title}</Text><Text style={s.body}>{labels[item.type]} · {item.capturedAt ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeZone: family?.timezone }).format(new Date(item.capturedAt)) : "时间待补"}</Text><Text style={s.body}>{item.referenced ? "已被记忆引用" : "尚未加入记忆"} · 服务器已收到 · {labels[item.aiState] ?? "AI 状态待核对"}</Text></Pressable></View>)}{page && !page.entries.length && <Text style={s.body}>还没有资料，可以先记录或导入。</Text>}{page?.nextCursor && <Button title="更多资料" onPress={() => void load(page.nextCursor!)} />}</ScrollView>;
}
export function AssetDetailScreen({ route }: { route: { params: { id: string } } }) {
  const { credentials, userId, family, viewer } = useApp();
  return <Detail key={`${memoryCacheScope(credentials, userId ?? undefined, family?.id)}:${route.params.id}:${viewer?.role}:${viewer?.canEditEvents}`} id={route.params.id} />;
}
function Detail({ id }: { id: string }) {
  const { credentials, family, people } = useApp(), navigation = useNavigation<AppNavigation>();
  const [asset, setAsset] = useState<LibraryDetail | null>(null), [at, setAt] = useState(""), [ids, setIds] = useState<string[]>([]), [technical, setTechnical] = useState(false), [message, setMessage] = useState("");
  const timezone = family?.timezone ?? "UTC";
  const generation = useRef(0);
  const load = useCallback(async () => {
    const requestId = ++generation.current;
    if (!credentials) return;
    try { const result = await requestMobileJson(credentials, `/api/mobile/v1/assets/${id}`) as LibraryDetail; if (requestId !== generation.current) return; setAsset(result); setAt(result.capturedAt ? utcToZonedWallTimeInput(new Date(result.capturedAt), timezone) : ""); setIds(result.participantIds); setMessage(""); }
    catch (e) { if (requestId !== generation.current) return; setAsset(null); setMessage((e as Error).message); }
  }, [credentials, id, timezone]);
  useFocusEffect(useCallback(() => { void load(); return () => { generation.current++; }; }, [load]));
  const save = async () => {
    if (!credentials || !asset) return;
    try { const capturedAt = at ? zonedWallTimeToUtc(at.length === 16 ? `${at}:00` : at, timezone).toISOString() : null; const result = await requestMobileJson(credentials, `/api/mobile/v1/assets/${id}`, { method: "PATCH", body: JSON.stringify({ revision: asset.metadataRevision, capturedAt, participantIds: ids }) }) as LibraryDetail; setAsset(result); setMessage("资料信息已保存，原件字节保持不变。"); }
    catch (e) { setMessage((e as Error).message); }
  };
  const remove = () => Alert.alert("永久删除原件", "删除这份原件及预览，并移除未确认整理项中的引用。仍被草稿、记忆、相册或作品使用时会拒绝删除。已有下载和历史备份可能仍保留副本。", [{ text: "取消", style: "cancel" }, { text: "确认永久删除", style: "destructive", onPress: () => { if (!credentials) return; void requestMobileJson(credentials, `/api/mobile/v1/assets/${id}`, { method: "DELETE", body: JSON.stringify({ confirmed: true }) }).then(() => navigation.replace("AssetLibrary")).catch(e => setMessage(e.message)); } }]);
  return <ScrollView style={s.screen} contentContainerStyle={s.content}>{message ? <Text accessibilityRole="alert" style={s.body}>{message}</Text> : null}{asset ? <><Text style={s.title}>{asset.title}</Text><NativeMediaReader credentials={credentials} assets={[{ id: asset.id, filename: asset.title, type: asset.type, mimeType: asset.mimeType, durationMs: asset.technical.durationMs, thumbnailId: asset.previewId }]} />{asset.canCapture && <NativeLibraryActions ids={[asset.id]} canWrite={asset.canWrite} onDone={() => void load()} />}{asset.canWrite && <><OrganizerPanel kind="asset" id={asset.id} assetOperation="name" onSaved={() => void load()} /><Text style={s.label}>拍摄或发生时间</Text><DateTimeField value={at} onChange={value => setAt(value ?? "")} /><Button title="时间待补" onPress={() => setAt("")} /><Text style={s.label}>资料中的人物</Text>{people.map(person => <Pressable key={person.id} accessibilityRole="checkbox" accessibilityState={{ checked: ids.includes(person.id) }} style={s.secondaryButton} onPress={() => setIds(old => old.includes(person.id) ? old.filter(id => id !== person.id) : [...old, person.id])}><Text style={s.secondaryText}>{ids.includes(person.id) ? "已选 · " : ""}{person.displayName}</Text></Pressable>)}<Button title="保存时间与人物" onPress={() => void save()} />{["audio", "video"].includes(asset.type) && <OrganizerPanel kind="asset" id={asset.id} />}</>}{asset.canDelete && <Button title="删除原件" onPress={remove} />}<Button title={technical ? "收起详细信息" : "原件详细信息"} onPress={() => setTechnical(!technical)} />{technical && <View style={s.card}><Text selectable style={s.body}>原文件名：{asset.technical.originalFilename}</Text><Text selectable style={s.body}>SHA256：{asset.technical.sha256}</Text><Text style={s.body}>{asset.mimeType} · {asset.technical.bytes} 字节 · {asset.technical.width ?? "—"} × {asset.technical.height ?? "—"}</Text><Text style={s.body}>导入来源：{asset.technical.importSources.map(source => ({ web: "网页导入", native: "手机记录", share: "系统分享", guest: "亲友贡献" }[source] ?? "其他导入")).join("、") || "早期记录，未保留来源"}</Text><Text selectable style={s.body}>导入时间：{asset.technical.importedAt}</Text><Text selectable style={s.body}>{asset.technical.metadataJson ?? "没有内嵌元数据"}</Text></View>}</> : <Button title="重新打开资料" onPress={() => void load()} />}</ScrollView>;
}
