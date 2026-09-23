import { AIEditor } from "../ai/Editor";
import { proposalPatch } from "../ai/state";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  AppState,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { usePreventRemove } from "@react-navigation/native";
import DateTimePicker from "@react-native-community/datetimepicker";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import { useLibrary, useStore } from "./context";
import {
  BY_PRESETS,
  clone,
  saveRecord,
  type RecordContent,
  type RecordDraft,
  type LocalMedia,
} from "./model";
import { newId, now, createPerson } from "./services";
import { useDailyQuestion } from "./dailyQuestionHooks";
import { dailyPromptOf, isStoryDay } from "./prompts";
import { preserveMedia, verifyMedia } from "./files";
import { useDraftPersist, useRecorder } from "./editorHooks";
import { appendTranscript } from "./transcribe";
import { useTranscription } from "./transcribeHooks";
import { isEmptyDraft } from "./empties";
import type { Props } from "./navigation";
import {
  BottomBar,
  Button,
  Card,
  DangerCard,
  ErrorText,
  Field,
  FieldRow,
  Page,
  PersonChips,
  SignatureButton,
  Text,
  ToolButton,
  dateLabel,
  hapticSuccess,
  messageOf,
  useKeyboardBarOffset,
  useStyles,
  useTheme,
} from "./ui";
import { JournalIcon } from "../components/JournalIcon";
import { Photo, PhotoDetails } from "./Media";
import {
  applyPhotoMetadata,
  readPhotoMetadata,
} from "./photo-metadata";
/** 标题、地点、人物有一样填过，打开编辑页时那张纸卡就展开着，填过的东西不藏起来。 */
const hasDetails = (d: RecordDraft | undefined) =>
  !!d &&
  (!!d.content.title.trim() ||
    !!d.content.location.trim() ||
    (d.content.personIds?.length ?? 0) > 0);
