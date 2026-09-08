import { recordLocalIntakeDraft } from "../native/intake-store";
import { listLocalDrafts } from "../drafts/store";
import { NativeMediaReader } from "../media/NativeMediaReader";
import type { ReaderAsset } from "../media/types";
import { requestMobileJson } from "../api/client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { ActivityIndicator, Image, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import * as Crypto from "expo-crypto";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import {
  AudioModule,
  type AudioRecorder,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
} from "expo-audio";
import { useApp } from "../state/AppContext";
import { ingestLocalImportSession, getLocalCaptureDetail, type LocalCaptureDetail } from "../storage/database";
import { preservePickedDocument, preservePickedMedia, preserveRecordedAudio, removeLocalFile } from "../storage/files";
import { beginPickerReceipt, finishPickerReceipt } from "../native/picker-intake";
import { PrecisionDateTimeField } from "../components/PrecisionDateTimeField";
import { usePersistentDraft } from "../drafts/use-draft";
import { parseDraftReaders, type DraftReader } from "../drafts/readers";
import { colors, sharedStyles } from "../theme";
import type { LocalImportIntakeItem, MediaCapturePayload } from "../types";
import { resolveNativeCaptureAccess } from "../authz/product-access";
import type { AppNavigation, MainTabParamList } from "../navigation/types";

