import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { Pressable, View } from "react-native";
import { Text, TextInput } from "../components/typography";
import { ApiError, fetchTranscriptReview, parseTranscriptReview, saveTranscriptReview } from "../api/client";
import { memoryCacheScope } from "../memories/cache-scope";
import { useApp } from "../state/AppContext";
import { deleteMeta, getMeta, setMeta } from "../storage/database";
import { useSharedStyles } from "../theme";
import type { TranscriptReview } from "./types";

export function TranscriptEditor({ assetId, label, onSaved, refreshVersion = 0 }: { assetId: string; label: string; onSaved?: () => void; refreshVersion?: number }) {
  const { credentials, viewer, family } = useApp();
  const scope = memoryCacheScope(credentials, viewer?.id, family?.id);
  if (!credentials || !scope) return null;
  return <Editor key={JSON.stringify([scope, assetId])} assetId={assetId} label={label} scope={scope} onSaved={onSaved} refreshVersion={refreshVersion} />;
}

function Editor({ assetId, label, scope, onSaved, refreshVersion }: { assetId: string; label: string; scope: string; onSaved?: () => void; refreshVersion?: number }) {
  const s = useSharedStyles();
  const { credentials, online } = useApp();
  const [opened, setOpened] = useState(false);
  const [review, setReview] = useState<TranscriptReview | null>(null);
  const [draft, setDraft] = useState({ text: "", revision: null as number | null });
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const touched = useRef(false);
  const lastRefresh = useRef(refreshVersion);
  const cacheKey = `transcript-review:${scope}:${assetId}`;
  const show = (next: TranscriptReview | null) => {
    setReview(next);
    if (!touched.current) setDraft({ text: next?.transcript?.text ?? "", revision: next?.transcript?.revision ?? null });
  };
  const load = useCallback(async () => {
    if (!opened) return;
    const request = ++generation.current;
    setBusy(true); setVerified(false); setError(null);
    let cached: TranscriptReview | null = null;
    try {
      const raw = await getMeta(cacheKey);
      try { if (raw) { const parsed = parseTranscriptReview(JSON.parse(raw)); if (parsed.assetId === assetId) cached = parsed; } } catch { /* Cache cannot authorize editing. */ }
      if (request !== generation.current) return;
      if (!credentials || online === false) {
        show(cached); setError("当前离线，可阅读已缓存的转录；联网复核后才能保存。"); return;
      }
      const next = await fetchTranscriptReview(credentials, assetId);
      if (request !== generation.current) return;
      await setMeta(cacheKey, JSON.stringify(next));
      if (request !== generation.current) return;
      show(next); setVerified(true);
    } catch (reason) {
      if (request !== generation.current) return;
      if (reason instanceof ApiError && [401, 403, 404].includes(reason.status)) {
        setReview(null); setDraft({ text: "", revision: null }); touched.current = false;
        await deleteMeta(cacheKey);
      } else show(cached);
      if (request === generation.current) setError(reason instanceof Error ? reason.message : "无法读取转录。");
    } finally { if (request === generation.current) setBusy(false); }
  }, [assetId, cacheKey, credentials, online, opened]);
  useFocusEffect(useCallback(() => { void load(); return () => { generation.current++; }; }, [load]));

  const save = async () => {
    if (!credentials || busy || !verified || !review?.canEdit || online === false) return;
    const request = ++generation.current;
    setBusy(true); setError(null);
    try {
      const next = await saveTranscriptReview(credentials, assetId, draft.text, draft.revision);
      if (request !== generation.current) return;
      await setMeta(cacheKey, JSON.stringify(next));
      if (request !== generation.current) return;
      touched.current = false; show(next); onSaved?.();
    } catch (reason) {
      if (request !== generation.current) return;
      setVerified(false);
      if (reason instanceof ApiError && [401, 403, 404].includes(reason.status)) {
        setReview(null); setDraft({ text: "", revision: null }); touched.current = false;
        await deleteMeta(cacheKey);
      }
      if (request === generation.current) setError(reason instanceof ApiError && reason.status === 409 ? "转录已在另一端更新，输入已保留。请刷新并核对两个版本。" : reason instanceof Error ? reason.message : "转录未保存。");
    } finally { if (request === generation.current) setBusy(false); }
  };
  useEffect(() => {
    if (lastRefresh.current !== refreshVersion) { lastRefresh.current = refreshVersion; void load(); }
  }, [load, refreshVersion]);
  const stale = review !== null && draft.revision !== (review.transcript?.revision ?? null);
  const disabled = busy || !verified || online === false;
  return <View style={s.card}>
    <Pressable onPress={() => setOpened(!opened)} style={s.secondaryButton}><Text style={s.secondaryText}>转录全文与修订 · {label}</Text></Pressable>
    {opened ? <>
      {error ? <Text accessibilityRole="alert" style={s.warningText}>{error}</Text> : null}
      {review ? <>
        <Text style={s.body}>{review.transcript?.edited ? "人工修订" : review.transcript ? "AI 转录 · 未确认" : "尚无转录，可手动记录听到的内容。"}</Text>
        <Text selectable style={s.body}>{review.transcript?.text || (review.transcript?.edited ? "转录已由你清空" : review.transcript ? "未识别到清晰语音" : "")}</Text>
        {review.canEdit ? <>
          <TextInput accessibilityLabel="修订转录全文" multiline maxLength={200_000} editable={!disabled} value={draft.text} onChangeText={text => { touched.current = true; setDraft({ ...draft, text }); }} style={s.input} />
          {stale ? <>
            <Text style={s.warningText}>上方是最新转录，下方输入仍保留原编辑版本。核对后再选择如何保存。</Text>
            <Pressable disabled={disabled} onPress={() => { touched.current = false; show(review); }} style={s.secondaryButton}><Text style={s.secondaryText}>载入最新转录</Text></Pressable>
            <Pressable disabled={disabled} onPress={() => setDraft({ ...draft, revision: review.transcript?.revision ?? null })} style={s.secondaryButton}><Text style={s.secondaryText}>已核对，保留我的输入</Text></Pressable>
          </> : null}
          <Pressable disabled={disabled || stale} onPress={() => void save()} style={[s.primaryButton, (disabled || stale) && s.disabled]}><Text style={s.primaryText}>保存转录修订</Text></Pressable>
        </> : null}
      </> : null}
      <Pressable disabled={busy} onPress={() => void load()} style={s.secondaryButton}><Text style={s.secondaryText}>{busy ? "读取中…" : "刷新转录"}</Text></Pressable>
    </> : null}
  </View>;
}