export function Editor({ route, navigation }: Props<"Editor">) {
  const store = useStore(),
    state = useLibrary(),
    s = useStyles(),
    { colors, large } = useTheme(),
    keyboardOffset = useKeyboardBarOffset();
  const [draft, setDraft] = useState<RecordDraft | undefined>(() =>
      clone(store.get().drafts[route.params.draftId]),
    ),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [details, setDetails] = useState(() => hasDetails(draft)),
    [dateOpen, setDateOpen] = useState(false),
    [allowExit, setAllowExit] = useState(false),
    [promptSeed, setPromptSeed] = useState(0),
    [promptOff, setPromptOff] = useState(false),
    [newPerson, setNewPerson] = useState("");
  const dailyVisible = !!draft && !promptOff && !draft.recordId && !draft.content.text.trim();
  const storyDay = isStoryDay(state.profile.birthday, new Date());
  const daily = useDailyQuestion(store, state, dailyVisible && !storyDay);
  const [permDenied, setPermDenied] = useState(false);
  const personList = useMemo(
    () => Object.values(state.persons),
    [state.persons],
  );
  // 落款候选：这台手机的默认落款与用过的称呼按次数排前面，六个常用称呼兜底。
  const byOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of Object.values(state.records))
      if (r.by) counts.set(r.by, (counts.get(r.by) ?? 0) + 1);
    const used = [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh"))
      .map(([by]) => by);
    return [
      ...new Set([
        ...(state.settings.by ? [state.settings.by] : []),
        ...used,
        ...BY_PRESETS,
      ]),
    ];
  }, [state.records, state.settings.by]);
  const nextAction = useRef<(() => void) | null>(null),
    operation = useRef(false),
    // 保存进行中按了返回：记下来，这一轮操作结束后再走，不用一行红字拦人。
    pendingExit = useRef<(() => void) | null>(null);
  const {
    current,
    verified,
    importedMedia,
    persist,
    persistDebounced,
    flush,
    drop,
  } = useDraftPersist(store, setError, setDraft, draft);
  const change = (patch: Partial<RecordContent>) => {
    if (!current.current) return;
    const next = {
      ...current.current,
      ...(patch.date !== undefined
        ? { autoDate: false }
        : {}),
      ...(patch.location !== undefined
        ? { autoLocation: false }
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
  const transcription = useTranscription(store, async (text) => {
    const d = current.current;
    if (!d) return;
    change({ text: appendTranscript(d.content.text, text) });
    await flush();
  });
  const {
    recording,
    start: startRecording,
    finishAudio,
    discardAudio,
  } = useRecorder({
    draftRef: current,
    verified,
    persist,
    onFinished: (media, info) => {
      void transcription.begin(media, info.seconds);
    },
    attachRecording: (d, id) => ({
      ...d,
      content: { ...d.content, mediaIds: [...d.content.mediaIds, id] },
    }),
  });
  /** 选了落款就记到草稿上；这台手机还没有默认落款时顺手记下，下一段时光直接带上。 */
  const sign = (by: string | undefined) => {
    change({ by });
    if (by && !state.settings.by)
      void store
        .change((s) => {
          s.settings = { ...s.settings, by };
        })
        .catch((e) => setError(messageOf(e)));
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
    const exit = pendingExit.current;
    if (exit) {
      pendingExit.current = null;
      void run(() => leave(exit));
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
    transcription.stop();
    // 什么都没写就走：草稿静默清理，不留「继续编辑」也不弹确认。
    if (current.current && isEmptyDraft(current.current)) await drop();
    else await flush();
    nextAction.current = action;
    setAllowExit(true);
  };
  usePreventRemove(!allowExit, ({ data }) => {
    const exit = () => navigation.dispatch(data.action);
    if (operation.current) {
      pendingExit.current = exit;
      return;
    }
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
  // 纸卡收起时那一行摘要：填过的标题、地点、人物按顺序串起来。
  const detailsSummary = [
    draft.content.title.trim(),
    draft.content.location.trim(),
    (draft.content.personIds ?? [])
      .map((id) => state.persons[id]?.name)
      .filter(Boolean)
      .join("、"),
  ]
    .filter(Boolean)
    .join(" · ");
  const addPerson = () => {
    if (!newPerson.trim() || busy) return;
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
  };
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
  const pickFiles = async () => {
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
    if (r.canceled) return;
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
  };
  return (
    <Page
      scroll={false}
      title={draft.recordId ? "编辑这一刻" : "记下这一刻"}
      right={
        <Button
          title={dateLabel(draft.content.date)}
          icon="calendar"
          kind="text"
          compact
          onPress={() => setDateOpen(!dateOpen)}
        />
      }
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        // 布局帧相对整屏 SafeAreaView、已含页内顶栏，不能再加顶栏的偏移（1.0.0／1.0.1 键盘上方
        // 多出一条空纸）；唯一的偏移是把底栏的底部安全区藏到键盘后面，见 useKeyboardBarOffset。
        keyboardVerticalOffset={keyboardOffset}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={s.content}
        >
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
            hideLabel
            testID="capture-text"
            editable={!busy}
            multiline
            placeholder="今天，她又带来了什么小惊喜？"
            value={draft.content.text}
            onChangeText={(text) => change({ text })}
            onEndEditing={() => void flush()}
            style={{ minHeight: 160, textAlignVertical: "top" }}
          />
          <SignatureButton
            value={draft.content.by}
            options={byOptions}
            disabled={busy}
            onChange={sign}
          />
          <Text style={[s.muted, { fontSize: 12, lineHeight: 16 }]}>
            草稿会自动保留。
          </Text>
          {dailyVisible &&
            (() => {
              const question = (!storyDay && daily.question) || dailyPromptOf(
                state.profile.birthday,
                new Date(),
                promptSeed,
              );
              return (
                <View
                  style={{ flexDirection: "row", alignItems: "center", gap: 2 }}
                  testID="daily-prompt-card"
                >
                  <Text
                    style={[s.muted, { flex: 1, minWidth: 0 }]}
                    testID="daily-prompt"
                  >
                    今天的小问题：{question}
                  </Text>
                  <Text testID="daily-prompt-source" style={{ display: "none" }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">{storyDay ? "local" : daily.source}</Text>
                  <Button
                    title="换一个"
                    kind="text"
                    compact
                    testID="daily-prompt-next"
                    onPress={() => { daily.useLocal(); setPromptSeed(promptSeed + 1); }}
                  />
                  <Button
                    title="不问了"
                    kind="text"
                    compact
                    testID="daily-prompt-off"
                    onPress={() => setPromptOff(true)}
                  />
                </View>
              );
            })()}
          {transcription.status === "working" && (
            <View style={s.row}>
              <Text testID="transcribe-status" style={s.muted}>
                正在转成文字…
              </Text>
              <Button
                testID="transcribe-stop"
                title="停止"
                kind="text"
                compact
                onPress={transcription.stop}
              />
            </View>
          )}
          {transcription.status === "failed" && (
            <Text testID="transcribe-status" style={s.muted}>
              {transcription.message}
            </Text>
          )}
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
                  void run(() => finishAudio({ transcribe: true }));
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
                        "从草稿里移出？",
                        "只从这份草稿移出，手机里的原文件不动。",
                        [
                          { text: "取消", style: "cancel" },
                          {
                            text: "移除",
                            style: "destructive",
                            onPress: () =>
                              change({
                                mediaIds: draft.content.mediaIds.filter(
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
          {/* 标题、地点、人物：一张纸卡，收起时一行摘要，点开就地展开成卡里的几行（DESIGN.md「编辑」）。 */}
          <Card style={{ padding: 0, gap: 0 }}>
            <Pressable
              testID="editor-details"
              accessibilityRole="button"
              accessibilityLabel="标题、地点、人物"
              // 展开与否由读屏按 expanded 自己念，值里只放收起时那行摘要。
              accessibilityValue={
                details
                  ? undefined
                  : { text: detailsSummary || "都可以不填" }
              }
              accessibilityState={{ expanded: details }}
              onPress={() => setDetails(!details)}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                minHeight: 52,
                paddingHorizontal: 16,
                paddingVertical: 8,
              }}
            >
              {/* 卡在 iOS 是液态玻璃：按压透明度落在里面的字上。 */}
              {({ pressed }) => (
                <>
                  <View
                    style={{
                      flex: 1,
                      minWidth: 0,
                      gap: 2,
                      opacity: pressed ? 0.6 : 1,
                    }}
                  >
                    <Text>标题、地点、人物</Text>
                    {!details && (
                      <Text numberOfLines={1} style={s.muted}>
                        {detailsSummary || "都可以不填"}
                      </Text>
                    )}
                  </View>
                  <View
                    style={{
                      opacity: pressed ? 0.6 : 1,
                      transform: [{ rotate: details ? "180deg" : "0deg" }],
                    }}
                  >
                    <JournalIcon
                      name="chevron-down"
                      color={colors.muted}
                      size={18}
                    />
                  </View>
                </>
              )}
            </Pressable>
            {details && (
              <View
                style={{
                  paddingHorizontal: 16,
                  borderTopWidth: StyleSheet.hairlineWidth,
                  borderTopColor: colors.line,
                }}
              >
                <FieldRow
                  label="标题"
                  accessibilityLabel="标题（可选）"
                  testID="editor-title"
                  placeholder="例如：第一次翻身"
                  value={draft.content.title}
                  onChangeText={(title) => change({ title })}
                />
                <FieldRow
                  label="地点"
                  accessibilityLabel="地点（可选）"
                  testID="editor-location"
                  placeholder="例如：外婆家"
                  value={draft.content.location}
                  onChangeText={(location) => change({ location })}
                />
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "flex-start",
                    gap: 12,
                    paddingVertical: 4,
                  }}
                >
                  {/* 小标签与右边第一行（chip 或输入）的字对齐：两者都是 44 高、字居中。 */}
                  <Text style={[s.muted, { minWidth: 40, paddingTop: 11 }]}>
                    有谁
                  </Text>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    {personList.length > 0 && (
                      <PersonChips
                        persons={personList}
                        selected={draft.content.personIds ?? []}
                        compact
                        chipTestID={(id) => `person-chip-${id}`}
                        onToggle={(id) => {
                          const currentIds = draft.content.personIds ?? [];
                          change({
                            personIds: currentIds.includes(id)
                              ? currentIds.filter((x) => x !== id)
                              : [...currentIds, id],
                          });
                        }}
                      />
                    )}
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 4,
                      }}
                    >
                      <TextInput
                        testID="person-new-name"
                        accessibilityLabel="添加人物"
                        placeholder="添加一个人，例如：外婆"
                        placeholderTextColor={colors.muted}
                        value={newPerson}
                        onChangeText={setNewPerson}
                        onSubmitEditing={addPerson}
                        returnKeyType="done"
                        editable={!busy}
                        style={{
                          flex: 1,
                          minWidth: 0,
                          color: colors.ink,
                          fontSize: large ? 19 : 16,
                          paddingVertical: 12,
                        }}
                      />
                      <Button
                        title="添加"
                        kind="text"
                        compact
                        testID="person-new-add"
                        disabled={!newPerson.trim() || busy}
                        onPress={addPerson}
                      />
                    </View>
                    {personList.length > 0 && (
                      <View style={{ alignSelf: "flex-start", marginLeft: -8 }}>
                        <Button
                          title="整理人物"
                          kind="text"
                          compact
                          testID="open-people"
                          onPress={() => navigation.navigate("People")}
                        />
                      </View>
                    )}
                  </View>
                </View>
              </View>
            )}
          </Card>
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
          <DangerCard
            title="放弃这份草稿"
            testID="editor-discard"
            disabled={busy}
            onPress={() =>
              Alert.alert(
                "放弃草稿？",
                draft.recordId
                  ? "原先保存的记录不会改变。"
                  : "这份草稿将被删除。",
                [
                  { text: "取消", style: "cancel" },
                  {
                    text: "放弃",
                    style: "destructive",
                    onPress: () => {
                      void run(async () => {
                        transcription.stop();
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
        <BottomBar gap={8}>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <ToolButton
              icon="image"
              label="照片"
              disabled={busy || recording}
              onPress={() => {
                void run(() => pick(false));
              }}
            />
            <ToolButton
              icon="camera"
              label="拍摄"
              disabled={busy || recording}
              onPress={() => {
                void run(() => pick(true));
              }}
            />
            <ToolButton
              icon="microphone"
              label={recording ? "说完了" : "说一段"}
              disabled={busy}
              onPress={() => {
                void run(async () => {
                  if (current.current?.recordingFile) {
                    await finishAudio({ transcribe: true });
                    return;
                  }
                  await startRecording();
                });
              }}
            />
            <AIEditor
              tool
              draft={draft}
              disabled={busy || recording}
              onPatch={(patch) =>
                persist({ ...current.current!, ...patch, updatedAt: now() })
              }
              onApply={async (proposal, part) => {
                const d = current.current!;
                await persist({
                  ...d,
                  ...proposalPatch(d, proposal, part),
                  aiProposal: undefined,
                  aiJob: undefined,
                  updatedAt: now(),
                });
              }}
            />
            <ToolButton
              icon="file"
              label="文件"
              disabled={busy || recording}
              onPress={() => {
                void run(pickFiles);
              }}
            />
          </View>
          <Button
            title={busy ? "正在保存…" : "保存这一刻"}
            primary
            testID="capture-save"
            disabled={busy}
            onPress={() => {
              void run(async () => {
                transcription.stop();
                if (current.current?.recordingFile) await finishAudio();
                await flush();
                // 导入时已校验过的素材不再重复读盘哈希；只查本次会话新增的。
                for (const id of current.current!.content.mediaIds) {
                  if (verified.current.has(id)) continue;
                  const media = store.get().media[id];
                  if (!media) throw new Error("附件还没写完，请重试。");
                  await verifyMedia(media);
                  verified.current.add(id);
                }
                const record = await store.change((s) =>
                  saveRecord(s, draft.id, newId(), now()),
                );
                hapticSuccess();
                nextAction.current = () =>
                  navigation.popTo("Record", { id: record.id });
                setAllowExit(true);
              });
            }}
          />
        </BottomBar>
      </KeyboardAvoidingView>
    </Page>
  );
}
