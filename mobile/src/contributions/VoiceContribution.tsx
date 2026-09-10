import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Platform, Pressable, View } from "react-native";
import { AudioModule, RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, type AudioRecorder } from "expo-audio";
import { randomUUID } from "expo-crypto";
import { Text } from "../components/typography";
import { RecordingMeter } from "../components/RecordingMeter";
import { NativeMediaReader } from "../media/NativeMediaReader";
import { useApp } from "../state/AppContext";
import { requestMobileJson } from "../api/client";
import { emptyDraftContent } from "../drafts/model";
import { listLocalDrafts, saveLocalDraft, type LocalDraft } from "../drafts/store";
import { preserveRecordedAudio, uploadMediaCaptureReceipt } from "../storage/files";
import type { MediaCapturePayload } from "../types";
import { useSharedStyles } from "../theme";
import { submitVoice, type VoiceReceipt } from "./submit-voice";
type VoiceDraft = LocalDraft & { voice: VoiceReceipt; voicePayload: MediaCapturePayload };
const visibilityLabels = { family: "全家可见", private: "仅自己", parents: "父母可见", child_later: "留给孩子将来" };
export function NativeVoiceContribution({ memoryId, authorPersonId, authorName, visibility, onSaved, onRestoreSelection }: { memoryId: string; authorPersonId: string; authorName: string; visibility: VoiceReceipt["visibility"]; onSaved: () => Promise<void>; onRestoreSelection: (voice: VoiceReceipt) => void }) {
  const s = useSharedStyles();
  const { credentials, family, viewer } = useApp();
  const scope = JSON.stringify([credentials?.serverUrl, credentials?.instanceId, viewer?.id, family?.id, "voice", memoryId]);
  const identity = useRef(scope);
  useLayoutEffect(() => { identity.current = scope; return () => { identity.current = ""; }; }, [scope]);
  const mounted = useRef(true), operation = useRef(false), current = useRef<VoiceDraft | null>(null);
  const recorder = useRef<AudioRecorder | null>(null), finishRef = useRef<(() => Promise<void>) | null>(null);
  const [row, setRow] = useState<VoiceDraft | null>(null), [recording, setRecording] = useState(false);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const read = useCallback(() => recorder.current?.getStatus(), []);
  useEffect(() => {
    mounted.current = true;
    void listLocalDrafts(scope).then(rows => {
      const pending = (rows as VoiceDraft[]).find(r => r.voice?.memoryId === memoryId && ["editing", "queued"].includes(r.status));
      if (mounted.current && identity.current === scope && pending) { current.current = pending; setRow(pending); onRestoreSelection(pending.voice); }
    }).catch(() => { if (mounted.current) setMessage("无法读取本机录音，请检查存储空间。"); }).finally(() => { if (mounted.current) setLoading(false); });
    return () => { mounted.current = false; void finishRef.current?.(); };
  }, [scope, memoryId, onRestoreSelection]);
  const guard = () => { if (!mounted.current || identity.current !== scope) throw new Error("账号或页面已改变，录音仍保存在原账号的本机草稿中。"); };
  async function persist(next: VoiceDraft, payload?: MediaCapturePayload) {
    await saveLocalDraft(next, current.current?.id === next.id ? current.current.revision : 0, payload ? { id: next.voice.originalId, payload } : undefined);
    current.current = next;
    if (mounted.current && identity.current === scope) setRow(next);
  }
  async function record() {
    if (operation.current) return;
    operation.current = true; setBusy(true); setMessage("");
    try {
      if (recording) { await finishRef.current?.(); return; }
      if (!(await requestRecordingPermissionsAsync()).granted) throw new Error("需要麦克风权限才能留下声音。");
      guard();
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true, interruptionMode: "doNotMix", shouldPlayInBackground: false, shouldRouteThroughEarpiece: false });
      guard();
      const preset = RecordingPresets.HIGH_QUALITY;
      // eslint-disable-next-line import/namespace -- Expo provides the typed native recorder constructor.
      const rec = new AudioModule.AudioRecorder({ ...preset, ...(Platform.OS === "ios" ? preset.ios : Platform.OS === "android" ? preset.android : preset.web), isMeteringEnabled: true });
      recorder.current = rec;
      await rec.prepareToRecordAsync(); guard(); rec.record();
      let finishing: Promise<void> | null = null;
      finishRef.current = () => finishing ??= (async () => {
        try {
          await rec.stop();
          if (!rec.uri) throw new Error("没有读到录音文件，请重新录制。");
          const id = randomUUID(), originalId = randomUUID();
          const payload = await preserveRecordedAudio(rec.uri, originalId);
          const voice: VoiceReceipt = { id, originalId, assetId: null, memoryId, authorPersonId, authorName, visibility, text: "" };
          await persist({ id, scope, voice, voicePayload: payload, content: { ...emptyDraftContent(), visibility: "private", items: [{ id: originalId, localCaptureRef: originalId, assetId: null, caption: "" }] }, revision: 1, serverRevision: 0, mutationId: id, status: "editing", memoryEventId: null, updatedAt: new Date().toISOString() }, payload);
          if (mounted.current) setMessage("录音已保存在本机，可以重听后再保存到这条记录。");
        } catch (e) { if (mounted.current) setMessage(e instanceof Error ? e.message : "未能保存录音，请重试。"); }
        finally {
          recorder.current = null; finishRef.current = null;
          try { rec.release(); } catch { /* Already released by the operating system. */ }
          await setAudioModeAsync({ allowsRecording: false }).catch(() => {});
          if (mounted.current) setRecording(false);
        }
      })();
      setRecording(true);
    } catch (e) {
      try { recorder.current?.release(); } catch { /* Preserve the original error. */ }
      recorder.current = null;
      await setAudioModeAsync({ allowsRecording: false }).catch(() => {});
      if (mounted.current) setMessage(e instanceof Error ? e.message : "无法开始录音。");
    } finally { operation.current = false; if (mounted.current) setBusy(false); }
  }
  async function save() {
    if (!credentials || !current.current || operation.current) return;
    operation.current = true; setBusy(true); setMessage("");
    try {
      const initial = current.current;
      const next: VoiceDraft = { ...initial, voice: initial.status === "editing" ? { ...initial.voice, authorPersonId, authorName, visibility } : initial.voice, status: "queued", revision: initial.revision + 1 };
      await persist(next);
      await submitVoice(next.voice, (path, init) => requestMobileJson(credentials, path, init), async () => {
        const value = await uploadMediaCaptureReceipt(credentials, next.voice.originalId, next.voicePayload, async () => {}, { draftId: next.id, guard: async () => guard() });
        if (!value.assetId) throw new Error("原件上传未完成，可以重试。");
        return value.assetId;
      }, async id => { const latest = current.current!; await persist({ ...latest, voice: { ...latest.voice, assetId: id }, content: { ...latest.content, items: latest.content.items.map(item => ({ ...item, assetId: id })) }, revision: latest.revision + 1 }); }, guard);
      const latest = current.current!;
      await persist({ ...latest, status: "published", memoryEventId: memoryId, revision: latest.revision + 1 });
      guard(); current.current = null; setRow(null); setMessage("声音已保存到这条成长记录。"); await onSaved();
    } catch (e) { if (mounted.current && identity.current === scope) setMessage(e instanceof Error ? e.message : "录音尚未送达，本机原件保留。"); }
    finally { operation.current = false; if (mounted.current && identity.current === scope) setBusy(false); }
  }
  const selection = row?.status === "editing" ? { authorName, visibility } : row?.voice;
  return <View style={{ gap: 12 }}>
    {!row ? <Pressable accessibilityRole="button" disabled={busy || loading || !authorPersonId} onPress={() => void record()} style={s.secondaryButton}><Text style={s.secondaryText}>{recording ? "完成录音" : "留段声音"}</Text></Pressable> : <>
      <Text style={s.body}>{selection!.authorName} · {visibilityLabels[selection!.visibility]} · 本机录音</Text>
      <NativeMediaReader credentials={null} assets={[{ id: row.voice.originalId, type: "audio", filename: "待保存的声音", mimeType: row.voicePayload.mimeType, localUri: row.voicePayload.localUri }]} />
      <Pressable accessibilityRole="button" disabled={busy} onPress={() => void save()} style={s.primaryButton}><Text style={s.primaryText}>{busy ? "正在保存声音…" : row.status === "queued" ? "重试保存声音" : "保存声音"}</Text></Pressable>
    </>}
    {recording ? <RecordingMeter read={read} /> : null}
    {message ? <Text accessibilityLiveRegion="polite" style={s.body}>{message}</Text> : null}
  </View>;
}
