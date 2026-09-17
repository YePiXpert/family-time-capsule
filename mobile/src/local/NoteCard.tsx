import { useState } from "react";
import { View } from "react-native";
import {
  Button,
  ErrorText,
  Field,
  Glass,
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
  assist?: { generate: () => Promise<string> };
}) {
  const s = useStyles(),
    { colors } = useTheme();
  const [editing, setEditing] = useState(false),
    [draft, setDraft] = useState(note),
    [busy, setBusy] = useState(false),
    [assistBusy, setAssistBusy] = useState(false),
    [error, setError] = useState("");
  const save = () => {
    setBusy(true);
    setError("");
    void onSave(draft.trim())
      .then(() => setEditing(false))
      .catch((e) => setError(messageOf(e)))
      .finally(() => setBusy(false));
  };
  const draftWithAI = () => {
    if (!assist) return;
    setAssistBusy(true);
    setError("");
    void assist
      .generate()
      .then((text) => setDraft(text))
      .catch((e) => setError(messageOf(e)))
      .finally(() => setAssistBusy(false));
  };
  return (
    <Glass radius={16} style={{ padding: 16, gap: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <JournalIcon name="heart" color={colors.accent} size={18} />
        <Text style={s.heading}>{heading}</Text>
      </View>
      {editing ? (
        <>
          <Field
            label={heading}
            hideLabel
            placeholder={placeholder}
            value={draft}
            onChangeText={setDraft}
            multiline
            maxLength={NOTE_LIMIT}
            testID={`${testPrefix}-input`}
            style={{ minHeight: 120, textAlignVertical: "top" }}
          />
          <Text style={s.muted}>
            {draft.trim().length} / {NOTE_LIMIT} 字
          </Text>
          <ErrorText message={error} />
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
                setDraft(note);
                setEditing(false);
                setError("");
              }}
            />
          </View>
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
                setDraft(note);
                setEditing(true);
              }}
            />
          </View>
        </>
      )}
    </Glass>
  );
}
