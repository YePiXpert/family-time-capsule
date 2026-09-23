import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  AppState,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import { usePreventRemove } from "@react-navigation/native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useLibrary, useStore } from "./context";
import { useRecorder } from "./editorHooks";
import { isEmptyLetter } from "./empties";
import { toDayKey } from "./dates";
import { openAtLabel } from "./letters";
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
  ErrorText,
  Field,
  Page,
  Text,
  messageOf,
  serif,
  useKeyboardBarOffset,
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
    keyboardOffset = useKeyboardBarOffset();
  const stored = state.letters[route.params.id];
  const initial: LetterDraft | undefined = stored
    ? { letter: stored }
    : undefined;
  const [draft, setDraft] = useState(initial),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [dateOpen, setDateOpen] = useState(false),
    [allowExit, setAllowExit] = useState(false),
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
    try {
      await fn();
    } catch (e) {
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
  return (
    <Page scroll={false} title="写一封信">
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
          <Text style={s.muted}>
            写给多年后的她。封存以后，要到拆封那天才能打开。
          </Text>
          <Field
            label="标题"
            testID="letter-title"
            placeholder="给十八岁的你"
            value={letter.title}
            maxLength={LETTER_TITLE_LIMIT}
            editable={!busy}
            onChangeText={(title) => change({ title }, true)}
            style={{ fontFamily: serif, fontSize: large ? 21 : 18 }}
          />
          <Field
            label="正文"
            hideLabel
            testID="letter-text"
            placeholder="此刻想对你说的话…"
            value={letter.text}
            maxLength={LETTER_TEXT_LIMIT}
            editable={!busy}
            multiline
            textAlignVertical="top"
            onChangeText={(text) => change({ text }, true)}
            style={{
              minHeight: 220,
              fontFamily: serif,
              lineHeight: large ? 30 : 27,
            }}
          />
          <Field
            label="落款"
            testID="letter-from"
            placeholder="妈妈 / 爸爸"
            value={letter.from}
            maxLength={LETTER_FROM_LIMIT}
            editable={!busy}
            onChangeText={(from) => change({ from }, true)}
          />
          <View style={s.between}>
            <Text style={s.muted}>拆封日期</Text>
            <Button
              title={openAtLabel(letter.openAt)}
              icon="calendar"
              testID="letter-open-at"
              disabled={busy}
              onPress={() => setDateOpen(!dateOpen)}
            />
          </View>
          {dateOpen && (
            <>
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
                <Button title="日期选好了" onPress={() => setDateOpen(false)} />
              )}
            </>
          )}
          <View style={s.row}>
            <Button
              title={recording ? "完成录音" : "录一段话"}
              icon="microphone"
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
                  Alert.alert("放弃录音？", "这段录音不会放进信里。", [
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
          {recordings.map((media, i) => (
            <View key={media.id} style={s.between}>
              <Text>录音 {i + 1}</Text>
              <View style={s.row}>
                <Button
                  title="听一下"
                  icon="audio"
                  compact
                  disabled={busy || recording}
                  onPress={() => navigation.navigate("Media", { id: media.id })}
                />
                <Button
                  title="去掉"
                  compact
                  disabled={busy || recording}
                  onPress={() =>
                    change({
                      mediaIds: letter.mediaIds.filter((id) => id !== media.id),
                    })
                  }
                />
              </View>
            </View>
          ))}
          <ErrorText message={error} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="删除这封信"
            testID="letter-delete"
            disabled={busy}
            onPress={() =>
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
              ])
            }
            style={({ pressed }) => ({
              alignSelf: "center",
              minHeight: 44,
              justifyContent: "center",
              paddingHorizontal: 16,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Text style={[s.muted, { color: colors.muted }]}>删除这封信</Text>
          </Pressable>
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
