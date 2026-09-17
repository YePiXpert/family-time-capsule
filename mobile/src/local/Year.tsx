import { useMemo } from "react";
import { Alert, Pressable, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { randomUUID } from "expo-crypto";
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
import { recapContext } from "../ai/state";
import { api, getToken, hasConsent, giveConsent } from "../ai/client";
import {
  Button,
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
    store = useStore(),
    nav = useNav();
  const note = state.yearNotes[year] ?? "";
  return (
    <NoteCard
      heading="爸爸妈妈的话"
      placeholder="写几句想对她说的话…"
      emptyHint="这一年快要过去时，留几句想对她说的话。"
      note={note}
      testPrefix="year-note"
      onSave={async (value) => {
        await store.change((s) => {
          if (value) s.yearNotes[year] = value;
          else delete s.yearNotes[year];
        });
      }}
      assist={{
        generate: async () => {
          if (!(await getToken())) {
            nav.navigate("AISettings");
            throw new Error("先在「AI 设置」加入服务，再来起草寄语。");
          }
          if (!(await hasConsent())) {
            const agreed = await new Promise<boolean>((resolve) =>
              Alert.alert(
                "用 AI 起草寄语",
                "起草会把这一年的记录标题和「第一次」清单（纯文字，不含照片与精确位置）经主人的服务发送给 DeepSeek Flash High，结果由你核对修改后才保存。",
                [
                  { text: "取消", style: "cancel", onPress: () => resolve(false) },
                  {
                    text: "同意并继续",
                    onPress: () => {
                      void giveConsent()
                        .then(() => resolve(true))
                        .catch(() => resolve(false));
                    },
                  },
                ],
              ),
            );
            if (!agreed) throw new Error("没有开始起草。");
          }
          const records = sortedRecords(state).filter(
            (r) => yearKey(r.date) === year,
          );
          if (!records.length)
            throw new Error("这一年还没有记录，写下几句后再让 AI 帮忙。");
          const result = await api<{ title: string; text: string }>(
            "/ai/write",
            {
              requestId: randomUUID(),
              photos: [],
              context: recapContext(records, note),
              writingMode: "recap",
            },
            "POST",
          );
          if (typeof result.text !== "string" || !result.text.trim())
            throw new Error("AI 草稿不完整，请重试。");
          return result.text.trim().slice(0, 2000);
        },
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
      <Button
        title="这一年回顾"
        testID="year-recap"
        onPress={() => nav.navigate("Recap", { year })}
      />
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
