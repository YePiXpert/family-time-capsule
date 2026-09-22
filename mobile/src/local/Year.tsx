import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, View } from "react-native";
import type { Svg } from "react-native-svg";
import { randomUUID } from "expo-crypto";
import { useLibrary, useStore } from "./context";
import { now } from "./services";
import {
  monthKey,
  recordsOfPerson,
  recordTitle,
  sortedRecords,
  yearKey,
  type LocalRecord,
  type Stored,
  type YearPicks,
} from "./model";
import { useNav, type Props } from "./navigation";
import { coverForRecords, Volume } from "./Shelf";
import { NoteCard } from "./NoteCard";
import { ReplayModal } from "./RecapScreen";
import { replayPhotos } from "./replay";
import { byCountsOf, byLine } from "./recap";
import { YearBookCard, type YearbookPhoto } from "./YearBookCard";
import { prepareKeepSakePhoto, exportKeepSakeCard } from "./KeepSakeCard";
import { yearBookInput, yearBookMonth, type YearbookInput } from "./yearbook";
import { planBook, useBookBinder } from "./BookBinder";
import { BookPreview } from "./BookPreview";
import type { BookLayout, BookPhoto } from "./book";
import { PhotoPicker } from "./PhotoPicker";
import { CHILD_FALLBACK } from "./brand";
import { AI_CONSENT_TEXT } from "../ai/consent";
import { applyYearPicks, checkEditorResult, editorContext, recapContext } from "../ai/state";
import { api, getToken, hasConsent, giveConsent } from "../ai/client";
import {
  Button,
  Card,
  ErrorText,
  Ornament,
  Page,
  SectionHeader,
  PersonChips,
  Stamp,
  Text,
  dateLabel,
  messageOf,
  monthLabel,
  serif,
  useStyles,
  useTheme,
  useVolumeWidth,
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
        generate: async (signal) => {
          const token = await getToken();
          if (signal.aborted) throw new Error("已停止起草。");
          if (!token) {
            nav.navigate("AISettings");
            throw new Error("先在「AI 设置」加入服务，再来起草寄语。");
          }
          if (!(await hasConsent())) {
            const agreed = await new Promise<boolean>((resolve) =>
              Alert.alert(
                "用 AI 起草寄语",
                AI_CONSENT_TEXT,
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
          if (signal.aborted) throw new Error("已停止起草。");
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
              context: recapContext(records, note, records.filter((r) => r.quote).map((r) => r.text.trim().split(/\n\s*\n/)[0]?.trim() || r.title)),
              writingMode: "recap",
            },
            "POST",
            signal,
          );
          if (typeof result.text !== "string" || !result.text.trim())
            throw new Error("AI 草稿不完整，请重试。");
          return result.text.trim().slice(0, 2000);
        },
      }}
    />
  );
}

