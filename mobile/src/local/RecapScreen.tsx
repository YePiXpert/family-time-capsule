import { useEffect, useMemo, useState } from "react";
import { Image, Modal, Pressable, ScrollView, View } from "react-native";
import Animated, { FadeIn, useReducedMotion } from "react-native-reanimated";
import { useAudioPlayer } from "expo-audio";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLibrary, useStore } from "./context";
import { monthKey, recordTitle, sortedRecords, yearKey } from "./model";
import { useNav, type Props } from "./navigation";
import { Stamp } from "./Shelf";
import { recapOf } from "./recap";
import { replayPhotos } from "./replay";
import { mediaUri } from "./files";
import { Photo } from "./Media";
import {
  Button,
  Card,
  Ornament,
  Page,
  Text,
  dateLabel,
  monthLabel,
  overlay,
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
            >
              <Card compact style={{ paddingVertical: 12 }}>
                <Text style={s.muted}>{dateLabel(record.date)}</Text>
                <Text style={s.heading}>{recordTitle(record)}</Text>
              </Card>
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
    store = useStore();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const [index, setIndex] = useState(0),
    [chooseMusic, setChooseMusic] = useState(false);
  // 配乐完全可选，默认无声；选乐只在本机音频素材里挑。
  const audioId = state.settings.replayAudioId;
  const audioMedia = audioId ? state.media[audioId] : undefined;
  const music = useAudioPlayer(
    audioMedia ? mediaUri(audioMedia) : undefined,
  );
  useEffect(() => {
    // eslint-disable-next-line react-hooks/immutability -- expo-audio 播放器的循环与音量就是就地属性
    music.loop = true;
    music.volume = 0.6;
  }, [music]);
  useEffect(() => {
    // 选乐浮层打开时静音暂停，自动前进也一并停下（见下方 effect）。
    if (audioMedia && !chooseMusic) music.play();
    else music.pause();
    return () => music.pause();
  }, [audioMedia, chooseMusic, music]);

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
    if (done || chooseMusic) return;
    const timer = setTimeout(
      () => setIndex((i) => Math.min(i + 1, slides.length)),
      4000,
    );
    return () => clearTimeout(timer);
  }, [index, done, slides.length, chooseMusic]);
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
  const scores = Object.values(state.media).filter((m) => m.kind === "audio");
  const setScore = (id: string | null) => {
    void store.change((s) => {
      if (id) s.settings.replayAudioId = id;
      else delete s.settings.replayAudioId;
    });
    setChooseMusic(false);
  };
  const musicButton = scores.length > 0 && (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={audioMedia ? "更换配乐" : "加一段配乐"}
      testID="replay-music"
      onPress={() => setChooseMusic(true)}
      style={{
        minHeight: 44,
        paddingHorizontal: 16,
        borderRadius: 14,
        justifyContent: "center",
        backgroundColor: overlay.card,
      }}
    >
      <Text style={{ color: overlay.ink, fontSize: 14, fontWeight: "600" }}>
        {audioMedia ? "更换配乐" : "加一段配乐"}
      </Text>
    </Pressable>
  );
  const musicPicker = chooseMusic && (
    // 与「看下一张」是兄弟节点，落在这里的点击不会传下去，无需再套 Pressable。
    <View
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        padding: 20,
        paddingBottom: insets.bottom + 20,
        gap: 12,
        backgroundColor: overlay.bgSoft,
      }}
      testID="replay-music-sheet"
    >
      <Text style={{ color: overlay.ink, fontFamily: serif, fontSize: 18 }}>
        选一段记录里的声音
      </Text>
      <Text style={{ color: overlay.muted, fontSize: 13 }}>
        配乐来自你已经记下的录音，只在这台设备播放。
      </Text>
      <Button
        title={audioId ? "播放时不配乐" : "保持安静"}
        compact
        selected={!audioId}
        testID="replay-music-none"
        onPress={() => setScore(null)}
      />
      {scores.map((score) => (
        <Button
          key={score.id}
          title={score.name}
          compact
          selected={audioId === score.id}
          testID={`replay-music-${score.id}`}
          onPress={() => setScore(score.id)}
        />
      ))}
      <Button title="收起" compact onPress={() => setChooseMusic(false)} />
    </View>
  );
  return (
    <Modal
      visible
      animationType={reduceMotion ? "none" : "fade"}
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={{ flex: 1, backgroundColor: overlay.bg }}>
        {slide && (
          <Animated.View
            key={slide.mediaId}
            entering={reduceMotion ? undefined : FadeIn.duration(700)}
            style={{ flex: 1 }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="看下一张"
              onPress={advance}
              style={{ flex: 1 }}
            >
              <Image
                source={{ uri: mediaUri(state.media[slide.mediaId]!) }}
                style={{ flex: 1 }}
                resizeMode="cover"
              />
            </Pressable>
            <View
              // 字幕是「看下一张」Pressable 的兄弟节点，不放行就会在底部留出死区。
              pointerEvents="none"
              style={{
                position: "absolute",
                left: 20,
                right: 20,
                bottom: insets.bottom + 76,
                gap: 4,
                backgroundColor: overlay.textScrim,
                borderRadius: 12,
                paddingHorizontal: 12,
                paddingVertical: 8,
              }}
            >
              <Text style={{ color: overlay.ink, fontSize: 13 }}>
                {monthLabel(monthKey(slide.date))}
              </Text>
              <Text
                style={{
                  color: overlay.ink,
                  fontSize: 18,
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
              <Stamp size={72} color={overlay.accent}>
                <Text
                  style={{
                    fontFamily: serif,
                    fontSize: 22,
                    color: overlay.accent,
                    fontWeight: "600",
                  }}
                >
                  {year}
                </Text>
              </Stamp>
              <Text
                style={{
                  color: overlay.ink,
                  fontSize: 24,
                  fontFamily: serif,
                  fontWeight: "600",
                  textAlign: "center",
                }}
              >
                {year} 年，就这样过来了
              </Text>
              {!!stats && (
                <Text
                  style={{
                    color: overlay.muted,
                    fontSize: 13,
                    textAlign: "center",
                  }}
                >
                  {stats}
                </Text>
              )}
              {note ? (
                <Text style={{ color: overlay.ink, textAlign: "center" }}>
                  {note}
                </Text>
              ) : null}
              <Ornament />
              <View
                style={{
                  flexDirection: "row",
                  gap: 12,
                  flexWrap: "wrap",
                  justifyContent: "center",
                }}
              >
                {/* 末页只收统计与两个出口，选乐入口只在放映中出现（DESIGN.md 年度册条目）。 */}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="再放一次"
                  onPress={() => setIndex(0)}
                  style={{
                    minHeight: 48,
                    justifyContent: "center",
                    paddingHorizontal: 16,
                    borderRadius: 14,
                    backgroundColor: overlay.card,
                  }}
                >
                  <Text style={{ color: overlay.ink, fontWeight: "600" }}>
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
                    backgroundColor: overlay.accent,
                  }}
                >
                  <Text style={{ color: overlay.onAccent, fontWeight: "600" }}>
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
              gap: 4,
            }}
          >
            {slides.map((item, i) => (
              <View
                key={item.mediaId}
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 3,
                  backgroundColor: overlay.ink,
                  opacity: i === index ? 1 : 0.35,
                }}
              />
            ))}
          </View>
        )}
        {musicPicker}
        <View
          style={{
            position: "absolute",
            top: insets.top + 8,
            right: 20,
            flexDirection: "row",
            gap: 8,
            alignItems: "center",
          }}
        >
          {!done && musicButton}
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
              backgroundColor: overlay.card,
            }}
          >
            <Text style={{ color: overlay.ink, fontSize: 18 }}>✕</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
