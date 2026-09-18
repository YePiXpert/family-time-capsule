import { useEffect, useRef, useState } from "react";
import { Alert, FlatList, Pressable, View, useWindowDimensions } from "react-native";
import type { Svg } from "react-native-svg";
import { useLibrary, useStore } from "./context";
import {
  indexMonth,
  monthIndex,
  monthKey,
  monthOfItem,
  recordTitle,
  sortedRecords,
} from "./model";
import { addToSeries, now } from "./services";
import type { Props } from "./navigation";
import {
  Button,
  ErrorText,
  Field,
  Page,
  Text,
  messageOf,
  monthLabel,
  useStyles,
} from "./ui";
import { Photo } from "./Media";
import {
  SeriesStrip,
  exportKeepSakeCard,
  prepareKeepSakePhoto,
} from "./KeepSakeCard";
import { sampledIndices, SERIES_STRIP_MAX } from "./keepsake";

/** 从当月（或最新一张所在的月份）往回到系列首月，缺口月份也占一栏。 */
function timelineMonths(itemMonths: string[], today = new Date()): string[] {
  if (!itemMonths.length) return [monthKey(today.toISOString())];
  const first = Math.min(...itemMonths.map(monthIndex));
  const last = Math.max(
    monthIndex(monthKey(today.toISOString())),
    ...itemMonths.map(monthIndex),
  );
  const months: string[] = [];
  for (let i = last; i >= first; i--) months.push(indexMonth(i));
  return months;
}