/** 整年正文只有这里在两次同意之后发送；建议在采用之前只留在页面 state。 */
export function YearEditor({ year, records }: { year: string; records: readonly Stored<LocalRecord>[] }) {
  const state = useLibrary(), store = useStore(), nav = useNav(), s = useStyles();
  const [preview, setPreview] = useState<YearPicks | null>(null);
  const [busy, setBusy] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => { request.current?.abort(); request.current = null; }, []);
  const stop = () => { request.current?.abort(); request.current = null; setBusy(false); };
  const saved = state.yearPicks?.[year];
  const applied = applyYearPicks(saved, records);
  const byId = new Map(records.map((r) => [r.id, r]));
  const suggest = async () => {
    if (request.current || !records.length) return;
    const controller = new AbortController();
    request.current = controller;
    const active = () => request.current === controller && !controller.signal.aborted;
    setBusy(true);
    setError("");
    try {
      const token = await getToken();
      if (!active()) return;
      if (!token) {
        nav.navigate("AISettings");
        throw new Error("先在「AI 设置」加入服务，再来建议目录。");
      }
      const consent = await hasConsent();
      if (!active()) return;
      if (!consent) {
        const agreed = await new Promise<boolean>((resolve) => Alert.alert(
          "用 AI 建议目录", AI_CONSENT_TEXT, [
            { text: "取消", style: "cancel", onPress: () => resolve(false) },
            { text: "同意并继续", onPress: () => { void giveConsent().then(() => resolve(true)).catch(() => resolve(false)); } },
          ], { cancelable: true, onDismiss: () => resolve(false) },
        ));
        if (!agreed || !active()) return;
      }
      const send = await new Promise<boolean>((resolve) => Alert.alert(
        "送整年文字给 AI？",
        `会把 ${year} 年全部 ${records.length} 段时光的标题、正文、落款和日期（不含照片、不含别的年份）经主人的服务发送给 AI，只用来建议目录，服务端不保存；结果你可以逐条改。计一次写作额度。${records.length > 400 ? "记录较多，本次只送最新 400 段。" : ""}`,
        [
          { text: "取消", style: "cancel", onPress: () => resolve(false) },
          { text: "发送", onPress: () => resolve(true) },
        ], { cancelable: true, onDismiss: () => resolve(false) },
      ));
      if (!send || !active()) return;
      const context = editorContext(year, records, state.media);
      const result = await api<unknown>("/ai/write", {
        requestId: randomUUID(), photos: [], context, writingMode: "editor",
      }, "POST", controller.signal);
      if (!active()) return;
      // 只接受确实送去的记录，超过 400 条时不能让旧服务选中未发送的 id。
      const sentIds = new Set<string>((JSON.parse(context) as { records: { id: string }[] }).records.map((r) => r.id));
      setPreview(checkEditorResult(result, year, records.filter((r) => sentIds.has(r.id))));
    } catch (e) {
      if (active()) setError(messageOf(e));
    } finally {
      if (active()) { request.current = null; setBusy(false); }
    }
  };
  const save = async (picks: YearPicks | null) => {
    setSaving(true);
    setError("");
    try {
      await store.change((lib) => {
        if (picks) lib.yearPicks = { ...lib.yearPicks, [year]: { ...picks, updatedAt: now() } };
        else if (lib.yearPicks) {
          delete lib.yearPicks[year];
          if (!Object.keys(lib.yearPicks).length) delete lib.yearPicks;
        }
      });
      setPreview(null);
    } catch (e) { setError(messageOf(e)); }
    finally { setSaving(false); }
  };
  const remove = (month: string, id?: string) => setPreview((current) => {
    if (!current) return current;
    const months = { ...current.months }, entry = months[month];
    if (!entry) return current;
    if (id) {
      const recordIds = entry.recordIds.filter((value) => value !== id);
      if (recordIds.length) months[month] = { ...entry, recordIds };
      else delete months[month];
    } else months[month] = { recordIds: entry.recordIds };
    return { ...current, months };
  });
  return (
    <View style={{ gap: 12 }}>
      <Text style={s.heading}>目录</Text>
      {saved ? (
        <>
          <Text style={s.muted}>目录：AI 建议、你拍板过（{Object.values(saved.months).reduce((n, m) => n + m.recordIds.length, 0)} 条 · {Object.values(saved.months).filter((m) => m.quote).length} 句引语）</Text>
          <Button title="清除目录" kind="text" compact testID="year-editor-clear" disabled={busy || saving} onPress={() => { void save(null); }} />
          {applied && (applied.droppedRecords > 0 || applied.droppedQuotes > 0) && (
            <Text style={s.muted}>有 {applied.droppedRecords} 条记录已删、{applied.droppedQuotes} 句引语与原文对不上，装订时略去；可以重新让 AI 建议。</Text>
          )}
        </>
      ) : (
        <Text style={s.muted}>AI 可以按这一年的记录建议一份目录：每月挑 1～3 条进正文、每章一句她或你们的原话做引语、起一个书名；你拍板。</Text>
      )}
      {!preview && (
        <View style={s.row}>
          <Button title={busy ? "正在读这一年…" : "AI 建议目录"} icon="sparkle" compact testID="year-editor-suggest" disabled={busy || saving || records.length === 0} onPress={() => { void suggest(); }} />
          {busy && <Button title="停止" kind="text" compact onPress={stop} />}
        </View>
      )}
      {preview && (
        <View style={{ gap: 12 }} testID="year-editor-preview">
          <Text style={s.heading}>{preview.title}</Text>
          {Object.entries(preview.months).sort(([a], [b]) => a.localeCompare(b)).map(([month, entry]) => (
            <View key={month} style={{ gap: 8 }}>
              <Text style={s.heading}>{monthLabel(month)}</Text>
              {entry.recordIds.map((id) => {
                const record = byId.get(id);
                return (
                  <View key={id} style={s.row}>
                    <Text style={{ flex: 1 }}>{record ? `${recordTitle(record)} · ${dateLabel(record.date)}` : "这段时光已删"}</Text>
                    <Button title="不要" kind="text" compact disabled={saving} onPress={() => remove(month, id)} />
                  </View>
                );
              })}
              {entry.quote && (
                <View style={s.row}>
                  <Text style={[s.muted, { flex: 1 }]}>“{entry.quote.text}” —— 出自《{byId.has(entry.quote.recordId) ? recordTitle(byId.get(entry.quote.recordId)!) : "已删的时光"}》</Text>
                  <Button title="不引" kind="text" compact disabled={saving} onPress={() => remove(month)} />
                </View>
              )}
            </View>
          ))}
          {!!preview.notes && <Text style={s.muted}>{preview.notes}</Text>}
          <Text style={s.muted}>未列进目录的月份会保留全部记录；寄语和第一次清单照旧。</Text>
          <View style={s.row}>
            <Button title="采用这份目录" primary compact testID="year-editor-apply" disabled={saving} onPress={() => { void save(preview); }} />
            <Button title="不用" kind="text" compact disabled={saving} onPress={() => setPreview(null)} />
          </View>
        </View>
      )}
      <ErrorText message={error} />
    </View>
  );
}

