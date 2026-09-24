import { useCallback, useEffect, useRef, useState } from "react";
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
import { JournalIcon } from "../components/JournalIcon";
import { useLibrary, useStore } from "./context";
import { PermissionDenied, useRecorder } from "./editorHooks";
import { isEmptyLetter } from "./empties";
import { toDayKey } from "./dates";
import { openAtLabel, PAST_OPEN_AT } from "./letters";
import {
  LETTER_FROM_LIMIT,
  LETTER_TEXT_LIMIT,
  LETTER_TITLE_LIMIT,
  type LocalLetter,
  type LocalMedia,
  type Stored,
} from "./model";
import type { Props } from "./navigation";
import { deleteLetter, now, sealLetter, updateLetter } from "./services";
import {
  BottomBar,
  Button,
  Card,
  DateStrip,
  ErrorText,
  IconButton,
  Page,
  Text,
  messageOf,
  serif,
  useKeyboardBarOffset,
  useSheetViewport,
  useStyles,
  useTheme,
} from "./ui";

/** 编辑中的信：实体本身加一段还没入库的录音文件名（录音结束后才变成素材）。 */
type LetterDraft = { letter: Stored<LocalLetter>; recordingFile?: string };

export function LetterEditor({ route, navigation }: Props<"LetterEditor">) {
  const state = useLibrary(),
    store = useStore(),
    s = useStyles(),
    { colors, large } = useTheme(),
    keyboardOffset = useKeyboardBarOffset(),
    { viewport, height, measure } = useSheetViewport();
  const stored = state.letters[route.params.id];
  const initial: LetterDraft | undefined = stored
    ? { letter: stored }
    : undefined;
  const [draft, setDraft] = useState(initial),
    [error, setError] = useState(""),
    [permDenied, setPermDenied] = useState(false),
    [busy, setBusy] = useState(false),
    [dateOpen, setDateOpen] = useState(false),
    [allowExit, setAllowExit] = useState(false),
    [contentHeight, setContentHeight] = useState(0),
    [importedMedia, setImportedMedia] = useState<Record<string, LocalMedia>>(
      {},
    );
  const current = useRef(initial),
    pendingMedia = useRef<Record<string, LocalMedia>>({}),
    verified = useRef<Set<string>>(new Set()),
    writeTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    mounted = useRef(true),
    operation = useRef(false),
    nextAction = useRef<(() => void) | null>(null),
    // 保存进行中按了返回：记下来，这一轮操作结束后再走，不用一行红字拦人。
    pendingExit = useRef<(() => void) | null>(null);
  const writeNow = useCallback(() => {
    const d = current.current;
    if (!d) return Promise.resolve();
    const originals = Object.values(pendingMedia.current);
    const job = store.change((lib) => {
      for (const m of originals) lib.media[m.id] = m;
      updateLetter(lib, d.letter);
    });
    void job.catch((e) => {
      if (mounted.current) setError(messageOf(e));
    });
    return job;
  }, [store]);
  const persist = useCallback(
    (next: LetterDraft, media: LocalMedia[] = []) => {
      current.current = next;
      setDraft(next);
      for (const m of media) pendingMedia.current[m.id] = m;
      if (media.length) setImportedMedia({ ...pendingMedia.current });
      return writeNow();
    },
    [writeNow],
  );
  /** 文字改动即时反映到界面，落盘延后合并。 */
  const persistDebounced = (next: LetterDraft) => {
    current.current = next;
    setDraft(next);
    if (writeTimer.current) clearTimeout(writeTimer.current);
    writeTimer.current = setTimeout(() => {
      writeTimer.current = null;
      void writeNow();
    }, 400);
  };
  const flush = useCallback(async () => {
    if (writeTimer.current) {
      clearTimeout(writeTimer.current);
      writeTimer.current = null;
    }
    if (current.current) await persist(current.current);
  }, [persist]);
  useEffect(
    () => () => {
      mounted.current = false;
      if (writeTimer.current) {
        clearTimeout(writeTimer.current);
        writeTimer.current = null;
        void writeNow();
      }
    },
    [writeNow],
  );
  const {
    recording,
    start: startRecording,
    finishAudio,
    discardAudio,
  } = useRecorder<LetterDraft>({
    draftRef: current,
    verified,
    persist,
    attachRecording: (d, id) => ({
      ...d,
      letter: {
        ...d.letter,
        mediaIds: [...d.letter.mediaIds, id],
        updatedAt: now(),
      },
    }),
  });
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
      const action = nextAction.current;
      nextAction.current = null;
      action?.();
    }
  }, [allowExit]);
  const change = (patch: Partial<LocalLetter>, keystroke = false) => {
    const d = current.current;
    if (!d) return;
    const next = { ...d, letter: { ...d.letter, ...patch, updatedAt: now() } };
    if (keystroke) persistDebounced(next);
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
      if (e instanceof PermissionDenied) setPermDenied(true);
      setError(messageOf(e));
    } finally {
      operation.current = false;
      if (mounted.current) setBusy(false);
    }
    const exit = pendingExit.current;
    if (exit) {
      pendingExit.current = null;
      void run(() => leave(exit));
    }
  };
  const leave = async (action: () => void) => {
    const d = current.current;
    if (d && !d.recordingFile && isEmptyLetter(d.letter)) {
      // 什么都没写就走：这封空信静默删掉，不在书架上留一封「还没封存的草稿」。
      if (writeTimer.current) {
        clearTimeout(writeTimer.current);
        writeTimer.current = null;
      }
      await deleteLetter(store, d.letter.id);
      current.current = undefined;
    } else await flush();
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
        { text: "继续写", style: "cancel" },
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
        <Text>这封信已删除。</Text>
      </Page>
    );
  const letter = draft.letter;
  const recordings = letter.mediaIds
    .map((id) => state.media[id] ?? importedMedia[id])
    .filter((m): m is LocalMedia => !!m);
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const seal = () => {
    if (!letter.text.trim()) {
      setError("信还是空的，先写点什么。");
      return;
    }
    if (letter.openAt <= toDayKey(new Date())) {
      setError(PAST_OPEN_AT);
      return;
    }
    Alert.alert(
      "封存这封信？",
      `封存后就不能再改了，到 ${openAtLabel(letter.openAt)} 才能拆。`,
      [
        { text: "再想想", style: "cancel" },
        {
          text: "封存",
          onPress: () => {
            void run(async () => {
              await flush();
              await sealLetter(store, letter.id);
              // 封存后这份草稿不再写回：任何迟到的落盘都会被「信已封存」拒绝。
              current.current = undefined;
              await leave(() =>
                navigation.replace("Letter", { id: letter.id }),
              );
            });
          },
        },
      ],
    );
  };
  const deleteDraft = () =>
    Alert.alert("删除这封信？", "这封信还没封存，删除后无法找回。", [
      { text: "取消", style: "cancel" },
      {
        text: "删除",
        style: "destructive",
        onPress: () => {
          void run(async () => {
            if (current.current?.recordingFile) await discardAudio();
            current.current = undefined;
            await deleteLetter(store, letter.id);
            await leave(() => navigation.goBack());
          });
        },
      },
    ]);
  const discardRecording = () =>
    Alert.alert("放弃录音？", "这段录音不会放进信里。", [
      { text: "取消", style: "cancel" },
      {
        text: "放弃",
        style: "destructive",
        onPress: () => {
          void run(discardAudio);
        },
      },
    ]);
  const input = {
    color: colors.ink,
    fontFamily: serif,
    paddingHorizontal: 0,
  } as const;
  const fromFont = {
    fontFamily: serif,
    fontSize: large ? 19 : 16,
    lineHeight: large ? 26 : 22,
    paddingVertical: 12,
  } as const;
  return (
    <Page
      scroll={false}
      title="写一封信"
      // 与编辑页一样：删除收进顶栏右侧一枚垃圾桶，页尾不再多一张卡，整页一屏放下、不上下滑。
      right={
        <IconButton
          label="删除这封信"
          icon="trash"
          testID="letter-delete"
          disabled={busy}
          onPress={deleteDraft}
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
          contentContainerStyle={[s.content, { paddingBottom: 20 }]}
          // 纸铺满键盘收着时的可见高度，键盘弹起时不缩；放得下就不能滑、不回弹，见 useSheetViewport。
          onLayout={(e) => measure(e.nativeEvent.layout.height)}
          onContentSizeChange={(_, h) => setContentHeight(h)}
          scrollEnabled={contentHeight > height + 1}
          alwaysBounceVertical={false}
          overScrollMode="never"
        >
          {/* 一张信纸：拆封日期、标题、正文、录音与落款都写在这张纸上（DESIGN.md「写信」）。 */}
          <Card
            testID="letter-sheet"
            style={{
              minHeight: viewport > 0 ? viewport - 40 : undefined,
              paddingHorizontal: 20,
              paddingTop: 8,
              paddingBottom: 8,
              gap: 0,
            }}
          >
            {/* 页眉：拆封那天，与编辑页的日期同一条强调色小竖条，点开就地改。 */}
            <Pressable
              testID="letter-open-at"
              accessibilityRole="button"
              accessibilityLabel={`拆封日期：${openAtLabel(letter.openAt)}`}
              accessibilityHint="点按修改拆封日期"
              accessibilityState={{ expanded: dateOpen, disabled: busy }}
              disabled={busy}
              hitSlop={6}
              onPress={() => setDateOpen(!dateOpen)}
              style={{
                minHeight: 44,
                justifyContent: "center",
                alignSelf: "flex-start",
              }}
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
                      {openAtLabel(letter.openAt)} 拆封
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
            {dateOpen && (
              <View style={{ gap: 8, paddingBottom: 8 }}>
                <DateTimePicker
                  value={new Date(`${letter.openAt}T00:00:00`)}
                  mode="date"
                  minimumDate={tomorrow}
                  display={Platform.OS === "ios" ? "spinner" : "default"}
                  onChange={(_, date) => {
                    if (Platform.OS !== "ios") setDateOpen(false);
                    if (date) change({ openAt: toDayKey(date) });
                  }}
                />
                {Platform.OS === "ios" && (
                  <Button
                    title="日期选好了"
                    onPress={() => {
                      // 拆封日已过时滚轮停在明天但不触发 onChange：按看到的那天记下。
                      if (letter.openAt < toDayKey(tomorrow))
                        change({ openAt: toDayKey(tomorrow) });
                      setDateOpen(false);
                    }}
                  />
                )}
              </View>
            )}
            {/* 标题与正文直接写在纸上：无框、衬线；说明留给占位句与封存前的确认。 */}
            <TextInput
              testID="letter-title"
              accessibilityLabel="标题"
              placeholder="给十八岁的你"
              placeholderTextColor={colors.muted}
              value={letter.title}
              maxLength={LETTER_TITLE_LIMIT}
              editable={!busy}
              onChangeText={(title) => change({ title }, true)}
              style={[
                input,
                {
                  fontSize: large ? 23 : 20,
                  fontWeight: "600",
                  paddingTop: 4,
                  paddingBottom: 8,
                },
              ]}
            />
            <TextInput
              testID="letter-text"
              accessibilityLabel="正文"
              placeholder="写给多年后的她。此刻想对她说的话…"
              placeholderTextColor={colors.muted}
              value={letter.text}
              maxLength={LETTER_TEXT_LIMIT}
              editable={!busy}
              multiline
              textAlignVertical="top"
              onChangeText={(text) => change({ text }, true)}
              style={[
                input,
                {
                  flexGrow: 1,
                  minHeight: 132,
                  paddingTop: 4,
                  paddingBottom: 12,
                  fontSize: large ? 20 : 17,
                  lineHeight: large ? 32 : 28,
                },
              ]}
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
                    void run(finishAudio);
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
            {recordings.map((media, i) => (
              <View
                key={media.id}
                style={[s.row, { flexWrap: "nowrap", gap: 0 }]}
              >
                <Text style={[s.muted, { flex: 1, minWidth: 0 }]}>
                  录音 {i + 1}
                </Text>
                <Button
                  title="听一下"
                  kind="text"
                  compact
                  disabled={busy || recording}
                  onPress={() => navigation.navigate("Media", { id: media.id })}
                />
                <Button
                  title="去掉"
                  kind="text"
                  danger
                  compact
                  disabled={busy || recording}
                  onPress={() =>
                    // 去掉后这段录音不在任何地方引用，清理素材时会被删掉：先问一句。
                    Alert.alert("去掉这段录音？", "去掉后信里就没有这段录音了。", [
                      { text: "取消", style: "cancel" },
                      {
                        text: "去掉",
                        style: "destructive",
                        onPress: () => {
                          const ids = current.current?.letter.mediaIds;
                          if (ids)
                            change({
                              mediaIds: ids.filter((id) => id !== media.id),
                            });
                        },
                      },
                    ])
                  }
                />
              </View>
            ))}
            {!!error && (
              <View style={{ paddingBottom: 4 }}>
                <ErrorText message={error} />
                {permDenied && (
                  <View style={[s.row, { marginLeft: -8 }]}>
                    <Button
                      title="去系统设置开启"
                      kind="text"
                      compact
                      onPress={() => {
                        setPermDenied(false);
                        void Linking.openSettings();
                      }}
                    />
                  </View>
                )}
              </View>
            )}
            {/* 页脚一行：左边「录一段话」，右边落款「—— 妈妈」，落款直接写在纸上。 */}
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                minHeight: 52,
              }}
            >
              <View style={{ marginLeft: -8 }}>
                <Button
                  title={recording ? "录完了" : "录一段话"}
                  icon="microphone"
                  kind="text"
                  compact
                  testID="letter-record"
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
              </View>
              <View
                style={{
                  flex: 1,
                  minWidth: 0,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "flex-end",
                  gap: 6,
                }}
              >
                <Text style={[fromFont, { color: colors.ink }]}>——</Text>
                {/* 落款框随字宽：底下一行看不见的同款字撑出宽度，输入框盖在上面，「—— 妈妈」贴着右边。 */}
                <View style={{ flexShrink: 1, minWidth: 48 }}>
                  <Text
                    numberOfLines={1}
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    style={[fromFont, { opacity: 0, paddingRight: 4 }]}
                  >
                    {letter.from || "落款"}
                  </Text>
                  <TextInput
                    testID="letter-from"
                    accessibilityLabel="落款"
                    placeholder="落款"
                    placeholderTextColor={colors.muted}
                    value={letter.from}
                    // 与撑宽度的那行字同一个放大上限，否则大字号下框比字窄、落款被切。
                    maxFontSizeMultiplier={1.6}
                    maxLength={LETTER_FROM_LIMIT}
                    editable={!busy}
                    onChangeText={(from) => change({ from }, true)}
                    style={[
                      input,
                      fromFont,
                      StyleSheet.absoluteFill,
                      { paddingVertical: 0 },
                    ]}
                  />
                </View>
              </View>
            </View>
          </Card>
        </ScrollView>
        <BottomBar>
          <View style={s.row}>
            <Button
              title="保存草稿"
              testID="letter-save"
              disabled={busy || recording}
              onPress={() => {
                void run(() => leave(() => navigation.goBack()));
              }}
            />
            <Button
              title="封存"
              icon="seal"
              primary
              testID="letter-seal"
              disabled={busy || recording || !!draft.recordingFile}
              onPress={seal}
            />
          </View>
        </BottomBar>
      </KeyboardAvoidingView>
    </Page>
  );
}