export function SeriesScreen({ route, navigation }: Props<"Series">) {
  const store = useStore(),
    state = useLibrary(),
    s = useStyles();
  const { width } = useWindowDimensions();
  const series = state.series[route.params.id];
  const [organize, setOrganize] = useState(false),
    [name, setName] = useState(series?.name ?? ""),
    [pickMonth, setPickMonth] = useState<string | null>(null),
    [error, setError] = useState(""),
    [cardBusy, setCardBusy] = useState(false);
  const cardRef = useRef<Svg | null>(null),
    [card, setCard] = useState<{
      name: string;
      items: { month: string; photo?: { uri: string; aspect: number } }[];
    } | null>(null);
  useEffect(() => {
    if (!card || !cardBusy || !series) return;
    let cancelled = false;
    // 两帧之后再取图，确保离屏 Svg 完成布局与位图合成。
    const first = requestAnimationFrame(() =>
      requestAnimationFrame(async () => {
        if (cancelled) return;
        try {
          await exportKeepSakeCard(cardRef.current, `series-${series.id}`);
        } catch (e) {
          setError(messageOf(e));
        } finally {
          setCardBusy(false);
          setCard(null);
        }
      }),
    );
    return () => {
      cancelled = true;
      cancelAnimationFrame(first);
    };
  }, [card, cardBusy, series]);
  if (!series)
    return (
      <Page>
        <Text>这个时光系列已删除。</Text>
      </Page>
    );
  const action = (fn: Parameters<typeof store.change>[0]) => {
    void store.change(fn).catch((e) => setError(messageOf(e)));
  };
  const sortedItems = [...series.items].sort((a, b) =>
    a.month.localeCompare(b.month),
  );
  const byMonth = new Map(series.items.map((i) => [i.month, i]));
  const months = timelineMonths([...byMonth.keys()]);
  const span =
    sortedItems.length > 1
      ? monthIndex(sortedItems[sortedItems.length - 1]!.month) -
        monthIndex(sortedItems[0]!.month) +
        1
      : 0;
  const candidates = pickMonth
    ? sortedRecords(state).flatMap((r) =>
        r.mediaIds
          .filter((id) => {
            const m = state.media[id];
            return m?.kind === "image" && monthOfItem(r, m) === pickMonth;
          })
          .map((id) => ({
            recordId: r.id,
            mediaId: id,
            title: recordTitle(r),
          })),
      )
    : [];
  const choose = (recordId: string, mediaId: string) => {
    const run = () => {
      void addToSeries(store, series.id, recordId, mediaId)
        .then(() => setPickMonth(null))
        .catch((e) => setError(messageOf(e)));
    };
    if (byMonth.has(pickMonth!)) {
      Alert.alert("替换这个月的照片？", "这个月已经有一张，新的会替掉旧的。", [
        { text: "取消", style: "cancel" },
        { text: "替换", onPress: run },
      ]);
      return;
    }
    run();
  };
  const makeStrip = async () => {
    setCardBusy(true);
    setError("");
    try {
      const picked = sampledIndices(
        sortedItems.length,
        SERIES_STRIP_MAX,
      ).map((i) => sortedItems[i]!);
      const items = [];
      for (const item of picked)
        items.push({
          month: item.month,
          photo: await prepareKeepSakePhoto(state.media[item.mediaId]),
        });
      setCard({ name: series.name, items });
    } catch (e) {
      setError(messageOf(e));
      setCardBusy(false);
    }
  };
  return (
    <Page>
      <Text style={s.title}>{series.name}</Text>
      <Text style={s.muted}>
        {sortedItems.length
          ? `${sortedItems.length} 张照片${span > 1 ? ` · 跨 ${span} 个月` : ""}，从最早排到今天。`
          : "每个月留一张同款照片，慢慢排成她的成长时间线。"}
      </Text>
      <View style={s.row}>
        <Button
          title={cardBusy ? "正在生成对比卡…" : "导出对比卡"}
          icon="heart"
          testID="series-export"
          disabled={sortedItems.length < 2 || cardBusy}
          onPress={() => {
            void makeStrip();
          }}
        />
        <Button
          title={organize ? "完成整理" : "整理"}
          onPress={() => setOrganize(!organize)}
        />
      </View>
      {sortedItems.length > 0 && sortedItems.length < 2 && (
        <Text style={s.muted}>再收进一张，就能导出横排对比卡。</Text>
      )}
      {organize && (
        <View style={s.section}>
          <Field label="系列名称" value={name} onChangeText={setName} />
          <Button
            title="保存名称"
            onPress={() =>
              action((s) => {
                const target = s.series[route.params.id];
                if (!target) throw new Error("时光系列已删除。");
                target.name = name.trim() || "新时光系列";
                target.updatedAt = now();
              })
            }
          />
          <Button
            title="删除系列"
            onPress={() =>
              Alert.alert(
                "删除这个时光系列？",
                "其中的照片与记录都会保留。",
                [
                  { text: "取消", style: "cancel" },
                  {
                    text: "删除系列",
                    style: "destructive",
                    onPress: () => {
                      void store
                        .change((s) => {
                          delete s.series[route.params.id];
                        })
                        .then(() => navigation.goBack())
                        .catch((e) => setError(messageOf(e)));
                    },
                  },
                ],
              )
            }
          />
        </View>
      )}
      {pickMonth && (
        <View style={s.section}>
          <Text style={s.heading}>{monthLabel(pickMonth)}的照片</Text>
          {candidates.length === 0 ? (
            <Text>这个月还没有带照片的记录，先去记一刻吧。</Text>
          ) : (
            <FlatList
              data={candidates}
              keyExtractor={(candidate) => candidate.mediaId}
              numColumns={2}
              columnWrapperStyle={{ gap: 12 }}
              contentContainerStyle={{ gap: 12 }}
              style={{ maxHeight: 432 }}
              renderItem={({ item }) => (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`收进系列：${item.title}`}
                  onPress={() => choose(item.recordId, item.mediaId)}
                  style={{ gap: 4 }}
                >
                  <Photo
                    media={state.media[item.mediaId]}
                    size={(width - 40 - 32 - 12) / 2}
                  />
                  <Text numberOfLines={1} style={s.muted}>
                    {item.title}
                  </Text>
                </Pressable>
              )}
            />
          )}
          <Button title="取消" compact onPress={() => setPickMonth(null)} />
        </View>
      )}
      <ErrorText message={error} />
      <View style={{ gap: 16 }}>
        {months.map((month) => {
          const item = byMonth.get(month);
          const record = item && state.records[item.recordId];
          if (item && record)
            return (
              <View key={month} style={{ gap: 8 }}>
                <Pressable
                  testID={`series-item-${month}`}
                  accessibilityRole="button"
                  accessibilityLabel={`${monthLabel(month)}，${recordTitle(record)}`}
                  onPress={() =>
                    navigation.navigate("Record", { id: record.id })
                  }
                  style={{ gap: 8 }}
                >
                  <Text style={s.muted}>{monthLabel(month)}</Text>
                  <Photo media={state.media[item.mediaId]} preview />
                  <Text numberOfLines={1} style={s.heading}>
                    {recordTitle(record)}
                  </Text>
                </Pressable>
                {organize && (
                  <Button
                    title="移出这张"
                    compact
                    onPress={() =>
                      action((s) => {
                        const target = s.series[route.params.id];
                        if (!target) throw new Error("时光系列已删除。");
                        target.items = target.items.filter(
                          (i) => i.month !== month,
                        );
                        target.updatedAt = now();
                      })
                    }
                  />
                )}
              </View>
            );
          return (
            <View
              key={month}
              testID={`series-gap-${month}`}
              style={[s.section, { alignItems: "center", paddingVertical: 20 }]}
            >
              <Text style={s.muted}>{monthLabel(month)}</Text>
              <Text style={s.heading}>还缺这一张</Text>
              <Button
                title="把这个月的照片加进来"
                compact
                onPress={() => setPickMonth(month)}
              />
            </View>
          );
        })}
      </View>
      {card && (
        <View
          pointerEvents="none"
          style={{ position: "absolute", left: -10000, top: 0, opacity: 0 }}
        >
          <SeriesStrip
            ref={cardRef}
            name={card.name}
            profileName={state.profile.name}
            items={card.items}
          />
        </View>
      )}
    </Page>
  );
}
