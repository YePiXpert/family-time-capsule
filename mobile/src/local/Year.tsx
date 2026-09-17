import { useMemo, useState } from "react";
import { Pressable, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLibrary, useStore } from "./context";
import {
  monthKey,
  recordTitle,
  sortedRecords,
  yearKey,
} from "./model";
import { useNav, type Props } from "./navigation";
import { coverForRecords, Volume } from "./Shelf";
import {
  Button,
  ErrorText,
  Field,
  Glass,
  Ornament,
  Page,
  Text,
  dateLabel,
  messageOf,
  monthLabel,
  serif,
  useStyles,
  useTheme,
} from "./ui";
import { JournalIcon } from "../components/JournalIcon";

const NOTE_LIMIT = 2000;

function YearNote({ year }: { year: string }) {
  const state = useLibrary(),
    store = useStore(),
    s = useStyles(),
    { colors } = useTheme();
  const note = state.yearNotes[year] ?? "";
  const [editing, setEditing] = useState(false),
    [draft, setDraft] = useState(note),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const save = () => {
    setBusy(true);
    setError("");
    void store
      .change((s) => {
        const value = draft.trim();
        if (value) s.yearNotes[year] = value;
        else delete s.yearNotes[year];
      })
      .then(() => setEditing(false))
      .catch((e) => setError(messageOf(e)))
      .finally(() => setBusy(false));
  };
  return (
    <Glass radius={16} style={{ padding: 16, gap: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <JournalIcon name="heart" color={colors.accent} size={18} />
        <Text style={s.heading}>爸爸妈妈的话</Text>
      </View>
      {editing ? (
        <>
          <Field
            label="年度寄语"
            hideLabel
            placeholder="写几句想对她说的话…"
            value={draft}
            onChangeText={setDraft}
            multiline
            maxLength={NOTE_LIMIT}
            testID="year-note-input"
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
              testID="year-note-save"
              disabled={busy}
              onPress={save}
            />
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
            <Text>{note}</Text>
          ) : (
            <Text style={s.muted}>
              这一年快要过去时，留几句想对她说的话。
            </Text>
          )}
          <View style={s.row}>
            <Button
              title={note ? "修改寄语" : "写下这一年的话"}
              compact
              testID="year-note-edit"
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

export function Year({ route }: Props<"Year">) {
  const state = useLibrary(),
    nav = useNav(),
    s = useStyles(),
    { large } = useTheme();
  const { width, fontScale } = useWindowDimensions(),
    insets = useSafeAreaInsets();
  const year = route.params.year;
  const records = useMemo(
    () => sortedRecords(state).filter((r) => yearKey(r.date) === year),
    [state, year],
  );
  const firsts = records
    .filter((r) => r.first)
    .sort((a, b) => a.date.localeCompare(b.date));
  const months = [...new Set(records.map((r) => monthKey(r.date)))];
  const photos = records.reduce(
    (n, r) =>
      n + r.mediaIds.filter((id) => state.media[id]?.kind === "image").length,
    0,
  );
  const av = records.reduce(
    (n, r) =>
      n +
      r.mediaIds.filter((id) => {
        const kind = state.media[id]?.kind;
        return kind === "video" || kind === "audio";
      }).length,
    0,
  );
  const chars = records.reduce(
    (n, r) => n + r.title.trim().length + r.text.trim().length,
    0,
  );
  const columns = large || fontScale >= 1.4 ? 1 : 2;
  const volumeWidth =
    (width - insets.left - insets.right - 40 - 16 * (columns - 1)) / columns;
  const stats = [
    `${records.length} 段时光`,
    photos ? `${photos} 张照片` : "",
    av ? `${av} 段影音` : "",
    firsts.length ? `${firsts.length} 个第一次` : "",
    chars ? `共 ${chars} 字` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <Page top>
      <Text style={s.title}>{year} 年</Text>
      {!!stats && <Text style={s.muted}>{stats}</Text>}
      <YearNote year={year} />
      {firsts.length > 0 && (
        <View style={{ gap: 12 }}>
          <Text style={[s.muted, { fontFamily: serif }]}>这一年的第一次</Text>
          {firsts.map((record) => (
            <Pressable
              key={record.id}
              testID={`year-first-${record.id}`}
              accessibilityRole="button"
              accessibilityLabel={`${recordTitle(record)}，${dateLabel(record.date)}`}
              onPress={() => nav.navigate("Record", { id: record.id })}
              style={[s.compactPanel, { paddingVertical: 12 }]}
            >
              <Text style={s.muted}>{dateLabel(record.date)}</Text>
              <Text style={s.heading}>{recordTitle(record)}</Text>
              {!!record.text.trim() && (
                <Text numberOfLines={2} style={s.muted}>
                  {record.text.trim()}
                </Text>
              )}
            </Pressable>
          ))}
        </View>
      )}
      {months.length > 0 && (
        <View style={{ gap: 16 }}>
          <Text style={[s.muted, { fontFamily: serif }]}>这一年的月册</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 16 }}>
            {months.map((m, i) => {
              const monthRecords = records.filter(
                (r) => monthKey(r.date) === m,
              );
              return (
                <Volume
                  key={m}
                  title={monthLabel(m)}
                  caption={`${monthRecords.length} 段时光`}
                  cover={coverForRecords(monthRecords, state.media)}
                  testID={`year-volume-${m}`}
                  width={volumeWidth}
                  index={i}
                  onPress={() => nav.navigate("Month", { month: m })}
                />
              );
            })}
          </View>
        </View>
      )}
      {records.length === 0 && (
        <View style={s.empty}>
          <Text style={s.heading}>这一年还没有记录</Text>
          <Text style={s.muted}>回到书架，点右下角的笔，从这一刻开始。</Text>
        </View>
      )}
      <Ornament />
    </Page>
  );
}
