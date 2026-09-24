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
import { PermissionDenied, useDraftPersist, useRecorder } from "./editorHooks";
import { ExitGate } from "./exitGate";
import { appendTranscript } from "./transcribe";
import { useTranscription } from "./transcribeHooks";
import { isEmptyDraft, isUntouchedEdit } from "./empties";
import type { Props } from "./navigation";
import {
  BottomBar,
  Button,
  Card,
  DateStrip,
  ErrorText,
  FieldRow,
  IconButton,
  Page,
  PersonChips,
  SignatureButton,
  Text,
  ToolButton,
  dateLabel,
  serif,
  hapticSuccess,
  messageOf,
  useKeyboardBarOffset,
  useSheetViewport,
  useStyles,
  useTheme,
  TEXT_MAX_SCALE,
} from "./ui";
import { JournalIcon, type JournalIconName } from "../components/JournalIcon";
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
    [newPerson, setNewPerson] = useState(""),
    [contentHeight, setContentHeight] = useState(0),
    [pickedId, setPickedId] = useState<string | null>(null);
  const { viewport, height, measure } = useSheetViewport();
  const dailyVisible =
    !!draft && !draft.recordId && !draft.content.text.trim();
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
  const operation = useRef(false),
    // 保存进行中按了返回：记下来，这一轮操作结束后再走，不用一行红字拦人。
    [exits] = useState(() => new ExitGate());
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
      if (e instanceof PermissionDenied) setPermDenied(true);
      setError(messageOf(e));
    } finally {
      operation.current = false;
      setBusy(false);
    }
    const exit = exits.release();
    if (exit) void run(() => leave(exit));
  };
  const exitWith = (action: () => void) => {
    exits.decide(action);
    setAllowExit(true);
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
      // iOS 拉下控制中心、弹系统框只是 inactive：录音照录，只落一次盘；真退到后台才收尾录音。
      if (status === "inactive") void flush().catch((e) => setError(messageOf(e)));
      else if (status !== "active") {
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
      exits.take()?.();
    }
  }, [allowExit, exits]);
  const leave = async (action: () => void) => {
    transcription.stop();
    // 什么都没写、或打开已有记录却什么都没改就走：草稿静默清理，不留「继续编辑」也不弹确认。
    const d = current.current;
    if (
      d &&
      (isEmptyDraft(d) ||
        isUntouchedEdit(d, d.recordId ? state.records[d.recordId] : undefined))
    )
      await drop();
    else await flush();
    exitWith(action);
  };
  usePreventRemove(!allowExit, ({ data }) => {
    const exit = () => navigation.dispatch(data.action);
    if (operation.current) {
      exits.hold(exit);
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
      throw new PermissionDenied(
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
  const question = dailyVisible
    ? (!storyDay && daily.question) ||
      dailyPromptOf(state.profile.birthday, new Date(), promptSeed)
    : null;
  const attachments = draft.content.mediaIds
    .map((id) => state.media[id] ?? importedMedia[id])
    .filter((m): m is LocalMedia => !!m);
  const photoCount = attachments.filter((m) => m.kind === "image").length;
  const pickedMedia = attachments.find((m) => m.id === pickedId);
  const tileLabel = (m: LocalMedia) => {
    const n = attachments.filter((o) => o.kind === m.kind).indexOf(m) + 1;
    if (m.kind !== "image") return `${KIND_NAMES[m.kind]} ${n}`;
    const cover = photoCount > 1 && draft.content.coverId === m.id;
    return `第 ${n} 张照片${cover ? "，封面" : ""}`;
  };
  const removeMedia = (id: string) =>
    Alert.alert("从草稿里移出？", "只从这份草稿移出，手机里的原文件不动。", [
      { text: "取消", style: "cancel" },
      {
        text: "移除",
        style: "destructive",
        onPress: () => {
          setPickedId(null);
          // 读当下的草稿：弹窗开着时可能刚有录音收尾加进来，不能拿打开弹窗那一刻的列表覆盖。
          const content = current.current?.content;
          if (!content) return;
          change({
            mediaIds: content.mediaIds.filter((x) => x !== id),
            coverId: content.coverId === id ? null : content.coverId,
          });
        },
      },
    ]);
  const discardRecording = () =>
    Alert.alert("放弃录音？", "这段录音将不加入记录。", [
      { text: "取消", style: "cancel" },
      {
        text: "放弃",
        style: "destructive",
        onPress: () => {
          void run(discardAudio);
        },
      },
    ]);
  const discardDraft = () =>
    Alert.alert(
      "放弃草稿？",
      draft.recordId ? "原先保存的记录不会改变。" : "这份草稿将被删除。",
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
              exitWith(() => navigation.goBack());
            });
          },
        },
      ],
    );
  return (
    <Page
      scroll={false}
      title={draft.recordId ? "编辑这一刻" : "记下这一刻"}
      // 放弃收进顶栏右侧一枚垃圾桶：页尾不再多一张卡，整页一屏放下、不上下滑。
      right={
        <IconButton
          label="放弃这份草稿"
          icon="trash"
          testID="editor-discard"
          disabled={busy}
          onPress={discardDraft}
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
          // 上下都是 20（s.content 底部原是 32）：纸的高度按这 40 算，放得下时内容正好一屏。
          contentContainerStyle={[s.content, { paddingBottom: 20 }]}
          // 纸卡铺满没弹键盘时的可见高度，键盘弹起、滚动区变矮时纸不跟着缩，见 useSheetViewport。
          onLayout={(e) => measure(e.nativeEvent.layout.height)}
          onContentSizeChange={(_, h) => setContentHeight(h)}
          // 纸刚好铺满一屏：放得下就不能滑、不回弹（iOS 纵向默认总回弹）；键盘弹起、展开标题地点人物、
          // 字多到纸放不下时才可以滑。
          scrollEnabled={contentHeight > height + 1}
          alwaysBounceVertical={false}
          overScrollMode="never"
        >
          {/* 一张纸：日期、正文、素材、落款、标题地点人物都写在这张纸上（DESIGN.md「编辑」）。 */}
          <Card
            testID="editor-sheet"
            style={{
              // s.content 上下各留 20：纸的下沿停在底栏上方 20，正好一屏。
              minHeight: viewport > 0 ? viewport - 40 : undefined,
              paddingHorizontal: 20,
              paddingTop: 8,
              paddingBottom: 0,
              gap: 0,
            }}
          >
            {/* 页眉一行：左边日期（与阅读页同一条强调色小竖条，点开就地改），右边「换个问题」，正对着下面的问题。 */}
            <View style={s.between}>
              <Pressable
                testID="editor-date"
                accessibilityRole="button"
                accessibilityLabel={`日期：${dateLabel(draft.content.date)}`}
                accessibilityHint="点按修改日期"
                accessibilityState={{ expanded: dateOpen }}
                hitSlop={6}
                onPress={() => setDateOpen(!dateOpen)}
                style={{ minHeight: 44, justifyContent: "center" }}
              >
                {/* 卡在 iOS 是液态玻璃：按压透明度落在里面的字上。 */}
                {({ pressed }) => (
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 6,
                      opacity: pressed ? 0.6 : 1,
                    }}
                  >
                    <DateStrip>
                      <Text
                        style={[
                          s.muted,
                          { color: colors.accent, fontWeight: "600" },
                        ]}
                      >
                        {dateLabel(draft.content.date)}
                      </Text>
                    </DateStrip>
                    <JournalIcon
                      name="chevron-down"
                      color={colors.accent}
                      size={14}
                    />
                  </View>
                )}
              </Pressable>
              {question && (
                <View testID="daily-prompt-card">
                  <Text
                    testID="daily-prompt-source"
                    style={{ display: "none" }}
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                  >
                    {storyDay ? "local" : daily.source}
                  </Text>
                  <Button
                    title="换个问题"
                    kind="text"
                    compact
                    testID="daily-prompt-next"
                    onPress={() => {
                      daily.useLocal();
                      setPromptSeed(promptSeed + 1);
                    }}
                  />
                </View>
              )}
            </View>
            {dateOpen && (
              <View style={{ gap: 8, paddingBottom: 8 }}>
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
              </View>
            )}
            {/* 正文直接写在纸上：无框、衬线、行距放宽；今天的小问题就是占位句，一动笔它就退场。 */}
            <TextInput
              maxFontSizeMultiplier={TEXT_MAX_SCALE}
              testID="capture-text"
              accessibilityLabel="这一刻发生了什么"
              editable={!busy}
              multiline
              placeholder={question ?? "今天，她又带来了什么小惊喜？"}
              placeholderTextColor={colors.muted}
              value={draft.content.text}
              onChangeText={(text) => change({ text })}
              onEndEditing={() => void flush()}
              textAlignVertical="top"
              style={{
                flexGrow: 1,
                minHeight: 132,
                paddingTop: 4,
                paddingBottom: 12,
                paddingHorizontal: 0,
                color: colors.ink,
                fontFamily: serif,
                fontSize: large ? 20 : 17,
                lineHeight: large ? 32 : 28,
              }}
            />
            {recording && (
              <View style={[s.row, { flexWrap: "nowrap" }]}>
                <View
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 4,
                    backgroundColor: colors.error,
                  }}
                />
                <Text style={[s.muted, { flex: 1, minWidth: 0 }]}>
                  正在录音…
                </Text>
                <Button
                  title="放弃"
                  kind="text"
                  danger
                  compact
                  disabled={busy}
                  onPress={discardRecording}
                />
              </View>
            )}
            {!recording && !!draft.recordingFile && (
              <View style={[s.row, { flexWrap: "nowrap" }]}>
                <Text style={[s.muted, { flex: 1, minWidth: 0 }]}>
                  有一段录音还没保存
                </Text>
                <Button
                  title="保存录音"
                  kind="text"
                  compact
                  disabled={busy}
                  onPress={() => {
                    void run(() => finishAudio({ transcribe: true }));
                  }}
                />
                <Button
                  title="放弃"
                  kind="text"
                  danger
                  compact
                  disabled={busy}
                  onPress={discardRecording}
                />
              </View>
            )}
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
            {!!error && (
              <View style={{ paddingBottom: 4 }}>
                <ErrorText message={error} />
                <View style={[s.row, { marginLeft: -8 }]}>
                  {permDenied ? (
                    <Button
                      title="去系统设置开启"
                      kind="text"
                      compact
                      disabled={busy}
                      onPress={() => {
                        setPermDenied(false);
                        void Linking.openSettings();
                      }}
                    />
                  ) : (
                    <Button
                      title="重试暂存"
                      kind="text"
                      compact
                      disabled={busy}
                      onPress={() => {
                        void run(flush);
                      }}
                    />
                  )}
                </View>
              </View>
            )}
            {attachments.length > 0 && (
              <View style={{ paddingTop: 4, paddingBottom: 4 }}>
                {/* 素材是插图：一排小方格，点一下选中，下面出这一格的动作。 */}
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                  style={{ marginHorizontal: -20 }}
                  contentContainerStyle={{ paddingHorizontal: 20, gap: 8 }}
                >
                  {attachments.map((m, i) => (
                    <MediaTile
                      key={m.id}
                      testID={`editor-media-${i}`}
                      media={m}
                      label={tileLabel(m)}
                      cover={photoCount > 1 && draft.content.coverId === m.id}
                      picked={pickedId === m.id}
                      onPress={() =>
                        setPickedId(pickedId === m.id ? null : m.id)
                      }
                    />
                  ))}
                </ScrollView>
                {pickedMedia && (
                  <View style={{ paddingTop: 8 }}>
                    <PhotoDetails media={pickedMedia} />
                    <View style={[s.row, { gap: 0, marginLeft: -8 }]}>
                      <Button
                        title={OPEN_LABELS[pickedMedia.kind]}
                        kind="text"
                        compact
                        testID="editor-media-open"
                        // 录音中不开播放页：播放会抢录音的音频会话，还会录进去。
                        disabled={recording}
                        onPress={() =>
                          navigation.navigate("Media", { id: pickedMedia.id })
                        }
                      />
                      {pickedMedia.kind === "image" &&
                        draft.content.coverId !== pickedMedia.id && (
                          <Button
                            title="设为封面"
                            kind="text"
                            compact
                            testID="editor-media-cover"
                            onPress={() =>
                              change({ coverId: pickedMedia.id })
                            }
                          />
                        )}
                      <Button
                        title="移除"
                        kind="text"
                        danger
                        compact
                        testID="editor-media-remove"
                        onPress={() => removeMedia(pickedMedia.id)}
                      />
                    </View>
                  </View>
                )}
              </View>
            )}
            {/* 页脚一行：右边是落款；动了笔、有东西可留了，左边才出「草稿会自动保留」。 */}
            <SignatureButton
              value={draft.content.by}
              options={byOptions}
              disabled={busy}
              onChange={sign}
              leading={
                question ? null : (
                  <Text style={s.footnote}>草稿会自动保留</Text>
                )
              }
            />
            <View
              style={{
                height: StyleSheet.hairlineWidth,
                backgroundColor: colors.line,
                marginHorizontal: -20,
                marginTop: 8,
              }}
            />
            <Pressable
              testID="editor-details"
              accessibilityRole="button"
              accessibilityLabel="标题、地点、人物"
              // 展开与否由读屏按 expanded 自己念，值里只放收起时那行摘要；没填过就不念。
              accessibilityValue={
                details || !detailsSummary ? undefined : { text: detailsSummary }
              }
              accessibilityState={{ expanded: details }}
              onPress={() => setDetails(!details)}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                minHeight: 52,
              }}
            >
              {({ pressed }) => (
                <>
                  <Text style={{ opacity: pressed ? 0.6 : 1 }}>
                    标题、地点、人物
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={[
                      s.muted,
                      {
                        flex: 1,
                        minWidth: 0,
                        textAlign: "right",
                        opacity: pressed ? 0.6 : 1,
                      },
                    ]}
                  >
                    {details ? "" : detailsSummary}
                  </Text>
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
                  paddingBottom: 8,
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
                        maxFontSizeMultiplier={TEXT_MAX_SCALE}
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
                exitWith(() =>
                  navigation.popTo("Record", { id: record.id }));
              });
            }}
          />
        </BottomBar>
      </KeyboardAvoidingView>
    </Page>
  );
}
const TILE = 96;
const KIND_NAMES: Record<LocalMedia["kind"], string> = {
  image: "照片",
  audio: "录音",
  video: "视频",
  document: "文件",
};
const OPEN_LABELS: Record<LocalMedia["kind"], string> = {
  image: "看大图",
  audio: "听录音",
  video: "看视频",
  document: "打开文件",
};
const KIND_ICONS: Record<LocalMedia["kind"], JournalIconName> = {
  image: "image",
  audio: "audio",
  video: "video",
  document: "file",
};
/** 纸上的一格素材：照片（与有缩略图的视频）是圆角小方图，录音与文件是带图标的浅底小签。 */
function MediaTile({
  media,
  label,
  cover,
  picked,
  onPress,
  testID,
}: {
  media: LocalMedia;
  label: string;
  /** 不止一张照片时，封面那格角上标「封面」。 */
  cover: boolean;
  picked: boolean;
  onPress: () => void;
  testID?: string;
}) {
  const { colors } = useTheme();
  const s = useStyles();
  const picture =
    media.kind === "image" || (media.kind === "video" && !!media.thumb);
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: picked }}
      onPress={onPress}
      style={({ pressed }) => ({
        width: TILE,
        height: TILE,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      {picture ? (
        <Photo media={media} preview size={TILE} label={label} />
      ) : (
        <View
          style={{
            flex: 1,
            borderRadius: 12,
            backgroundColor: colors.selected,
            alignItems: "center",
            justifyContent: "center",
            gap: 4,
          }}
        >
          <JournalIcon
            name={KIND_ICONS[media.kind]}
            color={colors.accent}
            size={24}
          />
          <Text style={s.footnote}>{KIND_NAMES[media.kind]}</Text>
        </View>
      )}
      {media.kind === "video" && picture && (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            right: 6,
            bottom: 6,
            width: 24,
            height: 24,
            borderRadius: 12,
            backgroundColor: "rgba(0,0,0,0.45)",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <JournalIcon name="play" color="#FFFFFF" size={14} />
        </View>
      )}
      {cover && (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            left: 6,
            bottom: 6,
            paddingHorizontal: 6,
            borderRadius: 6,
            backgroundColor: colors.accent,
          }}
        >
          <Text
            style={{
              color: colors.onAccent,
              fontSize: 11,
              lineHeight: 16,
              fontWeight: "600",
            }}
          >
            封面
          </Text>
        </View>
      )}
      {picked && (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            borderRadius: 12,
            borderWidth: 2,
            borderColor: colors.accent,
          }}
        />
      )}
    </Pressable>
  );
}
