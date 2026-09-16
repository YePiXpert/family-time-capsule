import { JournalIcon } from "../components/JournalIcon";
import { RecordingMeter } from "../components/RecordingMeter";
import { CaptureWritingPrompts } from "../components/CaptureWritingPrompts";
import { Text, TextInput } from "../components/typography";
import { Button } from "../components/ui";
import { CollapsingHero } from "../components/CollapsingHero";
import { Disclosure } from "../components/Disclosure";
import { PrecisionDateTimeField } from "../components/PrecisionDateTimeField";
import { removeDraftItem, pairDraftItems, isDraftDateComplete } from "../drafts/model";
import { recordLocalIntakeDraft } from "../native/intake-store";
import { useServerPermissionRevision } from "../storage/cache-lifecycle";
import { draftReadingScope } from "../drafts/reading";
import { useMemoryCapture } from "../memories/use-memory-capture";
import { NativeMediaReader } from "../media/NativeMediaReader";
import type { ReaderAsset } from "../media/types";
import { OrganizerPanel } from "../ai/OrganizerPanel";
import { captureDateSummary, captureOrganizerAvailability, captureSavedMessage, canInferCaptureTime } from "../drafts/capture";
import type { AiSettings } from "../ai/types";
import { requestMobileJson, parseAiSettings } from "../api/client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusEffect, useNavigation, useRoute, usePreventRemove, type RouteProp } from "@react-navigation/native";
import { ActivityIndicator, Image, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
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
import { useAppData, useAppActions, useSyncStatus } from "../state/AppContext";
import { ingestLocalImportSession, getLocalCaptureDetail, type LocalCaptureDetail } from "../storage/database";
import { preservePickedDocument, preservePickedMedia, preparePickedMedia, preservePreparedMedia, preserveRecordedAudio, removeLocalFile } from "../storage/files";
import { beginPickerReceipt, finishPickerReceipt } from "../native/picker-intake";
import { GlassSheet, useConfirmSheet } from "../components/GlassSheet";
import { haptics } from "../design/haptics";
import { usePersistentDraft } from "../drafts/use-draft";
import { parseDraftReaders, type DraftReader } from "../drafts/readers";
import { sharedStyles, useColorTheme, useSharedStyles } from "../theme";
import { journalRadius, journalSpace, journalType } from "../design/tokens";
import type { LocalImportIntakeItem } from "../types";
import { resolveNativeCaptureAccess } from "../authz/product-access";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { useJournalKeyboardState } from "../navigation/dock-metrics";

export function CaptureScreen() {
  const route = useRoute<RouteProp<RootStackParamList, "Capture">>();
  const { credentials, userId, viewer, family } = useAppData();
  const scope = draftReadingScope(credentials, userId, viewer?.id, family?.id);
  const permissionRevision = useServerPermissionRevision();
  return <CaptureEditor key={JSON.stringify([scope, route.key, route.params?.target, permissionRevision])} />;
}

function CaptureEditor() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList, "Capture">>();
  const route = useRoute<RouteProp<RootStackParamList, "Capture">>();
  const { credentials, outbox, viewer, family, userId, syncConsent, people } = useAppData();
  const { queued, reloadLocal, grantSyncConsent } = useAppActions();
  const { syncing } = useSyncStatus();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const sharedStyles = useSharedStyles();
  const { colors } = sharedStyles;
  const confirm = useConfirmSheet();
  const keyboardOpen = useJournalKeyboardState();
  const captureAccess = resolveNativeCaptureAccess(Boolean(credentials), viewer);
  const activeScope = draftReadingScope(credentials, userId, viewer?.id, family?.id);
  const draftScope = route.params?.scope ?? activeScope ?? "local";
  const identityMatches = activeScope === draftScope;
  const target = route.params?.target;
  const memoryId = target?.kind === "memory" ? target.memoryId : null;
  const recordingTimezone = family?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const saveBusy = useRef(false);
  const [aiState, setAiState] = useState<{ scope: string; settings: AiSettings | null }>({ scope: "", settings: null });
  const [message, setMessage] = useState<string | null>(null);
  const localDraft = usePersistentDraft(draftScope, identityMatches && !memoryId && captureAccess !== "readonly", credentials, target);
  const memoryDraft = useMemoryCapture(draftScope, memoryId, credentials, recordingTimezone, identityMatches && !!memoryId);
  const capsuleDraft = memoryId ? memoryDraft : localDraft;
  const exitBySave = useRef(false);
  const reloadDraft = capsuleDraft.reload;
  useFocusEffect(useCallback(() => {
    if (syncing) return;
    void reloadDraft().catch(error => setMessage(error instanceof Error ? error.message : "暂时无法刷新记录状态。"));
  }, [reloadDraft, syncing]));
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
  useFocusEffect(useCallback(() => {
    let active = true;
    if (credentials && viewer?.canEditEvents) void requestMobileJson(credentials, "/api/mobile/v1/ai/settings").then(body => {
      const settings = parseAiSettings(body);
      if (active) setAiState({ scope: draftScope, settings });
    }).catch(() => { if (active) setAiState({ scope: draftScope, settings: null }); });
    return () => { active = false; };
  }, [credentials, draftScope, viewer?.canEditEvents]));
  const { addOriginal, addOriginals, change: changeDraft } = capsuleDraft;
  const currentDraftId = capsuleDraft.draft?.id;
  const draftUiKey = JSON.stringify([draftScope, currentDraftId, memoryId]);
  const [toolsDraft, setToolsDraft] = useState<string | null>(null);
  const [dateOpen, setDateOpen] = useState(false);
  const [readersDraft, setReadersDraft] = useState<string | null>(null);
  const toolsOpen = toolsDraft === draftUiKey;
  const readersOpen = readersDraft === draftUiKey;
  const setToolsOpen = useCallback((open: boolean) => setToolsDraft(open ? draftUiKey : null), [draftUiKey]);
  const setReadersOpen = (open: boolean) => setReadersDraft(open ? draftUiKey : null);
  const [originals, setOriginals] = useState<Record<string, LocalCaptureDetail>>({});
  useEffect(() => {
    let active = true;
    void Promise.all((capsuleDraft.draft?.content.items ?? []).map(async item => item.localCaptureRef ? await getLocalCaptureDetail(item.localCaptureRef, draftScope) : null)).then(rows => { if (active) setOriginals(Object.fromEntries(rows.flatMap(row => row ? [[row.captureId, row]] : []))); });
    return () => { active = false; };
  }, [capsuleDraft.draft?.content.items, capsuleDraft.saved, draftScope]);
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
  const continueLibraryDraft = capsuleDraft.continueServer;
  const serverDraftId = target?.kind === "serverDraft" ? target.draftId : null;
  useEffect(() => {
    if (!serverDraftId || !credentials || !identityMatches) return;
    let active = true;
    void requestMobileJson(credentials, `/api/mobile/v1/drafts/${encodeURIComponent(serverDraftId)}`).then(async body => {
      if (active) await continueLibraryDraft(body as import("../drafts/model").Draft, () => active);
    }).catch(e => { if (active) setMessage(e.message); });
    return () => { active = false; };
  }, [serverDraftId, credentials, identityMatches, continueLibraryDraft]);
  useEffect(() => {
    if (capsuleDraft.draft?.status === "published" && capsuleDraft.draft.memoryEventId) {
      exitBySave.current = true;
      navigation.replace("Capture", { scope: draftScope, target: { kind: "memory", memoryId: capsuleDraft.draft.memoryEventId } });
    }
  }, [capsuleDraft.draft?.status, capsuleDraft.draft?.memoryEventId, navigation, draftScope]);
  const sendDraft = async (publish: boolean, intent?: "draft" | "review", organize = false) => {
    if (saveBusy.current) return;
    saveBusy.current = true; setBusy(true);
    try {
      const content = capsuleDraft.draft?.content;
      if (publish && content?.visibility === "members" && content.readerUserIds.length === 0) {
        haptics.warning();
        setMessage("请先选择可以阅读这件事的家人，或改回全家/仅自己。");
        return;
      }
      const saved = await capsuleDraft.save(publish, intent, organize);
      haptics.success();
      await reloadLocal().catch(() => {});
      setMessage("本机已保存，网络工作会在后台继续。");
      const row = saved ?? capsuleDraft.draft;
      if (credentials && family && row) {
        const ids = [row.id, ...row.content.items.flatMap(item => item.localCaptureRef ? [item.localCaptureRef] : [])];
        void grantSyncConsent(syncConsent?.scope === "all" ? "all" : "selected", [...new Set([...(syncConsent?.ids ?? []), ...ids])]).catch(error => setMessage(error.message));
      } else void queued();
      if (row) {
        exitBySave.current = true;
        if (memoryId) {
          const state = navigation.getState();
          const previous = state.routes[state.index - 1];
          if (previous?.name === "SavedMemory" || (previous?.name === "Memory" && previous.params && "id" in previous.params && previous.params.id === memoryId)) navigation.goBack();
          else navigation.replace("Memory", { id: memoryId });
        }
        else if (target?.kind === "local" && target.editSaved) navigation.popTo("SavedMemory", { draftId: row.id, scope: draftScope });
        else navigation.replace("SavedMemory", { draftId: row.id, scope: draftScope });
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : "本机保存失败。"); }
    finally { saveBusy.current = false; setBusy(false); }
  };
  const recorderRef = useRef<AudioRecorder | null>(null);
  const recordedUriRef = useRef<string | null>(null);
  const readRecording = useCallback(() => recorderRef.current?.getStatus(), []);
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
        if (asset.type === "livePhoto" || asset.pairedVideoAsset) {
          if (!asset.pairedVideoAsset) throw new Error("Live Photo 缺少动态组件，请从相册重新选择完整原件。");
          const current = capsuleDraft.draft;
          if (!current || current.status !== "editing") throw new Error("请先打开草稿。");
          if (current.content.items.length > 198) throw new Error("这份草稿已放不下完整 Live Photo，请新建一件事后导入。");
          const components = [asset, asset.pairedVideoAsset];
          const originals = await Promise.all(components.map(async (component, index) => {
            const captureId = index === 0 ? id : Crypto.randomUUID();
            return { id: captureId, itemId: Crypto.randomUUID(), role: index === 0 ? "image" as const : "video" as const, sourceUri: component.uri, payload: await preparePickedMedia(component, captureId, source) };
          }));
          beginPickerReceipt({ version: 2, captureId: id, scope: current.scope, draftId: current.id, expectedRevision: current.revision, ...(memoryId ? { memoryEditTarget: memoryId } : {}), createdAt: new Date().toISOString(), originals });
          let committed = false;
          try {
            for (const o of originals) await preservePreparedMedia(o.sourceUri, o.payload);
            await addOriginals(originals.map(o => ({ id: o.id, payload: o.payload, item: { id: o.itemId, livePhotoGroupId: id, livePhotoRole: o.role } })), { scope: current.scope, id: current.id });
            committed = true;
            success += 2;
          } finally { finishPickerReceipt(id, committed); }
          continue;
        }
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
        : `已添加 ${success} 份照片或视频，原件保存在本机。`,
    );
  }, [captureAccess, finishQueue, addOriginal, addOriginals, capsuleDraft.draft, memoryId]);

  const pickMedia = useCallback(async (mode: "photo" | "video" | "library") => {
    if (!identityMatches || (captureAccess === "readonly" && !memoryId)) {
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
            mediaTypes: ["images", "videos", "livePhotos"],
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
  }, [captureAccess, identityMatches, memoryId, queuePickedAssets]);

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
        // Some file providers label camera/DVD videos as generic binary data.
        // Let them be selected; preservePickedDocument still validates the type.
        type: "*/*",
      });
      if (result.canceled) return;
      let copied = 0;
      let failed = 0;
      let queued = 0;
      for (const [index, asset] of result.assets.entries()) {
        const captureId = Crypto.randomUUID();
        const itemId = Crypto.randomUUID();
        let item: LocalImportIntakeItem;
        try {
          const payload = await preservePickedDocument(asset, captureId, (prepared) => {
            beginPickerReceipt({ sessionId, createdAt, captureId, index, payload: prepared, scope: draftScope, ...(memoryId ? { memoryEditTarget: memoryId, itemId } : {}) });
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
          if (memoryId) {
            if (item.kind === "file" && item.payload && "localUri" in item.payload) {
              await addOriginals([{ id: captureId, payload: item.payload, item: { id: itemId } }], { scope: draftScope, id: memoryId });
              queued += 1; committed = true;
            } else failed += 1;
          } else {
            const saved = await ingestLocalImportSession({ id: sessionId, source: "files", createdAt, items: [item], queue: false, scope: draftScope });
            queued += saved.queued; failed += saved.failed; committed = true;
            if (item.kind === "file" && item.payload && "localUri" in item.payload) await addOriginal(captureId, item.payload, true);
          }
        } finally {
          finishPickerReceipt(captureId, committed);
        }
      }
      if (copied > 0 && currentDraftId && !memoryId) await recordLocalIntakeDraft(sessionId, draftScope, currentDraftId);
      if (queued > 0) await finishQueue();
      setMessage(failed > 0
        ? `已添加 ${copied} 份文件；${failed} 项未能添加。`
        : `已从 Files 复制 ${copied} 份原件，可离线保留。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法从 Files 导入。");
    } finally {
      setBusy(false);
    }
  }, [captureAccess, finishQueue, addOriginal, addOriginals, draftScope, currentDraftId, memoryId]);

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
    let finished = false;
    try {
      if (recording) {
        const recorder = recorderRef.current;
        if (!recorder) throw new Error("录音已中断，请重新开始。");
        if (!recordedUriRef.current) { await recorder.stop(); recordedUriRef.current = recorder.uri; }
        if (!recordedUriRef.current) throw new Error("没有读取到录音文件。");
        const id = Crypto.randomUUID();
        let privateUri: string | null = null;
        try {
          const payload = await preserveRecordedAudio(recordedUriRef.current, id);
          privateUri = payload.localUri;
          await addOriginal(id, payload);
          privateUri = null;
        } catch (error) {
          if (privateUri) removeLocalFile(privateUri);
          throw error;
        }
        finished = true; recordedUriRef.current = null;
        setMessage("录音已保存在本机，可以重听或继续记录。");
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
        setMessage("正在录音，结束时请点“完成录音”。");
      }
    } catch (error) {
      if (recording && recordedUriRef.current) { started = true; setRecording(true); }
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
    return finished;
  };

  const leaving = useRef(false);
  usePreventRemove(true, ({ data }) => {
    if (exitBySave.current) { navigation.dispatch(data.action); return; }
    if (leaving.current) return;
    if (busy || recordingBusyRef.current) { setMessage("正在保存素材，请稍等再返回。"); return; }
    leaving.current = true;
    void (async () => {
      if (recording) {
        const finish = await confirm({ title: "结束录音后返回？", message: "录音会先保存在这条记录中，下次可以继续编辑。", confirmLabel: "结束并保留" });
        if (!finish || !await toggleRecording()) return;
      }
      await capsuleDraft.barrier();
      navigation.dispatch(data.action);
    })().catch(reason => setMessage(reason instanceof Error ? reason.message : "本机暂存失败，请重试后再返回。"))
      .finally(() => { leaving.current = false; });
  });

  useFocusEffect(
    useCallback(() => {
      const intent = route.params?.intent;
      if (!intent || !capsuleDraft.draft?.id) return undefined;
      const timer = setTimeout(() => {
        if (intent === "text") {
          scrollRef.current?.scrollTo({ y: 0, animated: true });
          textInputRef.current?.focus();
        } else if (intent === "audio") {
          setToolsOpen(true);
          scrollRef.current?.scrollTo({ y: actionAreaY.current, animated: true });
          setMessage("录音区域已就绪，点“录音”开始。");
        } else {
          void pickMedia(intent);
        }
        navigation.setParams({ intent: undefined });
      }, 50);
      return () => clearTimeout(timer);
    }, [navigation, pickMedia, route.params?.intent, setToolsOpen, capsuleDraft.draft?.id]),
  );

  const content = capsuleDraft.draft?.content;
  const automaticRequested = captureOrganizerAvailability(aiState.scope === draftScope ? aiState.settings : null, content?.visibility ?? "private", [], "automatic").ready;

  if (!identityMatches || (captureAccess === "readonly" && !memoryId)) {
    return (
      <ScrollView contentContainerStyle={sharedStyles.content} ref={scrollRef} style={[sharedStyles.screen, { paddingTop: insets.top }]}>
        <Button title="返回" variant="ghost" onPress={() => navigation.goBack()} />
        <Text style={sharedStyles.eyebrow}>只读模式</Text>
        <Text style={sharedStyles.title}>记录此刻</Text>
        <View style={[styles.warningCard, { backgroundColor: colors.warningSoft }]}>
          <Text style={{ color: colors.warning, fontSize: journalType.caption }}>{identityMatches ? "当前家庭角色只有查看权限。已有本机记录仍保留。" : "请返回保存这条记录的账号与家庭，再继续编辑。"}</Text>
        </View>
        <View style={sharedStyles.card}>
          <Text style={sharedStyles.cardTitle}>已有本机待传记录</Text>
          <Text style={sharedStyles.body}>{outbox.length > 0 ? `${outbox.length} 份既有记录仍安全保留，权限恢复后可继续同步。` : "没有等待补传的素材。"}</Text>
        </View>
      </ScrollView>
    );
  }

  const visibilityLabel = content?.visibility === "private" ? "仅自己可见" : content?.visibility === "members" ? content.readerUserIds.length ? `指定 ${content.readerUserIds.length} 位家人可见` : "指定成员 · 尚未选择" : "全家可见";
  const editable = capsuleDraft.draft?.status === "editing" && !busy;
  const saveDisabled = busy || recording || !capsuleDraft.draft || !!capsuleDraft.error || (!memoryId && !text.trim() && !content?.title.trim() && !content?.items.length);
  const saveLabel = busy ? "正在保存…" : capsuleDraft.draft?.status === "queued" ? "继续同步" : "保存";
  const ink = colors.ink, muted = colors.muted, rim = colors.line;
  const clear = () => void confirm({ title: capsuleDraft.draft?.savedContent ? "放弃这次补记？" : "清空这次记录？", message: capsuleDraft.draft?.savedContent ? "之前保存的记录和原件仍会保留。" : "原件仍会保留。", confirmLabel: capsuleDraft.draft?.savedContent ? "放弃补记" : "清空", destructive: true })
    .then(async confirmed => {
      if (!confirmed) return;
      const restoringSaved = Boolean(capsuleDraft.draft?.savedContent);
      try { await capsuleDraft.discard(); if (restoringSaved) { exitBySave.current = true; navigation.goBack(); } }
      catch (reason) { setMessage(reason instanceof Error ? reason.message : "暂时无法恢复原记录。"); }
    });

  return (
    <KeyboardAvoidingView style={sharedStyles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView testID="capture-content" style={{ flex: 1 }} automaticallyAdjustKeyboardInsets={false} contentInsetAdjustmentBehavior="never" keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" onScrollBeginDrag={Keyboard.dismiss} contentContainerStyle={[styles.content, { paddingTop: insets.top + journalSpace.medium }]} ref={scrollRef}>
        <View style={styles.headerRow}>
          <Pressable accessibilityRole="button" accessibilityLabel="返回" onPress={() => navigation.goBack()} style={styles.clear}><JournalIcon name="arrow-left" size={22} color={ink} /></Pressable>
          <CollapsingHero compact variant="record" titleTestID="capture-title" title={memoryId || capsuleDraft.draft?.savedContent ? "编辑这一刻" : "记一刻"} style={styles.captureHeading} />
          {(text.trim() || content?.items.length || content?.title) && editable ? <Pressable accessibilityRole="button" accessibilityLabel="清空" disabled={recording || !!capsuleDraft.error} onPress={clear} style={styles.clear}><Text style={{ color: muted }}>清空</Text></Pressable> : null}
        </View>
        <View style={[styles.composer, { borderColor: rim, backgroundColor: colors.card }]}>
          <TextInput testID="capture-text" accessibilityLabel="写下这一刻" multiline editable={editable} maxLength={memoryId ? 100000 : 5000} onChangeText={setText} placeholder="今天，有什么想记住的？" placeholderTextColor={muted} ref={textInputRef} style={[styles.textArea, { color: ink }]} textAlignVertical="top" value={text} />
          {text.length > (memoryId ? 99500 : 4500) ? <Text style={[styles.counter, { color: muted }]}>{text.length} / {memoryId ? 100000 : 5000}</Text> : null}
          <View onLayout={event => { actionAreaY.current = event.nativeEvent.layout.y; }} style={styles.mediaZone}>
            <View style={styles.toolRow}>
            <Pressable accessibilityRole="button" accessibilityLabel="相册" accessibilityHint="添加照片或视频" disabled={!editable || recording} onPress={() => void pickMedia("library")} style={({ pressed }) => [styles.addMedia, { borderColor: rim, backgroundColor: colors.paper }, pressed && sharedStyles.pressed, (!editable || recording) && sharedStyles.disabled]}>
              <JournalIcon name="image" size={20} color={ink} /><Text style={{ color: ink, fontSize: 14 }}>照片</Text>
            </Pressable>
              <Action compact icon="camera" label="拍照" displayLabel="拍摄" hint="直接拍照" disabled={!editable || recording} onPress={() => void pickMedia("photo")} />
              {!recording ? <Action compact icon="microphone" label="录音" hint="留下声音" disabled={!editable} onPress={() => void toggleRecording()} /> : null}
            </View>
              <Pressable accessibilityRole="button" accessibilityLabel="更多素材方式" accessibilityState={{ expanded: toolsOpen }} onPress={() => setToolsOpen(!toolsOpen)} style={styles.toolsToggle}><Text style={{ color: muted }}>录像与文件</Text></Pressable>
            {toolsOpen ? <View style={styles.toolRow}>
              <Action compact icon="video" label="录像" hint="直接录像" disabled={!editable || recording} onPress={() => void pickMedia("video")} />
              <Action compact icon="file" label="文件" hint="添加原件" disabled={!editable || recording} onPress={() => void pickFiles()} />
            </View> : null}
            {recording ? <Button title="完成录音" icon="microphone" disabled={busy} onPress={() => void toggleRecording()} /> : null}
          </View>
          {memoryDraft.memory?.assets.length ? <NativeMediaReader credentials={credentials} assets={memoryDraft.memory.assets} /> : null}
          {content?.items.map((item, index) => {
            const detail = item.localCaptureRef ? originals[item.localCaptureRef] : null;
            const previous = content.items[index - 1];
            const mediaType = (i: typeof item) => i.localCaptureRef ? originals[i.localCaptureRef]?.mediaType : i.assetId && remoteMedia.scope === draftScope ? remoteMedia.assets[i.assetId]?.type : undefined;
            const canPair = previous && !previous.livePhotoGroupId && !item.livePhotoGroupId && mediaType(previous) === "image" && mediaType(item) === "video";
            return <View key={item.id} style={[styles.attachment, { borderColor: rim }]}>
              {detail?.mediaType === "image" && detail.localUri ? <Image source={{ uri: detail.localUri }} accessibilityLabel={item.caption || "这件事的照片"} style={styles.itemImage} resizeMode="contain" /> : null}
              <Text style={{ color: muted, fontSize: 13 }}>{item.preservationState === "missing" ? "原件缺失，请重新添加或移除" : detail?.fileName ?? "已保全的素材"}</Text>
              {item.localCaptureRef ? <Button title="打开原件 / 重听" disabled={recording} variant="ghost" full={false} onPress={() => navigation.navigate("LocalCapture", { captureId: item.localCaptureRef! })} /> : item.assetId && remoteMedia.scope === draftScope && remoteMedia.assets[item.assetId] ? <NativeMediaReader credentials={credentials} assets={[remoteMedia.assets[item.assetId]!]} /> : <Text accessibilityRole="alert" style={sharedStyles.body}>素材尚未读取；请联网重试，或核对读取权限。</Text>}
              {item.livePhotoGroupId && <Text style={{ color: muted, fontSize: 13 }}>Live Photo · {item.livePhotoRole === "image" ? "照片" : "动态原片"}</Text>}
              {mediaType(item) === "image" ? <Button title={content.coverItemId === item.id ? "当前封面" : "设为封面"} variant="ghost" disabled={!editable} onPress={() => changeDraft({ coverItemId: item.id })} /> : null}
              {canPair && <Button title="与上一张照片组成 Live Photo" variant="ghost" disabled={!editable} onPress={() => changeDraft(pairDraftItems(content, previous.id, item.id, Crypto.randomUUID()))} />}
              <Pressable accessibilityRole="button" accessibilityLabel="移除" disabled={!editable} onPress={() => changeDraft(removeDraftItem(content, item.id))} style={styles.clear}><Text style={{ color: muted }}>移除</Text></Pressable>
            </View>;
          })}
          {recording ? <RecordingMeter read={readRecording} /> : null}
          <Text accessibilityLiveRegion="polite" style={[styles.saveState, { color: muted }]}>{capsuleDraft.error ? "草稿暂存遇到问题，请重试" : capsuleDraft.saved ? "草稿已暂存" : "正在暂存…"}</Text>
        </View>
        {busy || (memoryId && !capsuleDraft.draft && !capsuleDraft.error) ? <ActivityIndicator color={muted} /> : null}
        {message ? <Text accessibilityLiveRegion="polite" style={{ color: ink, fontSize: 14 }}>{message}</Text> : null}
        {capsuleDraft.error ? <View accessibilityRole="alert" style={sharedStyles.warning}><Text style={sharedStyles.error}>{capsuleDraft.error}</Text><Action label={memoryId && !capsuleDraft.draft ? "重新读取记录" : "重试本机保存"} hint={memoryId && !capsuleDraft.draft ? "联网后重新核对记录与权限" : "检查磁盘空间后重试"} disabled={busy} onPress={() => void capsuleDraft.retry().catch(e => setMessage(e.message))} /></View> : null}
        {(capsuleDraft.unboundDrafts ?? []).map(row => <Action key={row.id} label={`把本机草稿“${row.content.title || row.content.text.slice(0, 20) || "未命名"}”用于${family?.name ?? "当前家庭"}`} hint="确认原件的目的地，不复制原件" disabled={busy || recording} onPress={() => void capsuleDraft.bind(row.id).catch(e => setMessage(e.message))} />)}
        {content ? <>
          <Pressable accessibilityRole="button" accessibilityLabel="发生时间" accessibilityHint="调整记录日期与精度" disabled={!editable || recording} onPress={() => { Keyboard.dismiss(); setDateOpen(true); }} style={styles.visibility}><Text style={{ color: muted }}>{captureDateSummary(content, capsuleDraft.draft?.captureTimeEdited, recordingTimezone)}</Text><JournalIcon name="chevron-down" size={16} color={muted} /></Pressable>
          <Disclosure title="补充信息">
            {memoryDraft.memory?.assets.some(asset => asset.type === "image") ? <><Text style={sharedStyles.label}>选择已有照片做封面</Text>{memoryDraft.memory.assets.filter(asset => asset.type === "image").map(asset => <Pressable key={asset.id} accessibilityRole="radio" accessibilityLabel={`封面：${asset.filename}`} accessibilityState={{ selected: !memoryDraft.edit?.content.newCoverItemId && memoryDraft.edit?.content.coverAssetId === asset.id, disabled: !editable }} disabled={!editable} onPress={() => memoryDraft.setCoverAsset(asset.id)} style={styles.readerChoice}><Text style={{ color: ink }}>{!memoryDraft.edit?.content.newCoverItemId && memoryDraft.edit?.content.coverAssetId === asset.id ? "当前封面 · " : ""}{asset.filename}</Text></Pressable>)}</> : null}
            <TextInput accessibilityLabel="记录标题" placeholder="标题（可以稍后补充）" value={content.title} onChangeText={title => changeDraft({ title })} editable={editable} maxLength={100} style={sharedStyles.input} />
            <TextInput accessibilityLabel="发生地点" placeholder="地点（可选）" value={content.locationText} onChangeText={locationText => changeDraft({ locationText })} editable={editable} maxLength={200} style={sharedStyles.input} />
            {people?.length ? <><Text style={sharedStyles.label}>在场的家人</Text><View style={styles.readerRow}>{people.map(person => <Pressable key={person.id} accessibilityRole="checkbox" accessibilityState={{ checked: content.participantIds.includes(person.id), disabled: !editable }} disabled={!editable} onPress={() => changeDraft({ participantIds: content.participantIds.includes(person.id) ? content.participantIds.filter(id => id !== person.id) : [...content.participantIds, person.id] })} style={styles.readerChip}><Text style={{ color: colors.ink }}>{content.participantIds.includes(person.id) ? "已选 · " : ""}{person.displayName}</Text></Pressable>)}</View></> : null}
          </Disclosure>
          {!isDraftDateComplete(content) && (!canInferCaptureTime(content) || capsuleDraft.draft?.captureTimeEdited) ? <Button title="标为时间不确定" variant="ghost" disabled={!editable} onPress={() => changeDraft({ occurredAt: null, occurredAtPrecision: "unknown" })} /> : null}
        </> : null}
        {capsuleDraft.draft?.status === "editing" ? <CaptureWritingPrompts key={capsuleDraft.draft.id} text={text} disabled={!editable || recording || !!capsuleDraft.error} onUse={setText} /> : null}
        {capsuleDraft.draft?.status === "queued" ? <Button title="继续编辑" variant="ghost" disabled={busy || recording || syncing} onPress={() => void capsuleDraft.reopen().catch(e => setMessage(e.message))} /> : null}
        {capsuleDraft.draft?.status === "published" ? <>
          <Text style={sharedStyles.body}>{captureSavedMessage(capsuleDraft.draft.processing)}</Text>
          {capsuleDraft.draft.memoryEventId && <Button title="查看这段回忆" onPress={() => navigation.navigate("Memory", { id: capsuleDraft.draft!.memoryEventId! })} />}
          <Button title="记录下一刻" disabled={busy || recording || !!capsuleDraft.error} onPress={() => void capsuleDraft.create().catch(e => setMessage(e.message))} />
        </> : null}
        {capsuleDraft.draft?.memoryEventId && capsuleDraft.draft.organizeOnPublish && <OrganizerPanel kind="memory_event" id={capsuleDraft.draft.memoryEventId} />}
      </ScrollView>
      <View testID="capture-save-bar" style={[styles.saveBar, { marginBottom: keyboardOpen ? 8 : Math.max(insets.bottom, 12), borderColor: rim, backgroundColor: colors.paper }]}>
        <View style={styles.saveTools}>
          <Pressable testID="capture-readers" accessibilityRole="button" accessibilityLabel={`保存后的读者：${visibilityLabel}`} accessibilityHint="更改谁可以阅读这件事" accessibilityState={{ disabled: !editable || recording, expanded: readersOpen }} disabled={!editable || recording} onPress={() => { Keyboard.dismiss(); setReadersOpen(true); }} style={({ pressed }) => [styles.visibility, pressed && sharedStyles.pressed]}>
            <JournalIcon name={content?.visibility === "private" ? "lock" : "users"} size={16} color={muted} /><Text style={{ color: muted, fontSize: journalType.label, flexShrink: 1 }}>{visibilityLabel}</Text><JournalIcon name="chevron-down" size={16} color={muted} />
          </Pressable>
          {keyboardOpen ? <Button title="收起键盘" variant="ghost" full={false} onPress={Keyboard.dismiss} /> : null}
        </View>
        <Button testID="capture-save" title={capsuleDraft.draft?.status === "published" ? "已保存" : saveLabel} accessibilityLabel={saveLabel} icon="check" variant="primary" disabled={saveDisabled || capsuleDraft.draft?.status === "published"} onPress={() => void sendDraft(!credentials || !!viewer?.canEditEvents, credentials && !viewer?.canEditEvents ? content!.visibility === "family" ? "review" : "draft" : undefined, capsuleDraft.draft!.status === "queued" ? capsuleDraft.draft!.organizeOnPublish === true : automaticRequested)} />
      </View>
      <GlassSheet visible={dateOpen} onClose={() => setDateOpen(false)}>
        <Text accessibilityRole="header" style={sharedStyles.cardTitle}>发生时间</Text>
        {content ? <PrecisionDateTimeField occurredAt={content.occurredAt} precision={content.occurredAtPrecision} timezone={recordingTimezone} disabled={!editable} onChange={({ occurredAt, precision }) => changeDraft({ occurredAt, occurredAtPrecision: precision })} /> : null}
        <Button title="完成日期选择" onPress={() => setDateOpen(false)} />
      </GlassSheet>
      <GlassSheet visible={readersOpen} onClose={() => setReadersOpen(false)}>
        <Text accessibilityRole="header" style={sharedStyles.cardTitle}>谁可以阅读这件事</Text>
        <ScrollView style={{ maxHeight: Math.max(160, windowHeight - insets.top - insets.bottom - 200) }} contentContainerStyle={styles.readerSheet} keyboardShouldPersistTaps="handled">
          {content ? <>
            <View style={styles.readerChoices} accessibilityLabel="保存后的读者">
              {([["family", "全家"], ["members", "指定成员"], ["private", "仅自己"]] as const).map(([value, label]) => <Pressable key={value} accessibilityRole="radio" accessibilityState={{ selected: content.visibility === value, disabled: !editable }} disabled={!editable} onPress={() => { changeDraft(value === "members" ? { visibility: value } : { visibility: value, readerUserIds: [] }); if (value !== "members") setReadersOpen(false); }} style={[styles.readerChoice, { borderColor: content.visibility === value ? colors.coral : colors.line, backgroundColor: content.visibility === value ? colors.softCoral : colors.card }]}><Text style={{ color: content.visibility === value ? ink : muted, fontSize: journalType.body, flexShrink: 1 }}>{label}</Text>{content.visibility === value ? <JournalIcon name="check" size={18} color={colors.coral} /> : null}</Pressable>)}
            </View>
            {content.visibility === "members" ? <>
              {content.readerUserIds.length === 0 ? <Text accessibilityRole="alert" style={sharedStyles.body}>请至少选择一位家人，再保存这件事。</Text> : null}
              {readerState.scope === draftScope && readerState.error ? <Text accessibilityRole="alert" style={sharedStyles.body}>{readerState.error}</Text> : null}
              {!credentials ? <Text style={sharedStyles.body}>连接家庭后可以选择登录成员；没有账号的人物仍可参与这件事。</Text> : null}
              {credentials ? <Button title="重新核对成员" variant="ghost" onPress={() => setReaderRefresh(value => value + 1)} /> : null}
              <View style={styles.readerRow}>
                {readers.map(member => {
                  const checked = content.readerUserIds.includes(member.id);
                  return <Pressable key={member.id} accessibilityRole="checkbox" accessibilityState={{ checked, disabled: !editable }} disabled={!editable} onPress={() => changeDraft({ readerUserIds: checked ? content.readerUserIds.filter(id => id !== member.id) : [...content.readerUserIds, member.id] })} style={styles.readerChip}><Text style={{ color: ink }}>{checked ? `已选 · ${member.name}` : member.name}</Text></Pressable>;
                })}
                {content.readerUserIds.filter(id => !readers.some(member => member.id === id)).map(id => <Pressable key={id} accessibilityRole="checkbox" accessibilityState={{ checked: true, disabled: !editable }} disabled={!editable} onPress={() => changeDraft({ readerUserIds: content.readerUserIds.filter(readerId => readerId !== id) })} style={styles.readerChip}><Text style={{ color: ink }}>已选成员（待联网核对，点按移除）</Text></Pressable>)}
              </View>
            </> : null}
          </> : null}
        </ScrollView>
        <Button title="完成选择" onPress={() => setReadersOpen(false)} />
      </GlassSheet>
    </KeyboardAvoidingView>
  );
}

function Action({ label, displayLabel, hint, onPress, disabled, primary = false, compact = false, icon }: { label: string; displayLabel?: string; hint: string; onPress: () => void; disabled: boolean; primary?: boolean; compact?: boolean; icon?: "camera" | "video" | "microphone" | "file" }) {
  const { colors } = useColorTheme();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityHint={hint} disabled={disabled} onPress={onPress} style={({ pressed }) => [compact ? styles.tool : styles.action, pressed && sharedStyles.pressed, disabled && sharedStyles.disabled]}>{icon ? <JournalIcon name={icon} color={primary ? colors.coral : colors.muted} size={18} /> : null}<Text style={{ color: colors.muted, fontSize: 13 }}>{displayLabel ?? label}</Text>{!compact ? <Text style={{ color: colors.muted, fontSize: 13 }}>{hint}</Text> : null}</Pressable>;
}

const styles = StyleSheet.create({
  content: { padding: journalSpace.page, gap: journalSpace.medium },
  headerRow: { flexDirection: "row", alignItems: "center", gap: journalSpace.small, paddingHorizontal: 6, paddingBottom: 8 },
  captureHeading: { flex: 1, paddingBottom: 0, borderBottomWidth: 0 },
  composer: { paddingVertical: 8, overflow: "hidden", gap: 12 },
  textArea: { minHeight: 176, fontSize: journalType.body, lineHeight: 28, paddingTop: 0 },
  counter: { fontSize: 12, textAlign: "right" },
  mediaZone: { gap: 10 },
  addMedia: { flexGrow: 1, minHeight: 48, flexDirection: "row", alignItems: "center", gap: 9, borderWidth: 1, borderRadius: journalRadius.control, paddingHorizontal: 16 },
  toolsToggle: { minHeight: 44, maxWidth: "100%", flexDirection: "row", alignItems: "center", gap: journalSpace.small, alignSelf: "flex-start" },
  toolRow: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  tool: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingHorizontal: 12, flexGrow: 1 },
  clear: { minHeight: 44, justifyContent: "center", alignSelf: "flex-start", paddingHorizontal: 8 },
  saveState: { fontSize: 12 },
  attachment: { borderWidth: 1, borderRadius: 18, padding: 10, gap: 6 },
  itemImage: { width: "100%", height: 180, borderRadius: 12 },
  dateNote: { fontSize: 12, textAlign: "center" },
  readerSheet: { gap: journalSpace.medium, paddingVertical: journalSpace.medium },
  readerChoices: { gap: journalSpace.small },
  readerChoice: { minHeight: 48, borderWidth: 1, borderRadius: journalRadius.control, padding: journalSpace.medium, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: journalSpace.small },
  readerRow: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 4 },
  readerChip: { minHeight: 44, maxWidth: "100%", justifyContent: "center", borderWidth: 1, borderColor: "transparent", paddingHorizontal: 12, borderRadius: 24 },
  saveBar: { marginHorizontal: 20, marginTop: 8, borderTopWidth: 1, paddingTop: 10, gap: 8 },
  saveTools: { flexDirection: "row", alignItems: "center", justifyContent: "center", flexWrap: "wrap", columnGap: 16 },
  visibility: { minHeight: 44, paddingHorizontal: journalSpace.small, flexDirection: "row", alignItems: "center", justifyContent: "center", flexShrink: 1, gap: 6 },
  saveButton: { minHeight: 56, borderRadius: 28, borderWidth: 1, overflow: "hidden", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  saveLabel: { fontSize: 16, fontWeight: "600" },
  warningCard: { borderRadius: journalRadius.control, padding: 12, gap: 6 },
  action: { minHeight: 48, justifyContent: "center", gap: 4, padding: 8 },
});