export function CaptureScreen() {
  const navigation = useNavigation<AppNavigation>();
  const route = useRoute<RouteProp<MainTabParamList, "Capture">>();
  const { credentials, outbox, queued, viewer, family, people, userId, grantSyncConsent, syncConsent } = useApp();
  const captureAccess = resolveNativeCaptureAccess(Boolean(credentials), viewer);
  const draftScope = credentials?.instanceId && userId && family ? JSON.stringify([credentials.serverUrl, credentials.instanceId, userId, family.id]) : "local";
  const recordingTimezone = family?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [message, setMessage] = useState<string | null>(null);
  const capsuleDraft = usePersistentDraft(draftScope, captureAccess !== "readonly", credentials);
  const [readerState, setReaderState] = useState<{ scope: string; members: DraftReader[]; error: string | null }>({ scope: "", members: [], error: null });
  const [readerRefresh, setReaderRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    if (credentials && captureAccess === "enabled") {
      void requestMobileJson(credentials, "/api/mobile/v1/draft-readers").then(body => {
        const members = parseDraftReaders(body);
        if (active) setReaderState({ scope: draftScope, members, error: null });
      }).catch(() => {
        if (active) setReaderState({ scope: draftScope, members: [], error: "暂时无法核对登录成员。已选读者保留，发送时会再次验证；不会改为全家可见。" });
      });
    }
    return () => { active = false; };
  }, [credentials, draftScope, captureAccess, readerRefresh]);
  const readers = readerState.scope === draftScope ? readerState.members : [];
  const { addOriginal, change: changeDraft } = capsuleDraft;
  const currentDraftId = capsuleDraft.draft?.id;
  const [originals, setOriginals] = useState<Record<string, LocalCaptureDetail>>({});
  useEffect(() => {
    let active = true;
    void Promise.all((capsuleDraft.draft?.content.items ?? []).map(async item => item.localCaptureRef ? await getLocalCaptureDetail(item.localCaptureRef) : null)).then(rows => { if (active) setOriginals(Object.fromEntries(rows.flatMap(row => row ? [[row.captureId, row]] : []))); });
    return () => { active = false; };
  }, [capsuleDraft.draft?.content.items]);
  const [remoteMedia, setRemoteMedia] = useState<{ scope: string; assets: Record<string, ReaderAsset> }>({ scope: "", assets: {} });
  useEffect(() => {
    let active = true;
    const refs = capsuleDraft.draft?.content.items.filter(item => !item.localCaptureRef && item.assetId) ?? [];
    if (credentials) void Promise.all(refs.map(async item => {
      try { return await requestMobileJson(credentials, `/api/media/${encodeURIComponent(item.assetId!)}/metadata`) as ReaderAsset; }
      catch { return null; }
    })).then(rows => { if (active) setRemoteMedia({ scope: draftScope, assets: Object.fromEntries(rows.flatMap(row => row ? [[row.id, row]] : [])) }); });
    return () => { active = false; };
  }, [credentials, draftScope, capsuleDraft.draft?.content.items]);
  const continueLibraryDraft = capsuleDraft.continueServer, localDraftReady = Boolean(capsuleDraft.draft?.id);
  useEffect(() => {
    const id = route.params?.draftId;
    if (!id || !credentials || !localDraftReady) return;
    let active = true;
    void requestMobileJson(credentials, `/api/mobile/v1/drafts/${encodeURIComponent(id)}`).then(async body => {
      if (active) { await continueLibraryDraft(body as import("../drafts/model").Draft, () => active); if (active) navigation.setParams({ draftId: undefined }); }
    }).catch(e => { if (active) setMessage(e.message); });
    return () => { active = false; };
  }, [route.params?.draftId, credentials, localDraftReady, continueLibraryDraft, navigation]);
  const resumeLocalDraft = capsuleDraft.resume;
  useEffect(() => {
    const id = route.params?.localDraftId;
    if (!id || !localDraftReady) return;
    let active = true;
    void listLocalDrafts(draftScope).then(async rows => {
      const row = rows.find(draft => draft.id === id);
      if (active && row) { await resumeLocalDraft(row); if (active) navigation.setParams({ localDraftId: undefined }); }
    }).catch(e => { if (active) setMessage(e.message); });
    return () => { active = false; };
  }, [route.params?.localDraftId, draftScope, localDraftReady, resumeLocalDraft, navigation]);
  const sendDraft = async (publish: boolean, intent?: "draft" | "review") => {
    try {
      const content = capsuleDraft.draft?.content;
      if (publish && content?.visibility === "members" && content.readerUserIds.length === 0) {
        setMessage("请先选择可以阅读这件事的家人，或改回全家/仅自己。");
        return;
      }
      await capsuleDraft.save(publish, intent);
      setMessage("本机已保存，网络工作会在后台继续。");
      const row = capsuleDraft.draft;
      if (credentials && family && row) {
        const ids = [row.id, ...row.content.items.flatMap(item => item.localCaptureRef ? [item.localCaptureRef] : [])];
        void grantSyncConsent(syncConsent?.scope === "all" ? "all" : "selected", [...new Set([...(syncConsent?.ids ?? []), ...ids])]).catch(error => setMessage(error.message));
      } else void queued();
    } catch (error) { setMessage(error instanceof Error ? error.message : "本机保存失败。"); }
  };
  const recorderRef = useRef<AudioRecorder | null>(null);
  const mountedRef = useRef(false);
  const recordingBusyRef = useRef(false);
  const text = capsuleDraft.draft?.content.text ?? "";
  const setText = (text: string) => changeDraft({ text });
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const textInputRef = useRef<TextInput>(null);
  const actionAreaY = useRef(0);

  const releaseRecorder = useCallback(async () => {
    const recorder = recorderRef.current;
    recorderRef.current = null;
    try {
      recorder?.release();
    } finally {
      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
        interruptionMode: "doNotMix",
        shouldPlayInBackground: false,
        shouldRouteThroughEarpiece: false,
      });
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (recorderRef.current) void releaseRecorder().catch(() => {});
    };
  }, [releaseRecorder]);

  const finishQueue = useCallback(async () => {
    try {
      await queued();
    } catch {
      setMessage("已安全保存到本机；状态暂未刷新，重启后仍会保留。");
    }
  }, [queued]);

  const saveText = async () => {
    try { await capsuleDraft.save(false); setMessage("整件事已保存到本机，明天可以继续。"); }
    catch (error) { setMessage(error instanceof Error ? error.message : "无法保存草稿。"); }
  };

  const queuePickedAssets = useCallback(async (
    assets: ImagePicker.ImagePickerAsset[],
    source: "camera" | "library",
  ) => {
    if (captureAccess === "readonly") return;
    let success = 0;
    const failures: string[] = [];
    for (const asset of assets) {
      const id = Crypto.randomUUID();
      let privateUri: string | null = null;
      try {
        const payload = await preservePickedMedia(asset, id, source);
        privateUri = payload.localUri;
        await addOriginal(id, payload);
        privateUri = null;
        success += 1;
      } catch (error) {
        if (privateUri) removeLocalFile(privateUri);
        failures.push(error instanceof Error ? error.message : "保存失败");
      }
    }
    if (success > 0) await finishQueue();
    setMessage(
      failures.length > 0
        ? `已保全 ${success} 份原件；${failures.length} 份未能保存：${failures[0]}`
        : `已把 ${success} 份原件复制到 App 私有目录。`,
    );
  }, [captureAccess, finishQueue, addOriginal]);

  const pickMedia = useCallback(async (mode: "photo" | "video" | "library") => {
    if (captureAccess === "readonly") {
      setMessage("当前家庭角色只有查看权限，未创建本机待传记录。");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      if (mode !== "library") {
        const camera = await ImagePicker.requestCameraPermissionsAsync();
        if (!camera.granted) throw new Error("需要相机权限；也可以从相册导入。");
      }
      if (mode === "video") {
        const microphone = await requestRecordingPermissionsAsync();
        if (!microphone.granted) throw new Error("拍视频需要麦克风权限。");
      }
      const result = mode === "library"
        ? await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ["images", "videos"],
            allowsEditing: false,
            allowsMultipleSelection: true,
            quality: 1,
            preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current,
          })
        : await ImagePicker.launchCameraAsync({
            mediaTypes: mode === "photo" ? ["images"] : ["videos"],
            allowsEditing: false,
            quality: 1,
            videoQuality: ImagePicker.UIImagePickerControllerQualityType.High,
          });
      if (!result.canceled) {
        await queuePickedAssets(result.assets, mode === "library" ? "library" : "camera");
      }
    } catch (error) {
      const cameraUnavailable = error !== null && typeof error === "object" &&
        "code" in error && error.code === "ERR_CAMERA_UNAVAILABLE";
      setMessage(cameraUnavailable
        ? "当前设备无法使用相机，请从相册导入。"
        : error instanceof Error ? error.message : "无法保存所选素材。");
    } finally {
      setBusy(false);
    }
  }, [captureAccess, queuePickedAssets]);

  const pickFiles = useCallback(async () => {
    if (captureAccess === "readonly") {
      setMessage("当前家庭角色只有查看权限，未创建本机待传记录。");
      return;
    }
    setBusy(true);
    setMessage(null);
    const sessionId = Crypto.randomUUID();
    const createdAt = new Date().toISOString();
    try {
      const result = await DocumentPicker.getDocumentAsync({
        multiple: true,
        copyToCacheDirectory: true,
        type: [
          "image/*", "video/*", "audio/*", "application/pdf", "text/plain",
          "text/markdown", "text/rtf", "application/rtf",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ],
      });
      if (result.canceled) return;
      let copied = 0;
      let failed = 0;
      let queued = 0;
      for (const [index, asset] of result.assets.entries()) {
        const captureId = Crypto.randomUUID();
        let item: LocalImportIntakeItem;
        try {
          const payload = await preservePickedDocument(asset, captureId, (prepared) => {
            beginPickerReceipt({ sessionId, createdAt, captureId, index, payload: prepared, scope: draftScope });
          });
          item = {
            externalId: `picker-${index}`,
            captureId,
            sortOrder: index,
            kind: "file" as const,
            localUri: payload.localUri,
            payload,
          };
          copied += 1;
        } catch (error) {
          item = {
            externalId: `picker-${index}`,
            captureId,
            sortOrder: index,
            kind: "error" as const,
            error: error instanceof Error ? error.message : "copy_failed",
          };
        }
        let committed = false;
        try {
          const saved = await ingestLocalImportSession({ id: sessionId, source: "files", createdAt, items: [item], queue: false, scope: draftScope });
          queued += saved.queued;
          failed += saved.failed;
          committed = true;
          if (item.kind === "file" && item.payload && "localUri" in item.payload) await addOriginal(captureId, item.payload, true);
        } finally {
          finishPickerReceipt(captureId, committed);
        }
      }
      if (copied > 0 && currentDraftId) await recordLocalIntakeDraft(sessionId, draftScope, currentDraftId);
      if (queued > 0) await finishQueue();
      setMessage(failed > 0
        ? `已把 ${copied} 份原件复制到 App 私有目录；${failed} 项失败。`
        : `已从 Files 复制 ${copied} 份原件，可离线保留。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法从 Files 导入。");
    } finally {
      setBusy(false);
    }
  }, [captureAccess, finishQueue, addOriginal, draftScope, currentDraftId]);

  const toggleRecording = async () => {
    if (captureAccess === "readonly") {
      setMessage("当前家庭角色只有查看权限，未创建本机待传记录。");
      return;
    }
    if (recordingBusyRef.current) return;
    recordingBusyRef.current = true;
    setBusy(true);
    setMessage(null);
    let audioModeEnabled = false;
    let started = false;
    try {
      if (recording) {
        const recorder = recorderRef.current;
        if (!recorder) throw new Error("录音已中断，请重新开始。");
        await recorder.stop();
        if (!recorder.uri) throw new Error("没有读取到录音文件。");
        const id = Crypto.randomUUID();
        let privateUri: string | null = null;
        try {
          const payload = await preserveRecordedAudio(recorder.uri, id);
          privateUri = payload.localUri;
          await addOriginal(id, payload);
          privateUri = null;
        } catch (error) {
          if (privateUri) removeLocalFile(privateUri);
          throw error;
        }
        setMessage("录音原件已复制到 App 私有目录。");
        await finishQueue();
      } else {
        const permission = await requestRecordingPermissionsAsync();
        if (!mountedRef.current) return;
        if (!permission.granted) throw new Error("需要麦克风权限才能直接录音。");
        await setAudioModeAsync({
          allowsRecording: true,
          playsInSilentMode: true,
          interruptionMode: "doNotMix",
          shouldPlayInBackground: false,
          shouldRouteThroughEarpiece: false,
        });
        audioModeEnabled = true;
        if (!mountedRef.current) return;
        // Native construction can throw (including AVAudioRecorder on iOS).
        // Keep it out of render and create it only after permission/session setup.
        const preset = RecordingPresets.HIGH_QUALITY;
        // eslint-disable-next-line import/namespace -- Expo exposes this typed constructor through requireNativeModule.
        const recorder = new AudioModule.AudioRecorder({
          ...preset,
          ...(Platform.OS === "ios" ? preset.ios : Platform.OS === "android" ? preset.android : preset.web),
          isMeteringEnabled: false,
        });
        recorderRef.current = recorder;
        await recorder.prepareToRecordAsync();
        if (!mountedRef.current) return;
        recorder.record();
        started = true;
        setRecording(true);
        setMessage("正在录音，点“完成录音”后才会写入私有目录。");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : recording ? "无法保存录音。" : "无法开始录音。");
    } finally {
      if (!started) {
        if (recorderRef.current || audioModeEnabled) {
          // Cleanup must not replace a saved-file message or escape the handler.
          await releaseRecorder().catch(() => {});
        }
        if (mountedRef.current) setRecording(false);
      }
      recordingBusyRef.current = false;
      if (mountedRef.current) setBusy(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      const intent = route.params?.intent;
      if (!intent) return undefined;
      const timer = setTimeout(() => {
        if (intent === "text") {
          scrollRef.current?.scrollTo({ y: 0, animated: true });
          textInputRef.current?.focus();
        } else if (intent === "audio") {
          scrollRef.current?.scrollTo({ y: actionAreaY.current, animated: true });
          setMessage("录音区域已就绪，点“直接录音”开始。");
        } else {
          void pickMedia(intent);
        }
        navigation.setParams({ intent: undefined, requestKey: undefined });
      }, 50);
      return () => clearTimeout(timer);
    }, [navigation, pickMedia, route.params?.intent]),
  );

  if (captureAccess === "readonly") {
    return (
      <ScrollView contentContainerStyle={sharedStyles.content} ref={scrollRef} style={sharedStyles.screen}>
        <Text style={sharedStyles.eyebrow}>只读模式</Text>
        <Text style={sharedStyles.title}>记录此刻</Text>
        <View style={sharedStyles.warning}>
          <Text style={sharedStyles.warningText}>当前家庭角色只有查看权限。这里不会创建无法同步的本机待传记录；断开服务器后仍可使用纯本机记录。</Text>
        </View>
        <View style={sharedStyles.card}>
          <Text style={sharedStyles.cardTitle}>已有本机待传记录</Text>
          <Text style={sharedStyles.body}>{outbox.length > 0 ? `${outbox.length} 份既有记录仍安全保留，权限恢复后可继续同步。` : "没有等待补传的素材。"}</Text>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={sharedStyles.content} ref={scrollRef} style={sharedStyles.screen}>
      <Text style={sharedStyles.eyebrow}>离线也不会丢</Text>
      <Text testID="capture-title" style={sharedStyles.title}>记录此刻</Text>
      <Text style={sharedStyles.intro}>围绕一件事写文字、加照片和录音，自动保存到本机。</Text>
      <View style={sharedStyles.card}>
        <Text style={sharedStyles.label}>一句话、一段故事</Text>
        <TextInput testID="capture-text" multiline editable={capsuleDraft.draft?.status === "editing"} maxLength={5000} onChangeText={setText} placeholder="今天发生了什么？" ref={textInputRef} style={[sharedStyles.input, styles.textArea]} textAlignVertical="top" value={text} />
        <Text style={styles.counter}>{text.length} / 5000</Text>
        <Pressable disabled={busy || recording || capsuleDraft.draft?.status !== "editing"} onPress={() => void saveText()} style={({ pressed }) => [sharedStyles.primaryButton, pressed && sharedStyles.pressed, (busy || recording) && sharedStyles.disabled]}>
          <Text style={sharedStyles.primaryText}>保留整件事草稿</Text>
        </Pressable>
      </View>

      <View onLayout={(event) => { actionAreaY.current = event.nativeEvent.layout.y; }} style={styles.actionGrid}>
        <Action label="拍照片" hint="保留原图" disabled={busy || recording || capsuleDraft.draft?.status !== "editing"} onPress={() => void pickMedia("photo")} />
        <Action label="拍视频" hint="保留原片" disabled={busy || recording || capsuleDraft.draft?.status !== "editing"} onPress={() => void pickMedia("video")} />
        <Action label={recording ? "完成录音" : "直接录音"} hint={recording ? "保存原声" : "麦克风"} disabled={busy} primary={recording} onPress={() => void toggleRecording()} />
        <Action label="从相册导入" hint="可多选" disabled={busy || recording || capsuleDraft.draft?.status !== "editing"} onPress={() => void pickMedia("library")} />
        <Action label="从 Files 导入" hint="文档与录音" disabled={busy || recording || capsuleDraft.draft?.status !== "editing"} onPress={() => void pickFiles()} />
      </View>
      {busy ? <ActivityIndicator color={colors.coral} /> : null}
      {message ? <View style={sharedStyles.notice}><Text style={sharedStyles.noticeText}>{message}</Text></View> : null}

      {capsuleDraft.error ? <View accessibilityRole="alert" style={sharedStyles.warning}><Text style={sharedStyles.error}>{capsuleDraft.error}</Text><Action label="重试本机保存" hint="检查磁盘空间后重试" disabled={busy} onPress={() => void capsuleDraft.retry().catch(e => setMessage(e.message))} /></View> : null}
      <Text accessibilityLiveRegion="polite" style={sharedStyles.body}>{capsuleDraft.saved ? "本机已保存" : "正在写入本机…"} · {capsuleDraft.draft?.serverRevision ? "服务器已收到" : "服务器尚未收到"} · {capsuleDraft.draft?.status === "published" ? "正式记忆已创建" : "尚未创建正式记忆"} · AI 尚未整理</Text>
      {(capsuleDraft.unboundDrafts ?? []).map(row => <Action key={row.id} label={`把本机草稿“${row.content.title || row.content.text.slice(0, 20) || "未命名"}”用于${family?.name ?? "当前家庭"}`} hint="确认原件的目的地，不复制原件" disabled={busy || recording} onPress={() => void capsuleDraft.bind(row.id).catch(e => setMessage(e.message))} />)}
      {capsuleDraft.draft ? <View style={sharedStyles.card}>
        <Text style={sharedStyles.cardTitle}>这一件事</Text>
        <TextInput accessibilityLabel="记忆标题" placeholder="标题（可选）" value={capsuleDraft.draft.content.title} maxLength={100} editable={capsuleDraft.draft.status === "editing"} onChangeText={title => changeDraft({ title })} style={sharedStyles.input} />
        <Text style={sharedStyles.label}>发生时间</Text>
        <PrecisionDateTimeField
          occurredAt={capsuleDraft.draft.content.occurredAt}
          precision={capsuleDraft.draft.content.occurredAtPrecision}
          timezone={recordingTimezone}
          onChange={({ occurredAt, precision: occurredAtPrecision }) => changeDraft({ occurredAt, occurredAtPrecision })}
        />
        <Action label="就是现在" hint="确认此刻发生（精确时间）" disabled={capsuleDraft.draft.status !== "editing"} onPress={() => changeDraft({ occurredAt: new Date().toISOString(), occurredAtPrecision: "exact" })} />
        <Text style={sharedStyles.label}>参与人物</Text>
        {(people ?? []).map(person => <Pressable key={person.id} accessibilityRole="checkbox" accessibilityState={{ checked: capsuleDraft.draft!.content.participantIds.includes(person.id) }} style={sharedStyles.secondaryButton} onPress={() => { const ids = capsuleDraft.draft!.content.participantIds; changeDraft({ participantIds: ids.includes(person.id) ? ids.filter(id => id !== person.id) : [...ids, person.id] }); }}><Text>{capsuleDraft.draft!.content.participantIds.includes(person.id) ? "已选 · " : ""}{person.displayName}</Text></Pressable>)}
        {capsuleDraft.draft.content.items.map((item, index) => {
          const detail = item.localCaptureRef ? originals[item.localCaptureRef] : null;
          return <View key={item.id} style={sharedStyles.card}>
            {detail?.mediaType === "image" && detail.localUri ? <Image source={{ uri: detail.localUri }} accessibilityLabel={item.caption || "这件事的照片"} style={{ width: "100%", height: 180 }} resizeMode="contain" /> : null}
            <Text style={sharedStyles.body}>{detail?.fileName ?? "已保全的素材"}</Text>
            {item.localCaptureRef ? <Action label="打开原件 / 重听" hint="原件已在本机" disabled={false} onPress={() => navigation.navigate("LocalCapture", { captureId: item.localCaptureRef! })} /> : item.assetId && remoteMedia.scope === draftScope && remoteMedia.assets[item.assetId] ? <NativeMediaReader credentials={credentials} assets={[remoteMedia.assets[item.assetId]!]} /> : <Text accessibilityRole="alert" style={sharedStyles.body}>素材尚未读取；请联网重试，或核对读取权限。</Text>}
            <TextInput accessibilityLabel={`素材 ${index + 1} 说明`} value={item.caption} maxLength={2000} onChangeText={caption => changeDraft({ items: capsuleDraft.draft!.content.items.map(i => i.id === item.id ? { ...i, caption } : i) })} style={sharedStyles.input} />
            <View style={styles.actionGrid}>
              <Action label="上移" hint="调整顺序" disabled={index === 0} onPress={() => { const items = [...capsuleDraft.draft!.content.items]; [items[index - 1], items[index]] = [items[index]!, items[index - 1]!]; changeDraft({ items }); }} />
              <Action label="下移" hint="调整顺序" disabled={index === capsuleDraft.draft!.content.items.length - 1} onPress={() => { const items = [...capsuleDraft.draft!.content.items]; [items[index], items[index + 1]] = [items[index + 1]!, items[index]!]; changeDraft({ items }); }} />
              <Action label={capsuleDraft.draft!.content.coverItemId === item.id ? "已选为封面" : "设为封面"} hint="选择封面" disabled={false} onPress={() => changeDraft({ coverItemId: item.id })} />
              <Action label="从草稿移除" hint="原件仍保留" disabled={false} onPress={() => changeDraft({ items: capsuleDraft.draft!.content.items.filter(i => i.id !== item.id), coverItemId: capsuleDraft.draft!.content.coverItemId === item.id ? null : capsuleDraft.draft!.content.coverItemId })} />
            </View>
          </View>;
        })}
        <Text style={sharedStyles.label}>保存后的读者</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {([["family", "全家"], ["members", "指定成员"], ["private", "仅自己"]] as const).map(([value, label]) => {
            const active = capsuleDraft.draft!.content.visibility === value;
            return (
              <Pressable key={value} accessibilityRole="radio" accessibilityState={{ selected: active }} onPress={() => changeDraft(value === "members" ? { visibility: value } : { visibility: value, readerUserIds: [] })} style={[sharedStyles.secondaryButton, { opacity: active ? 1 : 0.65, borderColor: active ? colors.coral : colors.muted }]}>
                <Text style={active ? sharedStyles.secondaryText : { color: colors.muted, fontSize: 14 }}>{label}</Text>
              </Pressable>
            );
          })}
        </View>
        {capsuleDraft.draft.content.visibility === "members" ? <>
          <Text style={sharedStyles.label}>可以阅读的登录成员（始终包含自己）</Text>
          {readerState.scope === draftScope && readerState.error ? <Text accessibilityRole="alert" style={sharedStyles.body}>{readerState.error}</Text> : null}
          {!credentials ? <Text style={sharedStyles.body}>连接家庭后可以选择登录成员；没有账号的人物仍可参与这件事。</Text> : null}
          {credentials ? <Action label="重新核对成员" hint="联网更新可选成员，保留已有选择" disabled={false} onPress={() => setReaderRefresh(value => value + 1)} /> : null}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {readers.map(member => {
              const checked = capsuleDraft.draft!.content.readerUserIds.includes(member.id);
              return (
                <Pressable key={member.id} accessibilityRole="checkbox" accessibilityState={{ checked }} onPress={() => { const ids = capsuleDraft.draft!.content.readerUserIds; changeDraft({ readerUserIds: checked ? ids.filter(id => id !== member.id) : [...ids, member.id] }); }} style={[sharedStyles.secondaryButton, { opacity: checked ? 1 : 0.65 }]}>
                  <Text style={checked ? sharedStyles.secondaryText : { color: colors.muted, fontSize: 14 }}>{checked ? `已选 · ${member.name}` : member.name}</Text>
                </Pressable>
              );
            })}
            {capsuleDraft.draft.content.readerUserIds.filter(id => !readers.some(member => member.id === id)).map(id =>
              <Pressable key={id} accessibilityRole="checkbox" accessibilityState={{ checked: true }} onPress={() => changeDraft({ readerUserIds: capsuleDraft.draft!.content.readerUserIds.filter(readerId => readerId !== id) })} style={sharedStyles.secondaryButton}>
                <Text style={sharedStyles.secondaryText}>已选成员（待联网核对，点按移除）</Text>
              </Pressable>)}
          </View>
        </> : null}
        <Text style={{ color: colors.muted, fontSize: 12 }}>
          {capsuleDraft.draft.content.visibility === "family"
            ? "草稿文字在正式保存前仅自己可见；保存后全家可读。"
            : "新上传的素材只对所选读者可见；已全家共享的素材不会因此变私密。带新素材的此类草稿本轮先留本机，仅文字可直接创建。"}
        </Text>
        {(!credentials || viewer?.canEditEvents) && <Action label="保存为一条记忆" hint="先写入本机，再同步到已授权家庭" disabled={busy || recording || !!capsuleDraft.error || capsuleDraft.draft.status === "published"} onPress={() => void sendDraft(true)} />}
        {credentials && family && <View style={styles.actionGrid}>
          <Action label={`发送草稿到${family.name}`} hint="暂不创建记忆，可以换设备继续" disabled={busy || recording || capsuleDraft.draft.status !== "editing"} onPress={() => void sendDraft(false, "draft")} />
          <Action label="交给家人整理" hint={`送到${family.name}，全家可见`} disabled={busy || recording || capsuleDraft.draft.status !== "editing"} onPress={() => void sendDraft(false, "review")} />
        </View>}
        {(capsuleDraft.serverDrafts ?? []).filter(remote => !capsuleDraft.drafts.some(local => local.id === remote.id)).map(remote => <Action key={remote.id} label={`继续服务器草稿：${remote.title || remote.text.slice(0, 20) || "未命名"}`} hint="保留素材引用，不重复下载原件" disabled={busy || recording} onPress={() => void capsuleDraft.continueServer(remote).catch(e => setMessage(e.message))} />)}
        {capsuleDraft.draft.memoryEventId && <Action label="查看正式记忆" hint="已创建" disabled={false} onPress={() => navigation.navigate("Memory", { id: capsuleDraft.draft!.memoryEventId! })} />}
        <Action label="新建一件事" hint="继续草稿仍保留" disabled={busy || recording} onPress={() => void capsuleDraft.create().catch(e => setMessage(e.message))} />
        {capsuleDraft.draft.status === "queued" && <Action label="继续编辑" hint="暂停这件事的发送" disabled={busy || recording} onPress={() => void capsuleDraft.reopen().catch(e => setMessage(e.message))} />}
        <Action label="放弃草稿" hint="原件仍保留" disabled={busy || recording || capsuleDraft.draft.status === "published"} onPress={() => void capsuleDraft.discard().catch(e => setMessage(e.message))} />
        {capsuleDraft.drafts.filter(d => d.status === "editing" || d.status === "queued").map(row => <Action key={row.id} label={`继续：${row.content.title || row.content.text.slice(0, 30) || "未命名的一件事"}`} hint="本机草稿" disabled={busy || recording} onPress={() => void capsuleDraft.resume(row)} />)}
      </View> : null}

      <View style={sharedStyles.card}>
        <Text style={sharedStyles.cardTitle}>本机同步状态</Text>
        {outbox.length === 0 ? <Text style={sharedStyles.body}>没有等待补传的素材。</Text> : outbox.map((item) => {
          const title = item.kind === "media_capture" ? (item.payload as MediaCapturePayload).fileName : (item.payload as { text: string }).text;
          return <View key={item.id} style={styles.outboxRow}><View style={styles.grow}><Text numberOfLines={1} style={styles.outboxTitle}>{title}</Text><Text style={item.lastError ? sharedStyles.error : styles.pending}>{item.lastError ?? "安全保存在本机 · 等待同步"}</Text></View><Text style={styles.state}>{item.attemptCount > 0 ? "重试" : "待传"}</Text></View>;
        })}
      </View>
    </ScrollView>
  );
}

function Action({ label, hint, onPress, disabled, primary = false }: { label: string; hint: string; onPress: () => void; disabled: boolean; primary?: boolean }) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.action, primary && styles.recording, pressed && sharedStyles.pressed, disabled && sharedStyles.disabled]}><Text style={[styles.actionLabel, primary && styles.recordingText]}>{label}</Text><Text style={[styles.actionHint, primary && styles.recordingText]}>{hint}</Text></Pressable>;
}

const styles = StyleSheet.create({
  textArea: { minHeight: 140, fontSize: 17, lineHeight: 25 },
  counter: { color: colors.muted, fontSize: 12, textAlign: "right" },
  actionGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  action: { width: "48%", minHeight: 76, flexGrow: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.card, borderColor: colors.line, borderWidth: 1, borderRadius: 15, gap: 4 },
  recording: { backgroundColor: colors.coral, borderColor: colors.coral },
  actionLabel: { color: colors.coralDark, fontSize: 15, fontWeight: "800" },
  actionHint: { color: colors.muted, fontSize: 11 },
  recordingText: { color: "#FFFFFF" },
  outboxRow: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: 10, borderTopColor: colors.line, borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 8 },
  grow: { flex: 1, gap: 3 },
  outboxTitle: { color: colors.ink, fontSize: 13, fontWeight: "700" },
  pending: { color: colors.sage, fontSize: 11 },
  state: { color: colors.coralDark, fontSize: 11, fontWeight: "800" },
});
