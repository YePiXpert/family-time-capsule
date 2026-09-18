import { AIEditor } from "../ai/Editor";
import { proposalPatch } from "../ai/state";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  AppState,
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  View,
} from "react-native";
import { usePreventRemove } from "@react-navigation/native";
import { useHeaderHeight } from "@react-navigation/elements";
import DateTimePicker from "@react-native-community/datetimepicker";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import { useLibrary, useStore } from "./context";
import {
  clone,
  type RecordContent,
  type RecordDraft,
  type LocalMedia,
} from "./model";
import { newId, now, createPerson } from "./services";
import { promptOf } from "./prompts";
import { preserveMedia, verifyMedia } from "./files";
import { useDraftPersist, useRecorder } from "./editorHooks";
import type { Props } from "./navigation";
import {
  BottomBar,
  Button,
  Card,
  ErrorText,
  Field,
  Page,
  Text,
  dateLabel,
  messageOf,
  useStyles,
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
    s = useStyles();
  const headerHeight = useHeaderHeight();
  const [draft, setDraft] = useState<RecordDraft | undefined>(() =>
    clone(store.get().drafts[route.params.draftId]),
  ),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [details, setDetails] = useState(false),
    [dateOpen, setDateOpen] = useState(false),
    [movingPhoto, setMovingPhoto] = useState<string | null>(null),
    [eventDate, setEventDate] = useState<number | null>(null),
    [allowExit, setAllowExit] = useState(false),
    [promptSeed, setPromptSeed] = useState(0),
    [promptOff, setPromptOff] = useState(false),
    [newPerson, setNewPerson] = useState("");
  const [permDenied, setPermDenied] = useState(false);
  const personList = useMemo(
    () => Object.values(state.persons).sort((a, b) => a.name.localeCompare(b.name, "zh")),
    [state.persons],
  );
  const nextAction = useRef<(() => void) | null>(null),
    operation = useRef(false);
  const { current, pendingMedia, verified, importedMedia, persist, persistDebounced, flush } =
    useDraftPersist(store, setError, setDraft, draft);
  const { recording, start: startRecording, finishAudio, discardAudio } =
    useRecorder({ draftRef: current, verified, persist });
  const change = (patch: Partial<RecordContent>) => {
    if (!current.current) return;
    const next = {
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
    };
    const keystrokeOnly =
      Object.keys(patch).length > 0 &&
      Object.keys(patch).every((key) => key === "text" || key === "title");
    if (keystrokeOnly) persistDebounced(next);
    else void persist(next);
  };
  const run = async (fn: () => Promise<void>) => {
    if (operation.current) return;
    operation.current = true;
    setBusy(true);
    setError("");
    setPermDenied(false);
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
    for (const m of media) {
      await verifyMedia(m);
      verified.current.add(m.id);
    }
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
  const finishRef = useRef(finishAudio);
  useEffect(() => {
    finishRef.current = finishAudio;
  });
  useEffect(() => {
    const sub = AppState.addEventListener("change", (status) => {
      if (status !== "active") {
        void (async () => {
          await finishRef.current();
          await flush();
        })().catch((e) => setError(messageOf(e)));
      }
    });
    return () => sub.remove();
  }, [flush]);
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
  usePreventRemove(!allowExit, ({ data }) => {
    if (operation.current) {
      setError("正在保存，请稍候再返回。");
      return;
    }
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
    if (!permission.granted) {
      setPermDenied(true);
      throw new Error(
        camera ? "请在系统设置中允许拍摄。" : "请在系统设置中允许选择照片。",
      );
    }
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
    // 循环内只做复制与读元数据，循环外一次 attach 一次落盘，避免整批照片逐张全库写。
    const imported: LocalMedia[] = [];
    for (const asset of result.assets) {
      const media = await preserveMedia(
        asset.uri,
        asset.fileName ?? (asset.type === "video" ? "视频.mp4" : "照片.jpg"),
        asset.type === "video" ? "video" : "image",
      );
      if (media.kind === "image")
        media.photoMetadata = readPhotoMetadata(asset.exif);
      imported.push(media);
    }
    await attach(imported);
  };
  const dayGroups = photoDayGroups(draft, { ...state.media, ...importedMedia });
  const editEvent = (index: number, patch: Partial<RecordContent>) => {
    const events = photoDayGroups(current.current!, {
      ...store.get().media,
      ...pendingMedia.current,
    });
    events[index] = { ...events[index]!, ...patch };
    const next = { ...current.current!, photoEvents: events, updatedAt: now() };
    const keystrokeOnly =
      Object.keys(patch).length > 0 &&
      Object.keys(patch).every((key) => key === "text" || key === "title");
    if (keystrokeOnly) persistDebounced(next);
    else void persist(next);
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
        keyboardVerticalOffset={headerHeight}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={s.content}
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
            <Card>
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
                        没有拍摄时间的素材会跟相邻素材记入同一天，日期可修改。
                      </Text>
                  {dayGroups.map((group, index) => (
                    <Card key={index}>
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
                        <>
                          <DateTimePicker
                            value={new Date(group.date)}
                            mode="date"
                            display={
                              Platform.OS === "ios" ? "spinner" : "default"
                            }
                            onChange={(_, date) => {
                              if (Platform.OS !== "ios") setEventDate(null);
                              if (date)
                                editEvent(index, { date: date.toISOString() });
                            }}
                          />
                          {Platform.OS === "ios" && (
                            <Button
                              title="日期选好了"
                              onPress={() => setEventDate(null)}
                            />
                          )}
                        </>
                      )}
                      <Field
                        label="这件事的标题"
                        value={group.title}
                        editable={!busy}
                        onChangeText={(title) => editEvent(index, { title })}
                        onEndEditing={() => void flush()}
                      />
                      <Field
                        label="这件事发生了什么"
                        value={group.text}
                        multiline
                        editable={!busy}
                        onChangeText={(text) => editEvent(index, { text })}
                        onEndEditing={() => void flush()}
                      />
                      <Field
                        label="这件事的地点"
                        value={group.location}
                        editable={!busy}
                        onChangeText={(location) =>
                          editEvent(index, { location })
                        }
                      />
                    </Card>
                  ))}
                </>
              )}
            </Card>
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
              onEndEditing={() => void flush()}
              style={{ minHeight: 160, textAlignVertical: "top" }}
            />
          )}
          {!promptOff &&
            !draft.recordId &&
            !draft.content.text.trim() &&
            !(draft.groupPhotosByDay && draft.content.mediaIds.length > 0) &&
            (() => {
              const question = promptOf(
                state.profile.birthday,
                new Date(),
                promptSeed,
              );
              return (
                <View style={{ gap: 6 }} testID="daily-prompt-card">
                  <Text style={s.muted} testID="daily-prompt">
                    今天的小问题：{question}
                  </Text>
                  <View style={s.row}>
                    <Button
                      title="换一个"
                      compact
                      testID="daily-prompt-next"
                      onPress={() => setPromptSeed(promptSeed + 1)}
                    />
                    <Button
                      title="不问了"
                      compact
                      testID="daily-prompt-off"
                      onPress={() => setPromptOff(true)}
                    />
                  </View>
                </View>
              );
            })()}
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
                  await startRecording();
                });
              }}
            />
            <AIEditor
              draft={draft}
              media={{ ...state.media, ...importedMedia }}
              disabled={busy || recording}
              onPatch={(patch) =>
                persist({ ...current.current!, ...patch, updatedAt: now() })
              }
              onApply={async (proposal, part) => {
                const d = current.current!;
                await persist({
                  ...d,
                  ...proposalPatch(
                    d,
                    { ...store.get().media, ...pendingMedia.current },
                    proposal,
                    part,
                  ),
                  aiProposal: undefined,
                  aiJob: undefined,
                  updatedAt: now(),
                });
              }}
            />
          </View>
          {draft.recordingFile && (
            <Card>
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
            </Card>
          )}
          {draft.content.mediaIds.map((id) => {
            const m = state.media[id] ?? importedMedia[id];
            return m ? (
              <View key={id} style={{ gap: 8 }}>
                {m.kind === "image" ? (
                  <Photo media={m} preview />
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
                      Alert.alert(
                        "移除这份素材？",
                        `「${m.name}」只从这份草稿移出，明确保存后才生效。`,
                        [
                          { text: "取消", style: "cancel" },
                          {
                            text: "移除",
                            style: "destructive",
                            onPress: () =>
                              change({
                                mediaIds:
                                  draft.content.mediaIds.filter(
                                    (x) => x !== id,
                                  ),
                                coverId:
                                  draft.content.coverId === id
                                    ? null
                                    : draft.content.coverId,
                              }),
                          },
                        ],
                      )
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
              <View style={{ gap: 8 }}>
                <Text style={s.muted}>这一刻有谁（可选）</Text>
                {personList.length > 0 && (
                  <View style={s.row}>
                    {personList.map((person) => {
                      const selected = (
                        draft.content.personIds ?? []
                      ).includes(person.id);
                      return (
                        <Button
                          key={person.id}
                          compact
                          title={person.name}
                          selected={selected}
                          testID={`person-chip-${person.id}`}
                          onPress={() => {
                            const currentIds = draft.content.personIds ?? [];
                            change({
                              personIds: selected
                                ? currentIds.filter((id) => id !== person.id)
                                : [...currentIds, person.id],
                            });
                          }}
                        />
                      );
                    })}
                  </View>
                )}
                {personList.length > 0 && (
                  <Button
                    title="整理人物"
                    compact
                    testID="open-people"
                    onPress={() => navigation.navigate("People")}
                  />
                )}
                <View style={s.row}>
                  <View style={{ flex: 1, minWidth: 200 }}>
                    <Field
                      label="添加人物"
                      hideLabel
                      testID="person-new-name"
                      placeholder="例如：妈妈、外婆、小姨"
                      value={newPerson}
                      onChangeText={setNewPerson}
                      editable={!busy}
                    />
                  </View>
                  <Button
                    title="添加"
                    testID="person-new-add"
                    disabled={!newPerson.trim() || busy}
                    onPress={() => {
                      void run(async () => {
                        const id = await createPerson(store, newPerson);
                        const currentIds = current.current?.content.personIds ?? [];
                        await persist({
                          ...current.current!,
                          content: {
                            ...current.current!.content,
                            personIds: [...new Set([...currentIds, id])],
                          },
                          updatedAt: now(),
                        });
                        setNewPerson("");
                      });
                    }}
                  />
                </View>
              </View>
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
                    if (!r.canceled) {
                      const picked: LocalMedia[] = [];
                      for (const a of r.assets)
                        picked.push(
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
                        );
                      await attach(picked);
                    }
                  });
                }}
              />
            </>
          )}
          <ErrorText message={error} />
          {error && permDenied && (
            <Button
              title="去系统设置开启"
              onPress={() => {
                setPermDenied(false);
                void Linking.openSettings();
              }}
              disabled={busy}
            />
          )}
          {error && !permDenied && (
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
        <BottomBar>
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
                // 导入时已校验过的素材不再重复读盘哈希；只查本次会话新增的。
                for (const id of current.current!.content.mediaIds) {
                  if (verified.current.has(id)) continue;
                  const media = store.get().media[id];
                  if (!media) throw new Error("素材尚未写入，请重试。");
                  await verifyMedia(media);
                  verified.current.add(id);
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
        </BottomBar>
      </KeyboardAvoidingView>
    </Page>
  );
}