export function Year({ route }: Props<"Year">) {
  const state = useLibrary(),
    store = useStore(),
    nav = useNav(),
    s = useStyles(),
    { colors } = useTheme(),
    volumeWidth = useVolumeWidth();
  const year = route.params.year;
  const [replayOpen, setReplayOpen] = useState(false),
    [person, setPerson] = useState(""),
    [bookBusy, setBookBusy] = useState(false),
    [coverPick, setCoverPick] = useState(false),
    [exportOpen, setExportOpen] = useState(false),
    [preview, setPreview] = useState<BookLayout | null>(null),
    [error, setError] = useState("");
  const binder = useBookBinder();
  const bookRef = useRef<Svg | null>(null);
  const [book, setBook] = useState<{
    input: YearbookInput;
    photos: { cover?: YearbookPhoto; months: (YearbookPhoto | undefined)[] };
  } | null>(null);
  const { records: recordMap } = state;
  const records = useMemo(
    () =>
      sortedRecords({ records: recordMap }).filter(
        (r) => yearKey(r.date) === year,
      ),
    [recordMap, year],
  );
  const replay = useMemo(
    () => replayPhotos(records, state.media),
    [records, state.media],
  );
  const personList = Object.values(state.persons);
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
  const stats = [
    `${records.length} 段时光`,
    photos ? `${photos} 张照片` : "",
    av ? `${av} 段影音` : "",
    firsts.length ? `${firsts.length} 个第一次` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const writers = byLine(byCountsOf(records));
  const monthKeys = Array.from(
    { length: 12 },
    (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`,
  );
  // 册子收整年，不跟着人物筛选走：翻一本缺了人的年册没有意义。
  const yearFirsts = records
    .filter((r) => r.first)
    .sort((a, b) => a.date.localeCompare(b.date));
  const yearPhotoIds = useMemo(
    () => [
      ...new Set(
        records
          .flatMap((r) => r.mediaIds)
          .filter((id) => state.media[id]?.kind === "image"),
      ),
    ],
    [records, state.media],
  );
  const pickedCover = state.yearCovers[year];
  const coverMedia =
    (pickedCover ? state.media[pickedCover] : undefined) ??
    coverForRecords(records, state.media);
  const bookPhoto = (id: string): BookPhoto | undefined => {
    const m = state.media[id];
    if (m?.kind !== "image") return undefined;
    return { key: id, aspect: m.width && m.height ? m.width / m.height : 4 / 3 };
  };
  const makeBook = () => {
    const applied = applyYearPicks(state.yearPicks?.[year], records);
    const bookRecord = (r: Stored<LocalRecord>) => ({
      title: recordTitle(r),
      date: dateLabel(r.date),
      text: r.text,
      ...(r.by ? { by: r.by } : {}),
      photos: r.mediaIds
        .map(bookPhoto)
        .filter((photo): photo is BookPhoto => !!photo),
    });
    const layout = planBook(
      yearBookInput({
        year,
        title: state.yearPicks?.[year]?.title,
        profileName: state.profile.name,
        birthday: state.profile.birthday,
        fullName: state.profile.fullName,
        motto: state.profile.motto,
        stats,
        note: state.yearNotes[year] ?? "",
        months: monthKeys.map((key) => {
          const monthRecords = records.filter(
            (r) => monthKey(r.date) === key,
          );
          return {
            label: monthLabel(key),
            ...yearBookMonth(monthRecords, applied?.months[key], bookRecord),
          };
        }),
        firsts: yearFirsts.map((r) => ({
          title: recordTitle(r),
          date: dateLabel(r.date),
        })),
        cover: coverMedia ? bookPhoto(coverMedia.id) : undefined,
        colophon: `${year} 年`,
      }),
    );
    setPreview(layout);
  };
  const bindBook = (layout: BookLayout) => {
    setPreview(null);
    binder.start({
      layout,
      name: `yearbook-${year}`,
      title: state.yearPicks?.[year]?.title || `${state.profile.name.trim() || CHILD_FALLBACK}的 ${year} 年`,
      media: state.media,
      onBound: () =>
        store.change((s) => {
          s.yearBooksBoundAt = { ...s.yearBooksBoundAt, [year]: now() };
        }),
    });
  };
  const makeYearbook = async () => {
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
          await exportKeepSakeCard(bookRef.current, `yearbook-${year}`);
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
  }, [book, bookBusy, year]);
  return (
    <Page>
      <View style={{ alignItems: "center", gap: 4, paddingTop: 4 }}>
        <Stamp size={72}>
          <Text
            style={{
              fontFamily: serif,
              fontSize: 22,
              color: colors.accent,
              fontWeight: "600",
            }}
          >
            {year}
          </Text>
        </Stamp>
        <Text style={s.title}>{year} 年</Text>
        {!!stats && <Text style={[s.muted, { textAlign: "center" }]}>{stats}</Text>}
        {!!writers && (
          <Text style={[s.muted, { textAlign: "center" }]} testID="year-writers">
            {writers}
          </Text>
        )}
      </View>
      <View style={s.row}>
        <Button
          title="这一年回顾"
          compact
          testID="year-recap"
          onPress={() => nav.navigate("Recap", { year })}
        />
        {replay.length > 0 && (
          <Button
            title="重放这一年"
            compact
            testID="year-replay"
            onPress={() => setReplayOpen(true)}
          />
        )}
        <Button
          title={bookBusy ? "正在生成长图…" : "导出成长册"}
          compact
          testID="year-yearbook"
          disabled={bookBusy || !!binder.job || records.length === 0}
          onPress={() => setExportOpen(!exportOpen)}
        />
      </View>
      {replay.length === 0 && records.length > 0 && (
        <Text style={s.muted}>这一年还没有照片，加几张就能整屏重放。</Text>
      )}
      {exportOpen && (
        <Card compact>
          <Text style={s.muted}>
            长图一张，适合发给家人；纪念册是 20×20cm 方形开本的 PDF，真分页、带页码，可直接送印。
          </Text>
          <YearEditor key={year} year={year} records={records} />
          <View style={s.row}>
            <Button
              title="长图"
              compact
              onPress={() => {
                setExportOpen(false);
                void makeYearbook();
              }}
            />
            <Button
              title="纪念册 PDF"
              compact
              onPress={() => {
                setExportOpen(false);
                makeBook();
              }}
            />
            {yearPhotoIds.length > 0 && (
              <Button
                title={
                  pickedCover && state.media[pickedCover]
                    ? "换纪念册封面"
                    : "选纪念册封面"
                }
                kind="text"
                compact
                testID="year-book-cover"
                disabled={!!binder.job}
                onPress={() => setCoverPick(true)}
              />
            )}
          </View>
        </Card>
      )}
      {binder.progress && (
        <Card compact>
          <Text style={s.heading}>
            正在装订 {binder.progress.done + 1}/{binder.progress.total} 页
          </Text>
          <Text style={s.muted}>
            装订完会弹出保存与分享。请留在这一页，离开会中断。
          </Text>
          <Button title="停止装订" testID="year-book-cancel" onPress={binder.cancel} />
        </Card>
      )}
      {!!binder.notice && <Text style={s.muted}>{binder.notice}</Text>}
      <ErrorText message={error} />
      <ErrorText message={binder.error} />
      {replayOpen && <ReplayModal year={year} onClose={() => setReplayOpen(false)} />}
      {personList.length > 0 && (
        <PersonChips
          persons={personList}
          selected={person ? [person] : []}
          allLabel="全部人物"
          onAll={() => setPerson("")}
          onToggle={(id) => setPerson(person === id ? "" : id)}
          compact
        />
      )}
      {months.length > 0 && (
        <View style={{ gap: 16 }}>
          <SectionHeader title="这一年的月册" />
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
                  ratio={1}
                  onPress={() => nav.navigate("Month", { month: m })}
                />
              );
            })}
          </View>
        </View>
      )}
      {firsts.length > 0 && (
        <View style={{ gap: 12 }}>
          <SectionHeader title="这一年的第一次" />
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
      <YearNote year={year} />
      {records.length === 0 && (
        <View style={s.empty}>
          <Text style={s.heading}>这一年还没有记录</Text>
          <Text style={s.muted}>回到书架，点右下角的「记一刻」，从这一刻开始。</Text>
        </View>
      )}
      <Ornament />
      <PhotoPicker
        visible={coverPick}
        title="选一张纪念册封面"
        hint="不选就用这一年最新的一张照片。"
        empty="这一年还没有照片。"
        testID="year-cover-picker"
        choices={yearPhotoIds.map((id) => ({
          mediaId: id,
          label: "选为纪念册封面",
          caption: pickedCover === id ? "当前封面" : undefined,
        }))}
        onPick={(choice) => {
          setCoverPick(false);
          void store
            .change((s) => {
              s.yearCovers[year] = choice.mediaId;
            })
            .catch((e: unknown) => setError(messageOf(e)));
        }}
        onClose={() => setCoverPick(false)}
      />
      {preview && (
        <BookPreview
          layout={preview}
          media={state.media}
          onClose={() => setPreview(null)}
          onBind={() => bindBook(preview)}
        />
      )}
      {binder.stage}
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
