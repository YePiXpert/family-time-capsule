import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Svg } from "react-native-svg";
import { randomUUID } from "expo-crypto";
import { useLibrary, useStore } from "./context";
import {
  monthKey,
  recordsOfPerson,
  recordTitle,
  sortedRecords,
  yearKey,
} from "./model";
import { useNav, type Props } from "./navigation";
import { coverForRecords, Volume } from "./Shelf";
import { NoteCard } from "./NoteCard";
import { ReplayModal } from "./RecapScreen";
import { replayPhotos } from "./replay";
import { YearBookCard, type YearbookPhoto } from "./YearBookCard";
import {
  prepareKeepSakePhoto,
  exportKeepSakeCard,
  exportYearBookPdf,
} from "./KeepSakeCard";
import type { YearbookInput } from "./yearbook";
import { recapContext } from "../ai/state";
import { api, getToken, hasConsent, giveConsent } from "../ai/client";
import {
  Button,
  Card,
  ErrorText,
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
  const [replayOpen, setReplayOpen] = useState(false),
    [person, setPerson] = useState(""),
    [bookBusy, setBookBusy] = useState(false),
    [bookFormat, setBookFormat] = useState<"image" | "pdf">("image"),
    [error, setError] = useState("");
  const bookRef = useRef<Svg | null>(null);
  const [book, setBook] = useState<{
    input: YearbookInput;
    photos: { cover?: YearbookPhoto; months: (YearbookPhoto | undefined)[] };
  } | null>(null);
  const records = useMemo(
    () => sortedRecords(state).filter((r) => yearKey(r.date) === year),
    [state, year],
  );
  const replay = useMemo(
    () => replayPhotos(records, state.media),
    [records, state.media],
  );
  const personList = Object.values(state.persons).sort((a, b) =>
    a.name.localeCompare(b.name, "zh"),
  );
  const visibleRecords = person
    ? recordsOfPerson(records, person)
    : records;
  const firsts = visibleRecords
    .filter((r) => r.first)
    .sort((a, b) => a.date.localeCompare(b.date));
  const months = [...new Set(visibleRecords.map((r) => monthKey(r.date)))];
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
  const columns = large || fontScale >= 1.3 ? 1 : 2;
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
  const monthKeys = Array.from(
    { length: 12 },
    (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`,
  );
  const makeYearbook = async (format: "image" | "pdf") => {
    setBookFormat(format);
    setBookBusy(true);
    setError("");
    try {
      const coverPhoto = await prepareKeepSakePhoto(
        coverForRecords(records, state.media),
      );
      const monthPhotos: (YearbookPhoto | undefined)[] = [];
      for (const key of monthKeys) {
        const monthRecords = records.filter((r) => monthKey(r.date) === key);
        monthPhotos.push(
          await prepareKeepSakePhoto(
            coverForRecords(monthRecords, state.media),
            400,
          ),
        );
      }
      setBook({
        input: {
          year,
          profileName: state.profile.name,
          stats,
          note: state.yearNotes[year] ?? "",
          months: monthKeys.map((key, index) => ({
            label: monthLabel(key),
            count: records.filter((r) => monthKey(r.date) === key).length,
            photoAspect: monthPhotos[index]?.aspect,
          })),
          firsts: records
            .filter((r) => r.first)
            .sort((a, b) => a.date.localeCompare(b.date))
            .map((r) => ({ title: recordTitle(r), date: dateLabel(r.date) })),
          colophon: `${year} 年`,
          coverAspect: coverPhoto?.aspect,
        },
        photos: { cover: coverPhoto, months: monthPhotos },
      });
    } catch (e) {
      setError(messageOf(e));
      setBookBusy(false);
    }
  };
  useEffect(() => {
    if (!book || !bookBusy) return;
    let cancelled = false;
    // 两帧之后再取图，确保离屏 Svg 完成布局与位图合成。
    const first = requestAnimationFrame(() =>
      requestAnimationFrame(async () => {
        if (cancelled) return;
        try {
          const name = `yearbook-${year}`;
          if (bookFormat === "pdf")
            await exportYearBookPdf(bookRef.current, name);
          else await exportKeepSakeCard(bookRef.current, name);
        } catch (e) {
          setError(messageOf(e));
        } finally {
          setBookBusy(false);
          setBook(null);
        }
      }),
    );
    return () => {
      cancelled = true;
      cancelAnimationFrame(first);
    };
  }, [book, bookBusy, bookFormat, year]);
  return (
    <Page>
      <Text style={s.title}>{year} 年</Text>
      {!!stats && <Text style={s.muted}>{stats}</Text>}
      <View style={s.row}>
        <Button
          title="这一年回顾"
          testID="year-recap"
          onPress={() => nav.navigate("Recap", { year })}
        />
        <Button
          title={replay.length ? "重放这一年" : "这一年没有照片"}
          testID="year-replay"
          disabled={!replay.length}
          onPress={() => setReplayOpen(true)}
        />
      </View>
      <Button
        title={bookBusy ? "正在装订这一年的成长册…" : "导出成长册"}
        testID="year-yearbook"
        disabled={bookBusy || records.length === 0}
        onPress={() =>
          Alert.alert("导出成长册", "长图适合分享，PDF 按 A4 分页，适合打印成册。", [
            { text: "取消", style: "cancel" },
            { text: "长图", onPress: () => void makeYearbook("image") },
            { text: "可打印 PDF", onPress: () => void makeYearbook("pdf") },
          ])
        }
      />
      {records.length === 0 && !bookBusy && (
        <Text style={s.muted}>这一年还没有记录，先记下几段时光。</Text>
      )}
      <ErrorText message={error} />
      {replayOpen && <ReplayModal year={year} onClose={() => setReplayOpen(false)} />}
      {personList.length > 0 && (
        <View style={s.row}>
          <Button
            title="全部人物"
            compact
            selected={!person}
            onPress={() => setPerson("")}
          />
          {personList.map((p) => (
            <Button
              key={p.id}
              compact
              title={p.name}
              selected={person === p.id}
              onPress={() => setPerson(person === p.id ? "" : p.id)}
            />
          ))}
        </View>
      )}
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
            >
              <Card compact style={{ paddingVertical: 12 }}>
                <Text style={s.muted}>{dateLabel(record.date)}</Text>
                <Text style={s.heading}>{recordTitle(record)}</Text>
                {!!record.text.trim() && (
                  <Text numberOfLines={2} style={s.muted}>
                    {record.text.trim()}
                  </Text>
                )}
              </Card>
            </Pressable>
          ))}
        </View>
      )}
      {months.length > 0 && (
        <View style={{ gap: 16 }}>
          <Text style={[s.muted, { fontFamily: serif }]}>这一年的月册</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 16 }}>
            {months.map((m, i) => {
              const monthRecords = visibleRecords.filter(
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
      {book && (
        <View
          pointerEvents="none"
          style={{ position: "absolute", left: -10000, top: 0, opacity: 0 }}
        >
          <YearBookCard
            ref={bookRef}
            input={book.input}
            photos={book.photos}
            profileName={state.profile.name}
          />
        </View>
      )}
    </Page>
  );
}
