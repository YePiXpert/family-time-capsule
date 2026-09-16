import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  AppState,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  View,
} from "react-native";
import { usePreventRemove } from "@react-navigation/native";
import DateTimePicker from "@react-native-community/datetimepicker";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import {
  AudioModule,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  type AudioRecorder,
} from "expo-audio";
import { File, Paths } from "expo-file-system";
import { useLibrary, useStore } from "./context";
import {
  clone,
  saveRecord,
  type RecordContent,
  type RecordDraft,
  type LocalMedia,
} from "./model";
import { newId, now, updateDraft } from "./services";
import { preserveMedia, verifyMedia } from "./files";
import type { Props } from "./navigation";
import {
  Button,
  ErrorText,
  Field,
  Page,
  Text,
  dateLabel,
  messageOf,
  useStyles,
} from "./ui";
import { Photo } from "./Media";
export function Editor({ route, navigation }: Props<"Editor">) {
  const store = useStore(),
    state = useLibrary(),
    s = useStyles();
  const [draft, setDraft] = useState<RecordDraft | undefined>(() =>
    clone(store.get().drafts[route.params.draftId]),
  );
  const current = useRef(draft),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [details, setDetails] = useState(false),
    [dateOpen, setDateOpen] = useState(false),
    [recording, setRecording] = useState(false),
    [allowExit, setAllowExit] = useState(false);
  const pendingMedia = useRef<Record<string, LocalMedia>>({});
  const recorder = useRef<AudioRecorder | null>(null),
    nextAction = useRef<(() => void) | null>(null),
    pending = useRef<Promise<unknown>>(Promise.resolve()),
    operation = useRef(false);
  const persist = useCallback(
    (next: RecordDraft, media: LocalMedia[] = []) => {
      current.current = next;
      setDraft(next);
      for (const m of media) pendingMedia.current[m.id] = m;
      const originals = Object.values(pendingMedia.current);
      const job = store.change((s) => {
        for (const m of originals) s.media[m.id] = m;
        updateDraft(s, next);
      });
      pending.current = job;
      void job.catch((e) => setError(messageOf(e)));
      return job;
    },
    [store],
  );
  const flush = useCallback(async () => {
    if (current.current)
      await persist({ ...current.current, updatedAt: now() });
  }, [persist]);
  const change = (patch: Partial<RecordContent>) => {
    if (!current.current) return;
    void persist({
      ...current.current,
      content: { ...current.current.content, ...patch },
      updatedAt: now(),
    });
  };
  const run = async (fn: () => Promise<void>) => {
    if (operation.current) return;
    operation.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      operation.current = false;
      setBusy(false);
    }
  };
  const attach = async (media: LocalMedia[]) => {
    const d = current.current;
    if (!d) return;
    await persist(
      {
        ...d,
        content: {
          ...d.content,
          mediaIds: [...d.content.mediaIds, ...media.map((m) => m.id)],
          coverId:
            d.content.coverId ??
            media.find((m) => m.kind === "image")?.id ??
            null,
        },
        updatedAt: now(),
      },
      media,
    );
  };
  const finishAudio = async () => {
    if (recorder.current) {
      await recorder.current.stop();
      recorder.current.release();
      recorder.current = null;
      setRecording(false);
      await setAudioModeAsync({ allowsRecording: false });
    }
    const d = current.current;
    if (!d?.recordingFile) return;
    const f = new File(Paths.document, d.recordingFile);
    if (!f.exists || !f.size)
      throw new Error("录音未形成可读取的文件，可以明确放弃后继续编辑。");
    const media = await preserveMedia(f.uri, "录音.m4a", "audio");
    const next = {
      ...current.current!,
      content: {
        ...current.current!.content,
        mediaIds: [...current.current!.content.mediaIds, media.id],
      },
    };
    delete next.recordingFile;
    await persist(next, [media]);
  };
  const finishRef = useRef(finishAudio);
  useEffect(() => {
    finishRef.current = finishAudio;
  });
  useEffect(() => {
    const sub = AppState.addEventListener("change", (status) => {
      if (status !== "active") {
        void (async () => {
          if (recorder.current) await finishRef.current();
          await flush();
        })().catch((e) => setError(messageOf(e)));
      }
    });
    return () => sub.remove();
  }, [flush]);
  useEffect(
    () => () => {
      recorder.current?.release();
    },
    [],
  );
  useEffect(() => {
    if (allowExit) {
      const action = nextAction.current;
      nextAction.current = null;
      action?.();
    }
  }, [allowExit]);
  const leave = async (action: () => void) => {
    await flush();
    nextAction.current = action;
    setAllowExit(true);
  };
  const discardAudio = async () => {
    if (recorder.current) {
      await recorder.current.stop();
      recorder.current.release();
      recorder.current = null;
      setRecording(false);
    }
    const d = current.current;
    if (d) {
      const next = { ...d };
      delete next.recordingFile;
      await persist(next);
    }
    await setAudioModeAsync({ allowsRecording: false });
  };
  usePreventRemove(!allowExit, ({ data }) => {
    if (operation.current) return;
    const exit = () => navigation.dispatch(data.action);
    if (current.current?.recordingFile)
      Alert.alert("保存这段录音？", "结束并保存后返回，或明确放弃本段录音。", [
        { text: "继续编辑", style: "cancel" },
        {
          text: "放弃录音",
          style: "destructive",
          onPress: () => {
            void run(async () => {
              await discardAudio();
              await leave(exit);
            });
          },
        },
        {
          text: "结束并保存",
          onPress: () => {
            void run(async () => {
              await finishAudio();
              await leave(exit);
            });
          },
        },
      ]);
    else void run(() => leave(exit));
  });
  if (!draft)
    return (
      <Page>
        <Text>这份草稿已经关闭。</Text>
      </Page>
    );
  const pick = async (camera: boolean) => {
    await flush();
    const permission = camera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted)
      throw new Error(
        camera ? "请在系统设置中允许拍摄。" : "请在系统设置中允许选择照片。",
      );
    const result = camera
      ? await ImagePicker.launchCameraAsync({
          mediaTypes: ["images", "videos"],
          quality: 1,
        })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ["images", "videos"],
          allowsMultipleSelection: true,
          quality: 1,
        });
    if (result.canceled) return;
    for (const asset of result.assets)
      await attach([
        await preserveMedia(
          asset.uri,
          asset.fileName ?? (asset.type === "video" ? "视频.mp4" : "照片.jpg"),
          asset.type === "video" ? "video" : "image",
        ),
      ]);
  };
  return (
    <Page scroll={false}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={100}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={s.content}
          automaticallyAdjustKeyboardInsets
        >
          <View style={s.between}>
            <Text style={s.title}>
              {draft.recordId ? "编辑这一刻" : "记下这一刻"}
            </Text>
            <Button
              title={dateLabel(draft.content.date)}
              icon="calendar"
              onPress={() => setDateOpen(!dateOpen)}
            />
          </View>
          {dateOpen && (
            <>
              <DateTimePicker
                value={new Date(draft.content.date)}
                mode="date"
                display={Platform.OS === "ios" ? "spinner" : "default"}
                onChange={(_, date) => {
                  if (Platform.OS !== "ios") setDateOpen(false);
                  if (date) change({ date: date.toISOString() });
                }}
              />
              {Platform.OS === "ios" && (
                <Button title="日期选好了" onPress={() => setDateOpen(false)} />
              )}
            </>
          )}
          <Field
            label="这一刻发生了什么"
            testID="capture-text"
            multiline
            placeholder="今天，你又带来了什么小惊喜？"
            value={draft.content.text}
            onChangeText={(text) => change({ text })}
            style={{ minHeight: 160, textAlignVertical: "top" }}
          />
          <View style={s.row}>
            <Button
              title="照片"
              icon="image"
              disabled={busy || recording}
              onPress={() => {
                void run(() => pick(false));
              }}
            />
            <Button
              title="拍摄"
              icon="camera"
              disabled={busy || recording}
              onPress={() => {
                void run(() => pick(true));
              }}
            />
            <Button
              title={recording ? "完成录音" : "录音"}
              icon="microphone"
              disabled={busy}
              onPress={() => {
                void run(async () => {
                  if (current.current?.recordingFile) {
                    await finishAudio();
                    return;
                  }
                  const permission = await requestRecordingPermissionsAsync();
                  if (!permission.granted)
                    throw new Error("请在系统设置中允许使用麦克风。");
                  await setAudioModeAsync({
                    allowsRecording: true,
                    playsInSilentMode: true,
                    shouldPlayInBackground: false,
                  });
                  // eslint-disable-next-line import/namespace
                  const audio = new AudioModule.AudioRecorder({
                    ...RecordingPresets.HIGH_QUALITY,
                    directory: "document",
                  });
                  recorder.current = audio;
                  try {
                    await audio.prepareToRecordAsync();
                    const uri = audio.uri;
                    const base = Paths.document.uri.replace(/\/$/, "") + "/";
                    if (!uri?.startsWith(base))
                      throw new Error("录音保存位置不可用。");
                    await persist({
                      ...current.current!,
                      recordingFile: uri.slice(base.length),
                    });
                    audio.record();
                    setRecording(true);
                  } catch (e) {
                    audio.release();
                    recorder.current = null;
                    await setAudioModeAsync({ allowsRecording: false });
                    throw e;
                  }
                });
              }}
            />
          </View>
          {draft.recordingFile && (
            <View style={s.section}>
              <Text>
                {recording
                  ? "正在录音，离开前请结束并保存。"
                  : "有一段未完成的录音"}
              </Text>
              <Button
                title="恢复并保存录音"
                disabled={busy}
                onPress={() => {
                  void run(finishAudio);
                }}
              />
              <Button
                title="放弃这段录音"
                disabled={busy}
                onPress={() =>
                  Alert.alert("放弃录音？", "这段录音将不加入记录。", [
                    { text: "取消", style: "cancel" },
                    {
                      text: "放弃",
                      style: "destructive",
                      onPress: () => {
                        void run(discardAudio);
                      },
                    },
                  ])
                }
              />
            </View>
          )}
          {draft.content.mediaIds.map((id) => {
            const m = state.media[id];
            return m ? (
              <View key={id} style={{ gap: 8 }}>
                {m.kind === "image" ? (
                  <Photo media={m} />
                ) : (
                  <Text>{m.name}</Text>
                )}
                <View style={s.row}>
                  <Button
                    title="查看"
                    onPress={() => navigation.navigate("Media", { id })}
                  />
                  {m.kind === "image" && (
                    <Button
                      title={
                        draft.content.coverId === id ? "当前封面" : "设为封面"
                      }
                      selected={draft.content.coverId === id}
                      onPress={() => change({ coverId: id })}
                    />
                  )}
                  <Button
                    title="移除"
                    onPress={() =>
                      change({
                        mediaIds: draft.content.mediaIds.filter(
                          (x) => x !== id,
                        ),
                        coverId:
                          draft.content.coverId === id
                            ? null
                            : draft.content.coverId,
                      })
                    }
                  />
                </View>
              </View>
            ) : null;
          })}
          <Button
            title={details ? "收起补充信息" : "补充标题、地点"}
            onPress={() => setDetails(!details)}
          />
          {details && (
            <>
              <Field
                label="标题（可选）"
                value={draft.content.title}
                onChangeText={(title) => change({ title })}
              />
              <Field
                label="地点（可选）"
                value={draft.content.location}
                onChangeText={(location) => change({ location })}
              />
              <Button
                title="从文件添加素材"
                icon="file"
                disabled={busy || recording}
                onPress={() => {
                  void run(async () => {
                    const r = await DocumentPicker.getDocumentAsync({
                      multiple: true,
                      copyToCacheDirectory: true,
                      type: [
                        "image/*",
                        "video/*",
                        "audio/*",
                        "application/pdf",
                        "text/plain",
                      ],
                    });
                    if (!r.canceled)
                      for (const a of r.assets)
                        await attach([
                          await preserveMedia(
                            a.uri,
                            a.name,
                            a.mimeType?.startsWith("image/")
                              ? "image"
                              : a.mimeType?.startsWith("video/")
                                ? "video"
                                : a.mimeType?.startsWith("audio/")
                                  ? "audio"
                                  : "document",
                          ),
                        ]);
                  });
                }}
              />
            </>
          )}
          <ErrorText message={error} />
          {error && (
            <Button
              title="重试暂存"
              onPress={() => {
                void run(flush);
              }}
              disabled={busy}
            />
          )}
          <Button
            title="放弃这份草稿"
            disabled={busy}
            onPress={() =>
              Alert.alert(
                "放弃草稿？",
                draft.recordId
                  ? "原先保存的记录不会改变。"
                  : "这份未保存的记录将被删除。",
                [
                  { text: "取消", style: "cancel" },
                  {
                    text: "放弃",
                    style: "destructive",
                    onPress: () => {
                      void run(async () => {
                        await discardAudio();
                        await store.change((s) => {
                          delete s.drafts[draft.id];
                        });
                        nextAction.current = () => navigation.goBack();
                        setAllowExit(true);
                      });
                    },
                  },
                ],
              )
            }
          />
        </ScrollView>
        <View style={{ padding: 16 }}>
          <Button
            title={busy ? "正在保存…" : "保存这一刻"}
            primary
            testID="capture-save"
            disabled={busy}
            onPress={() => {
              void run(async () => {
                if (current.current?.recordingFile) await finishAudio();
                await flush();
                for (const id of current.current!.content.mediaIds) {
                  const media = store.get().media[id];
                  if (!media) throw new Error("素材尚未写入，请重试。");
                  await verifyMedia(media);
                }
                const record = await store.change((s) =>
                  saveRecord(s, draft.id, newId(), now()),
                );
                nextAction.current = () =>
                  navigation.replace("Record", { id: record.id });
                setAllowExit(true);
              });
            }}
          />
        </View>
      </KeyboardAvoidingView>
    </Page>
  );
}
