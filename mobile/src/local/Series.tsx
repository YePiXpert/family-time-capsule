import { useEffect, useRef, useState } from "react";
import { Alert, Pressable, View } from "react-native";
import type { Svg } from "react-native-svg";
import { useLibrary, useStore } from "./context";
import {
  editEntity,
  indexMonth,
  monthIndex,
  monthKey,
  monthOfItem,
  recordTitle,
  SERIES_DEFAULT_NAME,
  sortedRecords,
} from "./model";
import { isEmptySeries } from "./empties";
import { addToSeries, now } from "./services";
import type { Props } from "./navigation";
import {
  Button,
  Card,
  ErrorText,
  Field,
  Page,
  Text,
  messageOf,
  monthLabel,
  useStyles,
} from "./ui";
import { Photo } from "./Media";
import { PhotoPicker } from "./PhotoPicker";
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
  // 点「新建系列」时实体就建好了：还叫默认名又没收进照片就离开，静默清掉，不在书架留空册。
  useEffect(
    () =>
      navigation.addListener("beforeRemove", () => {
        const id = route.params.id,
          latest = store.get().series[id];
        if (!latest || !isEmptySeries(latest)) return;
        // 清不掉也不拦人：空系列留到下次进来再清。
        void store
          .change((s) => {
            delete s.series[id];
          })
          .catch(() => undefined);
      }),
    [navigation, route.params.id, store],
  );
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
      const picked = sampledIndices(sortedItems.length, SERIES_STRIP_MAX).map(
        (i) => sortedItems[i]!,
      );
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
          kind="text"
          compact
          onPress={() => setOrganize(!organize)}
        />
      </View>
      {sortedItems.length > 0 && sortedItems.length < 2 && (
        <Text style={s.muted}>再收进一张，就能导出横排对比卡。</Text>
      )}
      {organize && (
        <Card>
          <Field label="系列名称" value={name} onChangeText={setName} />
          <Button
            title="保存名称"
            onPress={() =>
              action((s) => {
                if (!s.series[route.params.id])
                  throw new Error("时光系列已删除。");
                editEntity(s, "series", route.params.id, (target) => {
                  target.name = name.trim() || SERIES_DEFAULT_NAME;
                  target.updatedAt = now();
                });
              })
            }
          />
          <Button
            title="删除系列"
            kind="text"
            danger
            onPress={() =>
              Alert.alert("删除这个时光系列？", "其中的照片与记录都会保留。", [
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
              ])
            }
          />
        </Card>
      )}
      <PhotoPicker
        visible={!!pickMonth}
        title={pickMonth ? `${monthLabel(pickMonth)}的照片` : ""}
        empty="这个月还没有带照片的记录，先去记一刻吧。"
        choices={candidates.map((candidate) => ({
          ...candidate,
          label: `收进系列：${candidate.title}`,
          caption: candidate.title,
        }))}
        onPick={(choice) => choose(choice.recordId, choice.mediaId)}
        onClose={() => setPickMonth(null)}
      />
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
                        if (!s.series[route.params.id])
                          throw new Error("时光系列已删除。");
                        editEntity(s, "series", route.params.id, (target) => {
                          target.items = target.items.filter(
                            (i) => i.month !== month,
                          );
                          target.updatedAt = now();
                        });
                      })
                    }
                  />
                )}
              </View>
            );
          return (
            <Card
              key={month}
              testID={`series-gap-${month}`}
              style={{ alignItems: "center", paddingVertical: 20, gap: 12 }}
            >
              <Text style={s.muted}>{monthLabel(month)}</Text>
              <Text style={s.heading}>还缺这一张</Text>
              <Button
                title="把这个月的照片加进来"
                compact
                onPress={() => setPickMonth(month)}
              />
            </Card>
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
