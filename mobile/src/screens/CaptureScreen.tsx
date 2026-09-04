import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import * as Crypto from "expo-crypto";
import * as ImagePicker from "expo-image-picker";
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
} from "expo-audio";
import { useApp } from "../state/AppContext";
import { enqueueMediaCapture, enqueueTextCapture } from "../storage/database";
import { preservePickedMedia, preserveRecordedAudio, removeLocalFile } from "../storage/files";
import { colors, sharedStyles } from "../theme";
import type { MediaCapturePayload } from "../types";
import { resolveNativeCaptureAccess } from "../authz/product-access";

export function CaptureScreen() {
  const { credentials, outbox, queued, viewer } = useApp();
  const captureAccess = resolveNativeCaptureAccess(Boolean(credentials), viewer);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const finishQueue = async () => {
    try {
      await queued();
    } catch {
      setMessage("已安全保存到本机；状态暂未刷新，重启后仍会保留。");
    }
  };

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

  const queuePickedAssets = async (
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
  };

  const pickMedia = async (mode: "photo" | "video" | "library") => {
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
  };

  const toggleRecording = async () => {
    if (captureAccess === "readonly") {
      setMessage("当前家庭角色只有查看权限，未创建本机待传记录。");
      return;
    }
    if (recording) {
      setBusy(true);
      try {
        await recorder.stop();
        setRecording(false);
        await setAudioModeAsync({
          allowsRecording: false,
          playsInSilentMode: true,
          interruptionMode: "doNotMix",
          shouldPlayInBackground: false,
          shouldRouteThroughEarpiece: false,
        });
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
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "无法保存录音。");
      } finally {
        setBusy(false);
      }
      return;
    }
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) throw new Error("需要麦克风权限才能直接录音。");
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
        interruptionMode: "doNotMix",
        shouldPlayInBackground: false,
        shouldRouteThroughEarpiece: false,
      });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setRecording(true);
      setMessage("正在录音，点“完成录音”后才会写入私有目录。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法开始录音。");
    }
  };

  if (captureAccess === "readonly") {
    return (
      <ScrollView contentContainerStyle={sharedStyles.content} style={sharedStyles.screen}>
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
    <ScrollView contentContainerStyle={sharedStyles.content} style={sharedStyles.screen}>
      <Text style={sharedStyles.eyebrow}>离线也不会丢</Text>
      <Text style={sharedStyles.title}>记录此刻</Text>
      <Text style={sharedStyles.intro}>每一份文字和原件都先写入设备。同步失败不会删除本机内容。</Text>
      <View style={sharedStyles.card}>
        <Text style={sharedStyles.label}>一句话、一段故事</Text>
        <TextInput multiline onChangeText={setText} placeholder="今天发生了什么？" style={[sharedStyles.input, styles.textArea]} textAlignVertical="top" value={text} />
        <Text style={styles.counter}>{text.length} / 5000</Text>
        <Pressable disabled={busy || recording} onPress={() => void saveText()} style={({ pressed }) => [sharedStyles.primaryButton, pressed && sharedStyles.pressed, (busy || recording) && sharedStyles.disabled]}>
          <Text style={sharedStyles.primaryText}>保存文字</Text>
        </Pressable>
      </View>

      <View style={styles.actionGrid}>
        <Action label="拍照片" hint="保留原图" disabled={busy || recording} onPress={() => void pickMedia("photo")} />
        <Action label="拍视频" hint="保留原片" disabled={busy || recording} onPress={() => void pickMedia("video")} />
        <Action label={recording ? "完成录音" : "直接录音"} hint={recording ? "保存原声" : "麦克风"} disabled={busy} primary={recording} onPress={() => void toggleRecording()} />
        <Action label="从相册导入" hint="可多选" disabled={busy || recording} onPress={() => void pickMedia("library")} />
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
