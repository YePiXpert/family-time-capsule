import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
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
import { enqueueMediaCapture, enqueueTextCapture, ingestLocalImportSession } from "../storage/database";
import { preservePickedDocument, preservePickedMedia, preserveRecordedAudio, removeLocalFile } from "../storage/files";
import { beginPickerReceipt, finishPickerReceipt } from "../native/picker-intake";
import { colors, sharedStyles } from "../theme";
import type { LocalImportIntakeItem, MediaCapturePayload } from "../types";
import { resolveNativeCaptureAccess } from "../authz/product-access";
import type { AppNavigation, MainTabParamList } from "../navigation/types";

export function CaptureScreen() {
  const navigation = useNavigation<AppNavigation>();
  const route = useRoute<RouteProp<MainTabParamList, "Capture">>();
  const { credentials, outbox, queued, viewer } = useApp();
  const captureAccess = resolveNativeCaptureAccess(Boolean(credentials), viewer);
  const recorderRef = useRef<AudioRecorder | null>(null);
  const mountedRef = useRef(false);
  const recordingBusyRef = useRef(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
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
    if (captureAccess === "readonly") {
      setMessage("当前家庭角色只有查看权限，未创建本机待传记录。");
      return;
    }
    const value = text.trim();
    if (!value || value.length > 5000) {
      setMessage("请输入 1–5000 字。");
      return;
    }
    setBusy(true);
    try {
      await enqueueTextCapture(Crypto.randomUUID(), { text: value });
      setText("");
      setMessage(credentials ? "文字已保存到本机，并将送往收件箱。" : "文字已保存到本机，可稍后连接服务器。");
      await finishQueue();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法保存文字。");
    } finally {
      setBusy(false);
    }
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
        await enqueueMediaCapture(id, payload);
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
  }, [captureAccess, finishQueue]);

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
      setMessage(error instanceof Error ? error.message : "无法保存所选素材。");
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
            beginPickerReceipt({ sessionId, createdAt, captureId, index, payload: prepared });
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
          const saved = await ingestLocalImportSession({ id: sessionId, source: "files", createdAt, items: [item], queue: true });
          queued += saved.queued;
          failed += saved.failed;
          committed = true;
        } finally {
          finishPickerReceipt(captureId, committed);
        }
      }
      if (queued > 0) await finishQueue();
      setMessage(failed > 0
        ? `已把 ${copied} 份原件复制到 App 私有目录；${failed} 项失败。`
        : `已从 Files 复制 ${copied} 份原件，可离线保留。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法从 Files 导入。");
    } finally {
      setBusy(false);
    }
  }, [captureAccess, finishQueue]);

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
          await enqueueMediaCapture(id, payload);
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
      <Text style={sharedStyles.title}>记录此刻</Text>
      <Text style={sharedStyles.intro}>每一份文字和原件都先写入设备。同步失败不会删除本机内容。</Text>
      <View style={sharedStyles.card}>
        <Text style={sharedStyles.label}>一句话、一段故事</Text>
        <TextInput multiline onChangeText={setText} placeholder="今天发生了什么？" ref={textInputRef} style={[sharedStyles.input, styles.textArea]} textAlignVertical="top" value={text} />
        <Text style={styles.counter}>{text.length} / 5000</Text>
        <Pressable disabled={busy || recording} onPress={() => void saveText()} style={({ pressed }) => [sharedStyles.primaryButton, pressed && sharedStyles.pressed, (busy || recording) && sharedStyles.disabled]}>
          <Text style={sharedStyles.primaryText}>保存文字</Text>
        </Pressable>
      </View>

      <View onLayout={(event) => { actionAreaY.current = event.nativeEvent.layout.y; }} style={styles.actionGrid}>
        <Action label="拍照片" hint="保留原图" disabled={busy || recording} onPress={() => void pickMedia("photo")} />
        <Action label="拍视频" hint="保留原片" disabled={busy || recording} onPress={() => void pickMedia("video")} />
        <Action label={recording ? "完成录音" : "直接录音"} hint={recording ? "保存原声" : "麦克风"} disabled={busy} primary={recording} onPress={() => void toggleRecording()} />
        <Action label="从相册导入" hint="可多选" disabled={busy || recording} onPress={() => void pickMedia("library")} />
        <Action label="从 Files 导入" hint="文档与录音" disabled={busy || recording} onPress={() => void pickFiles()} />
      </View>
      {busy ? <ActivityIndicator color={colors.coral} /> : null}
      {message ? <View style={sharedStyles.notice}><Text style={sharedStyles.noticeText}>{message}</Text></View> : null}

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
