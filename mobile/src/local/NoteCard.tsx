import { useEffect, useRef, useState } from "react";
import { Alert, View } from "react-native";
import {
  Button,
  Card,
  ErrorText,
  Field,
  Text,
  messageOf,
  useStyles,
  useTheme,
} from "./ui";
import { JournalIcon } from "../components/JournalIcon";

const NOTE_LIMIT = 2000;

/** 「爸爸妈妈的话」扉页寄语卡：年度册与相册共用；空值由调用方决定删除语义。 */
export function NoteCard({
  heading,
  placeholder,
  emptyHint,
  note,
  testPrefix,
  onSave,
  assist,
}: {
  heading: string;
  placeholder: string;
  emptyHint: string;
  note: string;
  testPrefix: string;
  /** 收到去除首尾空白后的内容；空串由调用方落实为删除。 */
  onSave: (value: string) => Promise<void>;
  /** 可选的 AI 起草：返回草稿文本，由用户核对后再保存。 */
  assist?: { generate: (signal: AbortSignal) => Promise<string> };
}) {
  const s = useStyles(),
    { colors } = useTheme();
  const [editing, setEditing] = useState(false),
    [draft, setDraft] = useState(note),
    [busy, setBusy] = useState(false),
    [assistBusy, setAssistBusy] = useState(false),
    [error, setError] = useState("");
  const draftRef = useRef(note);
  const request = useRef<AbortController | null>(null);
  const updateDraft = (value: string) => {
    draftRef.current = value;
    setDraft(value);
  };
  const cancelAssist = () => {
    request.current?.abort();
    request.current = null;
    setAssistBusy(false);
  };
  useEffect(
    () => () => {
      request.current?.abort();
      request.current = null;
    },
    [],
  );
  const save = () => {
    cancelAssist();
    setBusy(true);
    setError("");
    void onSave(draft.trim())
      .then(() => setEditing(false))
      .catch((e) => setError(messageOf(e)))
      .finally(() => setBusy(false));
  };
  const draftWithAI = () => {
    if (!assist) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const snapshot = draftRef.current;
    // 即使底层请求晚到，取消、卸载或新一轮起草后也不能再写入。
    const active = () =>
      request.current === controller && !controller.signal.aborted;
    setAssistBusy(true);
    setError("");
    void assist
      .generate(controller.signal)
      .then((text) => {
        if (!active()) return;
        // 框里还是存好的那段（或空着）才直接填：取消能回到存好的寄语，没有字会丢。
        // 点起草前刚写、还没保存的字，和等待时改的一样，先问再换。
        const unsaved =
          draftRef.current.trim() !== "" && draftRef.current !== note;
        if (draftRef.current === snapshot && !unsaved) {
          updateDraft(text);
          return;
        }
        Alert.alert(
          "寄语有了新内容",
          draftRef.current === snapshot
            ? "框里有你刚写、还没保存的字，要换成 AI 这版吗？"
            : "你在等待时改了寄语，要用哪一版？",
          [
            { text: "保留我写的", style: "cancel" },
            {
              text: "用 AI 这版",
              onPress: () => {
                if (active()) updateDraft(text);
              },
            },
          ],
        );
      })
      .catch((e) => {
        if (active()) setError(messageOf(e));
      })
      .finally(() => {
        if (active()) setAssistBusy(false);
      });
  };
  return (
    <Card>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <JournalIcon name="heart" color={colors.accent} size={18} />
        <Text style={s.heading}>{heading}</Text>
      </View>
      {editing ? (
        <>
          {/* 多行输入聚焦后键盘会盖住卡片下半部分。动作行放在输入框上方，
              「保存寄语」在键盘弹起时仍然可见可点（DESIGN.md：键盘下主要动作仍可用）。 */}
          <View style={s.row}>
            <Button
              title="保存寄语"
              primary
              compact
              testID={`${testPrefix}-save`}
              disabled={busy}
              onPress={save}
            />
            {!!assist && (
              <Button
                title={assistBusy ? "AI 起草中…" : "AI 帮我起草"}
                icon="sparkle"
                compact
                testID={`${testPrefix}-assist`}
                disabled={busy || assistBusy}
                onPress={draftWithAI}
              />
            )}
            <Button
              title="取消"
              compact
              disabled={busy}
              onPress={() => {
                cancelAssist();
                updateDraft(note);
                setEditing(false);
                setError("");
              }}
            />
          </View>
          <ErrorText message={error} />
          <Text style={s.muted}>
            {draft.trim().length} / {NOTE_LIMIT} 字
          </Text>
          <Field
            label={heading}
            hideLabel
            placeholder={placeholder}
            value={draft}
            onChangeText={updateDraft}
            multiline
            maxLength={NOTE_LIMIT}
            testID={`${testPrefix}-input`}
            style={{ minHeight: 120, textAlignVertical: "top" }}
          />
        </>
      ) : (
        <>
          {note ? (
            <Text selectable>{note}</Text>
          ) : (
            <Text style={s.muted}>{emptyHint}</Text>
          )}
          <View style={s.row}>
            <Button
              title={note ? "修改寄语" : "写下寄语"}
              compact
              testID={`${testPrefix}-edit`}
              onPress={() => {
                updateDraft(note);
                setEditing(true);
              }}
            />
          </View>
        </>
      )}
    </Card>
  );
}
