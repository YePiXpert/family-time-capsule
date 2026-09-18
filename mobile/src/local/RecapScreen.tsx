import { useEffect, useMemo, useState } from "react";
import { Image, Modal, Pressable, ScrollView, View } from "react-native";
import Animated, { FadeIn, useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLibrary } from "./context";
import { monthKey, recordTitle, sortedRecords, yearKey } from "./model";
import { useNav, type Props } from "./navigation";
import { Stamp } from "./Shelf";
import { recapOf } from "./recap";
import { replayPhotos } from "./replay";
import { mediaUri } from "./files";
import { Photo } from "./Media";
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

export function RecapScreen({ route }: Props<"Recap">) {
  const state = useLibrary(),
    nav = useNav(),
    s = useStyles(),
    { colors } = useTheme();
  const year = route.params.year;
  const records = useMemo(
    () => sortedRecords(state).filter((r) => yearKey(r.date) === year),
    [state, year],
  );
  const recap = useMemo(
    () => recapOf(records, state.media),
    [records, state.media],
  );
  const note = state.yearNotes[year];
  const stats = [
    `${records.length} 段时光`,
    recap.photos ? `${recap.photos} 张照片` : "",
    recap.av ? `${recap.av} 段影音` : "",
    recap.firsts.length ? `${recap.firsts.length} 个第一次` : "",
    recap.chars ? `共 ${recap.chars} 字` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <Page>
      <View style={{ alignItems: "center", gap: 12, paddingVertical: 16 }}>
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
        <Text style={s.title}>{year} 年的回顾</Text>
        {!!stats && <Text style={s.muted}>{stats}</Text>}
      </View>
      {!!recap.months.length && (
        <View style={{ gap: 12 }}>
          <Text style={[s.muted, { fontFamily: serif }]}>月度封面</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 12, paddingRight: 20 }}
          >
            {recap.months.map((month) => (
              <Pressable
                key={month.month}
                accessibilityRole="button"
                accessibilityLabel={`${monthLabel(month.month)}，${month.count} 段时光`}
                onPress={() => nav.navigate("Month", { month: month.month })}
                style={{ width: 128, gap: 6 }}
              >
                {month.cover ? (
                  <Photo media={month.cover} preview />
                ) : (
                  <View style={[s.section, { height: 96 }]} />
                )}
                <Text numberOfLines={1}>{monthLabel(month.month)}</Text>
                <Text numberOfLines={1} style={s.muted}>
                  {month.count} 段时光
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}
      {!!recap.firsts.length && (
        <View style={{ gap: 12 }}>
          <Text style={[s.muted, { fontFamily: serif }]}>这一年的第一次</Text>
          {recap.firsts.map((record) => (
            <Pressable
              key={record.id}
              accessibilityRole="button"
              accessibilityLabel={`${recordTitle(record)}，${dateLabel(record.date)}`}
              onPress={() => nav.navigate("Record", { id: record.id })}
              style={[s.compactPanel, { paddingVertical: 12 }]}
            >
              <Text style={s.muted}>{dateLabel(record.date)}</Text>
              <Text style={s.heading}>{recordTitle(record)}</Text>
            </Pressable>
          ))}
        </View>
      )}
      {(note || !!recap.months.length) && (
        <View style={{ gap: 12, alignItems: "center" }}>
          {note && (
            <Text style={{ textAlign: "center" }}>{note}</Text>
          )}
          <Ornament />
        </View>
      )}
    </Page>
  );
}

/** 全屏年度重放：照片整屏淡入淡出，4 秒或点击前进，末页收统计与寄语。 */
export function ReplayModal({ year, onClose }: { year: string; onClose: () => void }) {
  const state = useLibrary(),
    { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const [index, setIndex] = useState(0);
  const records = useMemo(
    () => sortedRecords(state).filter((r) => yearKey(r.date) === year),
    [state, year],
  );
  const slides = useMemo(
    () => replayPhotos(records, state.media),
    [records, state.media],
  );
  const recap = useMemo(
    () => recapOf(records, state.media),
    [records, state.media],
  );
  const note = state.yearNotes[year];
  const done = index >= slides.length;
  useEffect(() => {
    if (done) return;
    const timer = setTimeout(
      () => setIndex((i) => Math.min(i + 1, slides.length)),
      4000,
    );
    return () => clearTimeout(timer);
  }, [index, done, slides.length]);
  const advance = () => setIndex((i) => Math.min(i + 1, slides.length));
  const stats = [
    `${records.length} 段时光`,
    recap.photos ? `${recap.photos} 张照片` : "",
    recap.av ? `${recap.av} 段影音` : "",
    recap.firsts.length ? `${recap.firsts.length} 个第一次` : "",
    recap.chars ? `共 ${recap.chars} 字` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const slide = slides[index];
  return (
    <Modal
      visible
      animationType={reduceMotion ? "none" : "fade"}
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable
        accessibilityLabel={done ? "重放结束" : "看下一张"}
        onPress={advance}
        style={{ flex: 1, backgroundColor: "#14100C" }}
      >
        {slide && (
          <Animated.View
            key={slide.mediaId}
            entering={reduceMotion ? undefined : FadeIn.duration(700)}
            style={{ flex: 1 }}
          >
            <Image
              source={{ uri: mediaUri(state.media[slide.mediaId]!) }}
              style={{ flex: 1 }}
              resizeMode="cover"
            />
            <View
              pointerEvents="none"
              style={{
                position: "absolute",
                left: 20,
                right: 20,
                bottom: insets.bottom + 76,
                gap: 4,
              }}
            >
              <Text
                style={{ color: "#F2E9DC", fontSize: 13, opacity: 0.85 }}
              >
                {monthLabel(monthKey(slide.date))}
              </Text>
              <Text
                style={{
                  color: "#F2E9DC",
                  fontSize: 20,
                  fontFamily: serif,
                  fontWeight: "600",
                }}
              >
                {slide.caption}
              </Text>
            </View>
          </Animated.View>
        )}
        {done && (
          <ScrollView
            contentContainerStyle={{
              flexGrow: 1,
              justifyContent: "center",
              padding: 32,
              gap: 16,
              paddingTop: insets.top + 32,
              paddingBottom: insets.bottom + 32,
            }}
          >
            <View style={{ alignItems: "center", gap: 12 }}>
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
              <Text
                style={{
                  color: "#F2E9DC",
                  fontSize: 24,
                  fontFamily: serif,
                  fontWeight: "600",
                  textAlign: "center",
                }}
              >
                {year} 年，就这样过来了
              </Text>
              {!!stats && (
                <Text style={{ color: "#B8A88F", fontSize: 13, textAlign: "center" }}>
                  {stats}
                </Text>
              )}
              {note ? (
                <Text style={{ color: "#F2E9DC", textAlign: "center" }}>
                  {note}
                </Text>
              ) : null}
              <Ornament />
              <View style={{ flexDirection: "row", gap: 12 }}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="再放一次"
                  onPress={() => setIndex(0)}
                  style={{
                    minHeight: 48,
                    justifyContent: "center",
                    paddingHorizontal: 16,
                    borderRadius: 14,
                    backgroundColor: "#FFFFFF1A",
                  }}
                >
                  <Text style={{ color: "#F2E9DC", fontWeight: "600" }}>
                    再放一次
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="结束重放"
                  onPress={onClose}
                  style={{
                    minHeight: 48,
                    justifyContent: "center",
                    paddingHorizontal: 16,
                    borderRadius: 14,
                    backgroundColor: colors.accent,
                  }}
                >
                  <Text style={{ color: colors.onAccent, fontWeight: "600" }}>
                    结束重放
                  </Text>
                </Pressable>
              </View>
            </View>
          </ScrollView>
        )}
        {!done && (
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: insets.bottom + 20,
              flexDirection: "row",
              justifyContent: "center",
              gap: 6,
            }}
          >
            {slides.map((item, i) => (
              <View
                key={item.mediaId}
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 3,
                  backgroundColor: "#F2E9DC",
                  opacity: i === index ? 1 : 0.35,
                }}
              />
            ))}
          </View>
        )}
        <View style={{ position: "absolute", top: insets.top + 8, right: 20 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="结束重放"
            onPress={onClose}
            style={{
              width: 44,
              height: 44,
              borderRadius: 22,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "#FFFFFF26",
            }}
          >
            <Text style={{ color: "#F2E9DC", fontSize: 18 }}>✕</Text>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}
