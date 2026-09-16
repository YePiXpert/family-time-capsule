import { AIEditor } from "../ai/Editor";
import { proposalEvents } from "../ai/state";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  AppState,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
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
  useTheme,
} from "./ui";
import { Photo, PhotoDetails } from "./Media";
import {
  applyPhotoMetadata,
  readPhotoMetadata,
  photoDayGroups,
  savePhotoDays,
  movePhotoToEvent,
} from "./photo-metadata";
export function Editor({ route, navigation }: Props<"Editor">) {
  const store = useStore(),
    state = useLibrary(),
    s = useStyles(),
    { colors } = useTheme();
  const [draft, setDraft] = useState<RecordDraft | undefined>(() =>
    clone(store.get().drafts[route.params.draftId]),
  );
  const current = useRef(draft),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [details, setDetails] = useState(false),
    [dateOpen, setDateOpen] = useState(false),
    [movingPhoto, setMovingPhoto] = useState<string | null>(null),
    [eventDate, setEventDate] = useState<number | null>(null),
    [recording, setRecording] = useState(false),
    [allowExit, setAllowExit] = useState(false);
  const pendingMedia = useRef<Record<string, LocalMedia>>({});
  const [importedMedia, setImportedMedia] = useState<
    Record<string, LocalMedia>
  >({});
  const recorder = useRef<AudioRecorder | null>(null),
    nextAction = useRef<(() => void) | null>(null),
    pending = useRef<Promise<unknown>>(Promise.resolve()),
    operation = useRef(false);
  const persist = useCallback(
    (next: RecordDraft, media: LocalMedia[] = []) => {
      current.current = next;
      setDraft(next);
      for (const m of media) pendingMedia.current[m.id] = m;
      if (media.length) setImportedMedia({ ...pendingMedia.current });
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
      ...(patch.date !== undefined
        ? { autoDate: false, groupPhotosByDay: !!current.current.photoEvents }
        : {}),
      ...(patch.location !== undefined
        ? { autoLocation: false, manualLocation: true }
        : {}),
      ...(patch.coverId && current.current.photoEvents
        ? {
            photoEvents: current.current.photoEvents.map((event) =>
              event.mediaIds.includes(patch.coverId!)
                ? { ...event, coverId: patch.coverId! }
                : event,
            ),
          }
        : {}),
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
    if (!current.current) return;
    const d = media.reduce(
      (next, item) => applyPhotoMetadata(next, item.photoMetadata),
      current.current,
    );
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
  const finishJob = useRef<Promise<void> | null>(null);
  const finishAudioImpl = async () => {
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
  const finishAudio = () => {
    if (finishJob.current) return finishJob.current;
    const job = finishAudioImpl().finally(() => {
      finishJob.current = null;
    });
    finishJob.current = job;
    return job;
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
          exif: true,
        })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ["images", "videos"],
          allowsMultipleSelection: true,
          orderedSelection: true,
          quality: 1,
          exif: true,
        });
    if (result.canceled) return;
    for (const asset of result.assets) {
      const media = await preserveMedia(
        asset.uri,
        asset.fileName ?? (asset.type === "video" ? "视频.mp4" : "照片.jpg"),
        asset.type === "video" ? "video" : "image",
      );
      if (media.kind === "image")
        media.photoMetadata = readPhotoMetadata(asset.exif);
      await attach([media]);
    }
  };
  const dayGroups = photoDayGroups(draft, { ...state.media, ...importedMedia });
  const editEvent = (index: number, patch: Partial<RecordContent>) => {
    const events = photoDayGroups(current.current!, {
      ...store.get().media,
      ...pendingMedia.current,
    });
    events[index] = { ...events[index]!, ...patch };
    void persist({
      ...current.current!,
      photoEvents: events,
      updatedAt: now(),
    });
  };
  const moveToEvent = (id: string, target: number | "new") => {
    const events = photoDayGroups(current.current!, {
      ...store.get().media,
      ...pendingMedia.current,
    });
    void persist({
      ...current.current!,
      photoEvents: movePhotoToEvent(events, id, target, {
        ...store.get().media,
        ...pendingMedia.current,
      }),
      updatedAt: now(),
    });
    setMovingPhoto(null);
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
              disabled={
                !!draft.groupPhotosByDay && draft.content.mediaIds.length > 0
              }
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
          {!draft.recordId && draft.content.mediaIds.length > 0 && (
            <View style={s.section}>
              <Button
                title={
                  draft.photoEvents
                    ? "已按事情分组"
                    : draft.groupPhotosByDay
                      ? "按拍摄日期建议分组：已开启"
                      : "按拍摄日期建议分组：已关闭"
                }
                selected={!!draft.groupPhotosByDay}
                disabled={busy || !!draft.photoEvents}
                onPress={() => {
                  void persist({
                    ...current.current!,
                    groupPhotosByDay: !draft.groupPhotosByDay,
                    updatedAt: now(),
                  });
                }}
              />
              {draft.groupPhotosByDay && (
                <>
                  <Text style={s.muted}>
                    将保存 {dayGroups.length}{" "}
                    条记录。同一天也可以分开记，在照片下选择「调整归属」。不会合并已有记录。
                  </Text>
                  <Text style={s.muted}>
                    没有拍摄时间的素材单独成组，日期可修改。
                  </Text>
                  {dayGroups.map((group, index) => (
                    <View key={index} style={s.section}>
                      <Text>
                        事情 {index + 1} · {group.mediaIds.length} 份素材
                      </Text>
                      <Button
                        title={dateLabel(group.date)}
                        icon="calendar"
                        onPress={() =>
                          setEventDate(eventDate === index ? null : index)
                        }
                      />
                      {eventDate === index && (
                        <DateTimePicker
                          value={new Date(group.date)}
                          mode="date"
                          onChange={(_, date) => {
                            setEventDate(null);
                            if (date)
                              editEvent(index, { date: date.toISOString() });
                          }}
                        />
                      )}
                      <Field
                        label="这件事的标题"
                        value={group.title}
                        editable={!busy}
                        onChangeText={(title) => editEvent(index, { title })}
                      />
                      <Field
                        label="这件事发生了什么"
                        value={group.text}
                        multiline
                        editable={!busy}
                        onChangeText={(text) => editEvent(index, { text })}
                      />
                      <Field
                        label="这件事的地点"
                        value={group.location}
                        editable={!busy}
                        onChangeText={(location) =>
                          editEvent(index, { location })
                        }
                      />
                    </View>
                  ))}
                </>
              )}
            </View>
          )}
          {!(draft.groupPhotosByDay && draft.content.mediaIds.length > 0) && (
            <Field
              label="这一刻发生了什么"
              testID="capture-text"
              editable={!busy}
              multiline
              placeholder="今天，你又带来了什么小惊喜？"
              value={draft.content.text}
              onChangeText={(text) => change({ text })}
              style={{ minHeight: 160, textAlignVertical: "top" }}
            />
          )}
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
                    ...(Platform.OS === "ios"
                      ? RecordingPresets.HIGH_QUALITY.ios
                      : RecordingPresets.HIGH_QUALITY.android),
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
          {draft.content.mediaIds.some(
            (id) => (state.media[id] ?? importedMedia[id])?.kind === "image",
          ) && (
            <AIEditor
              draft={draft}
              media={{ ...state.media, ...importedMedia }}
              disabled={busy || recording}
              onPatch={(patch) =>
                persist({ ...current.current!, ...patch, updatedAt: now() })
              }
              onApply={async (proposal, part) => {
                const accepted =
                  part === "title"
                    ? { ...proposal, text: undefined }
                    : part === "text"
                      ? { ...proposal, title: undefined }
                      : proposal;
                const d = current.current!;
                const events = proposalEvents(
                  d,
                  { ...store.get().media, ...pendingMedia.current },
                  accepted,
                );
                await persist({
                  ...d,
                  ...(d.recordId
                    ? { content: events[0]! }
                    : { photoEvents: events, groupPhotosByDay: true }),
                  aiProposal: undefined,
                  aiJob: undefined,
                  updatedAt: now(),
                });
              }}
            />
          )}
          {draft.content.mediaIds.map((id) => {
            const m = state.media[id] ?? importedMedia[id];
            return m ? (
              <View key={id} style={{ gap: 8 }}>
                {m.kind === "image" ? (
                  <Photo media={m} />
                ) : (
                  <Text>{m.name}</Text>
                )}
                <PhotoDetails media={m} />
                {!draft.recordId && draft.groupPhotosByDay && (
                  <View style={{ gap: 8 }}>
                    <Text style={s.muted}>
                      事情{" "}
                      {dayGroups.findIndex((group) =>
                        group.mediaIds.includes(id),
                      ) + 1}
                    </Text>
                    <Button
                      title="调整归属"
                      disabled={busy}
                      onPress={() =>
                        setMovingPhoto(movingPhoto === id ? null : id)
                      }
                    />
                    {movingPhoto === id && (
                      <>
                        <Button
                          title="单独记一件事"
                          disabled={
                            dayGroups.find((group) =>
                              group.mediaIds.includes(id),
                            )?.mediaIds.length === 1
                          }
                          onPress={() => moveToEvent(id, "new")}
                        />
                        {dayGroups.map(
                          (group, index) =>
                            !group.mediaIds.includes(id) && (
                              <Button
                                key={index}
                                title={`移到事情 ${index + 1}${group.title ? `：${group.title}` : ""}`}
                                onPress={() => moveToEvent(id, index)}
                              />
                            ),
                        )}
                      </>
                    )}
                  </View>
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
            title={
              details
                ? "收起补充信息"
                : draft.groupPhotosByDay && draft.content.mediaIds.length
                  ? "从文件添加素材"
                  : "补充标题、地点"
            }
            onPress={() => setDetails(!details)}
          />
          {details && (
            <>
              {!(draft.groupPhotosByDay && draft.content.mediaIds.length) && (
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
                </>
              )}
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
        <View
          style={{
            padding: 16,
            backgroundColor: colors.glass,
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: colors.glassLine,
          }}
        >
          <Button
            title={
              busy
                ? "正在保存…"
                : dayGroups.length > 1
                  ? `保存 ${dayGroups.length} 条记录`
                  : "保存这一刻"
            }
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
                const records = await store.change((s) =>
                  savePhotoDays(s, draft.id, newId, now()),
                );
                nextAction.current = () =>
                  records.length === 1
                    ? navigation.popTo("Record", { id: records[0]!.id })
                    : navigation.popToTop();
                setAllowExit(true);
              });
            }}
          />
        </View>
      </KeyboardAvoidingView>
    </Page>
  );
}
