import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { Pressable, View } from "react-native";
import { Text, TextInput } from "../components/typography";
import { ApiError, fetchNameReview, mutateNameReview, parseNameReview } from "../api/client";
import { memoryCacheScope } from "../memories/cache-scope";
import { useApp } from "../state/AppContext";
import { deleteMeta, getMeta, setMeta } from "../storage/database";
import { useSharedStyles } from "../theme";
import { NAME_SOURCE_LABELS, type NameKind, type NameReview } from "./types";

export function NameEditor({ kind, id, onSaved, refreshVersion = 0, defaultOpen = false }: { kind: NameKind; id: string; onSaved?: () => void; refreshVersion?: number; defaultOpen?: boolean }) {
  const { credentials, viewer, family } = useApp();
  const scope = memoryCacheScope(credentials, viewer?.id, family?.id);
  if (!credentials || !scope || !viewer?.canEditEvents) return null;
  return <Editor key={JSON.stringify([scope, kind, id])} kind={kind} id={id} scope={scope} onSaved={onSaved} refreshVersion={refreshVersion} defaultOpen={defaultOpen} />;
}

function Editor({ kind, id, scope, onSaved, refreshVersion, defaultOpen = false }: { kind: NameKind; id: string; scope: string; onSaved?: () => void; refreshVersion?: number; defaultOpen?: boolean }) {
  const s = useSharedStyles();
  const { credentials, online, runSync } = useApp();
  const [opened, setOpened] = useState(defaultOpen);
  const [review, setReview] = useState<NameReview | null>(null);
  const [title, setTitle] = useState("");
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const version = useRef(0);
  const touched = useRef(false);
  const lastRefresh = useRef(refreshVersion);
  const cacheKey = `name-review:${scope}:${kind}:${id}`;
  const load = useCallback(async () => {
    if (!opened) return;
    const request = ++version.current;
    setBusy(true); setVerified(false); setError(null);
    let cached: NameReview | null = null;
    try {
      const raw = await getMeta(cacheKey);
      try { if (raw) cached = parseNameReview(JSON.parse(raw)); } catch { /* Invalid cache cannot authorize writes. */ }
      if (request !== version.current) return;
      if (!credentials || online === false) {
        setReview(cached); if (!touched.current) setTitle(cached?.target.text ?? "");
        setError("当前离线，可查看已有建议；联网复核后才能保存修改。"); return;
      }
      const next = await fetchNameReview(credentials, kind, id);
      if (request !== version.current) return;
      await setMeta(cacheKey, JSON.stringify(next));
      if (request !== version.current) return;
      setReview(next); setVerified(true); if (!touched.current) setTitle(next.target.text ?? "");
    } catch (reason) {
      if (request !== version.current) return;
      if (reason instanceof ApiError && [401, 403, 404].includes(reason.status)) { setReview(null); await deleteMeta(cacheKey); }
      else setReview(cached);
      if (request === version.current) setError(reason instanceof Error ? reason.message : "无法读取名称。");
    } finally { if (request === version.current) setBusy(false); }
  }, [cacheKey, credentials, id, kind, online, opened]);
  useFocusEffect(useCallback(() => { void load(); return () => { version.current++; }; }, [load]));

  const mutate = async (input: Record<string, unknown>) => {
    if (!credentials || !verified || !review || busy || online === false) return;
    const request = ++version.current;
    setBusy(true); setError(null);
    try {
      const next = await mutateNameReview(credentials, { kind, id, revision: review.target.revision, ...input });
      if (request !== version.current) return;
      await setMeta(cacheKey, JSON.stringify(next));
      if (request !== version.current) return;
      setReview(next); setTitle(next.target.text ?? ""); touched.current = false; setEdits({});
      onSaved?.(); void runSync();
    } catch (reason) {
      if (request !== version.current) return;
      setVerified(false);
      if (reason instanceof ApiError && [401, 403, 404].includes(reason.status)) { setReview(null); await deleteMeta(cacheKey); }
      if (request === version.current) setError(reason instanceof ApiError && reason.status === 409 ? "另一端已修改名称或建议，本次没有覆盖。输入已保留，请刷新核对。" : reason instanceof Error ? reason.message : "名称未保存。");
    } finally { if (request === version.current) setBusy(false); }
  };
  useEffect(() => {
    if (lastRefresh.current !== refreshVersion) { lastRefresh.current = refreshVersion; void load(); }
  }, [load, refreshVersion]);
  const disabled = busy || !verified || online === false;
  return <View style={s.card}>
    <Pressable onPress={() => setOpened(!opened)} style={s.secondaryButton}><Text style={s.secondaryText}>{kind === "asset" ? "素材展示名" : "标题与 AI 建议"}</Text></Pressable>
    {opened ? <>
      {error ? <Text accessibilityRole="alert" style={s.warningText}>{error}</Text> : null}
      {review ? <>
        <Text style={s.body}>{NAME_SOURCE_LABELS[review.target.source] ?? "展示名称"} · 原件文件名和字节保持不变</Text>
        <TextInput accessibilityLabel="人工名称" maxLength={100} value={title} onChangeText={value => { touched.current = true; setTitle(value); }} style={s.input} />
        <Pressable disabled={disabled || !title.trim()} onPress={() => void mutate({ operation: "rename", title })} style={[s.primaryButton, disabled && s.disabled]}><Text style={s.primaryText}>保存人工名称</Text></Pressable>
        {review.suggestions.filter(row => row.status === "pending" || row.canUndo).map(row => <View key={row.id}>
          <Text style={s.body}>AI 建议：{row.title}{row.status === "pending" && !row.valid ? "（已过期）" : ""}</Text>
          {row.status === "pending" ? <>
            <TextInput accessibilityLabel="修改建议名称" maxLength={100} value={edits[row.id] ?? row.title} onChangeText={value => setEdits({ ...edits, [row.id]: value })} style={s.input} />
            <Pressable disabled={disabled || !row.valid} onPress={() => void mutate({ operation: "accept", suggestionId: row.id, suggestionRevision: row.revision, ...(edits[row.id] === undefined ? {} : { editedTitle: edits[row.id] }) })} style={s.secondaryButton}><Text style={s.secondaryText}>{edits[row.id] === undefined ? "采用" : "修改后采用"}</Text></Pressable>
            <Pressable disabled={disabled} onPress={() => void mutate({ operation: "reject", suggestionId: row.id, suggestionRevision: row.revision })} style={s.secondaryButton}><Text style={s.secondaryText}>忽略</Text></Pressable>
          </> : <Pressable disabled={disabled} onPress={() => void mutate({ operation: "undo", suggestionId: row.id, suggestionRevision: row.revision })} style={s.secondaryButton}><Text style={s.secondaryText}>撤销这次采用</Text></Pressable>}
        </View>)}
      </> : null}
      <Pressable disabled={busy} onPress={() => void load()} style={s.secondaryButton}><Text style={s.secondaryText}>{busy ? "读取中…" : "刷新名称与建议"}</Text></Pressable>
    </> : null}
  </View>;
}
