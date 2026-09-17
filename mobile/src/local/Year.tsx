import { useMemo } from "react";
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
import { NoteCard } from "./NoteCard";
import {
  Ornament,
  Page,
  Text,
  dateLabel,
  monthLabel,
  serif,
  useStyles,
  useTheme,
} from "./ui";

function YearNote({ year }: { year: string }) {
  const state = useLibrary(),
    store = useStore();
  return (
    <NoteCard
      heading="爸爸妈妈的话"
      placeholder="写几句想对她说的话…"
      emptyHint="这一年快要过去时，留几句想对她说的话。"
      note={state.yearNotes[year] ?? ""}
      testPrefix="year-note"
      onSave={async (value) => {
        await store.change((s) => {
          if (value) s.yearNotes[year] = value;
          else delete s.yearNotes[year];
        });
      }}
    />
  );
}

export function Year({ route }: Props<"Year">) {
  const state = useLibrary(),
    nav = useNav(),
    s = useStyles(),
    { large } = useTheme();  const { width, fontScale } = useWindowDimensions(),
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
    <Page>
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
