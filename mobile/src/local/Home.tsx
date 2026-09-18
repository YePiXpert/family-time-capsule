import { useMemo, useState } from "react";
import {
  Pressable,
  SectionList,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";
import Animated, {
  FadeInUp,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLibrary, useStore } from "./context";
import { beginDraft } from "./services";
import { monthKey, type LocalRecord } from "./model";
import { useNav, type Props } from "./navigation";
import {
  ErrorText,
  Field,
  IconButton,
  Ornament,
  Page,
  Text,
  dateLabel,
  messageOf,
  monthLabel,
  useStyles,
  useTheme,
} from "./ui";
import { JournalIcon } from "../components/JournalIcon";
import { Photo } from "./Media";

const PRESS_SPRING = { damping: 14, stiffness: 220 };

export function RecordCard({
  record,
  selected,
  onPress,
  tileSize,
}: {
  record: LocalRecord;
  selected?: boolean;
  onPress: () => void;
  tileSize?: number;
}) {
  const state = useLibrary(),
    s = useStyles(),
    { colors, large } = useTheme();
  const images = record.mediaIds
    .map((id) => state.media[id])
    .filter((m) => m?.kind === "image");
  const candidate = state.media[record.coverId ?? ""];
  const cover = candidate?.kind === "image" ? candidate : images[0];
  const firstMedia = state.media[record.mediaIds[0] ?? ""];
  const title =
    record.title.trim() ||
    record.text.trim() ||
    (cover
      ? "照片记录"
      : firstMedia?.kind === "audio"
        ? "声音记录"
        : firstMedia?.kind === "video"
          ? "视频记录"
          : "这一刻");
  const caption = record.title.trim() ? record.text.trim() : record.location;
  return (
    <Pressable
      testID={`record-${record.id}`}
      accessibilityRole={selected === undefined ? "button" : "checkbox"}
      accessibilityState={selected === undefined ? {} : { checked: selected }}
      accessibilityLabel={`${selected === undefined ? "" : selected ? "已选，" : "未选，"}${title}，${dateLabel(record.date)}`}
      onPress={onPress}
      style={({ pressed }) => [
        tileSize ? { width: tileSize } : s.recordRow,
        { opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <View>
        {cover ? (
          <Photo media={cover} size={tileSize ?? 88} />
        ) : tileSize ? (
          <View
            style={[
              s.section,
              {
                width: tileSize,
                height: tileSize,
                justifyContent: "center",
                alignItems: "center",
                padding: 12,
              },
            ]}
          >
            <JournalIcon
              name={
                firstMedia?.kind === "audio"
                  ? "audio"
                  : firstMedia?.kind === "video"
                    ? "video"
                    : "edit"
              }
              color={colors.accent}
              size={28}
            />
            <Text numberOfLines={3} style={s.muted}>
              {record.text ||
                (firstMedia?.kind === "audio"
                  ? "听听这一刻"
                  : firstMedia?.kind === "video"
                    ? "一段影像"
                    : "写下的回忆")}
            </Text>
          </View>
        ) : null}
        {tileSize && (images.length > 1 || record.first) ? (
          <View
            style={{
              position: "absolute",
              bottom: 8,
              right: 8,
              paddingHorizontal: 8,
              paddingVertical: 2,
              borderRadius: 10,
              backgroundColor: colors.glass,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: colors.glassLine,
            }}
          >
            <Text style={s.muted}>
              {images.length > 1
                ? `${images.length} 张${record.first ? " · 第一次" : ""}`
                : "第一次"}
            </Text>
          </View>
        ) : null}
      </View>
      <View
        style={tileSize ? s.galleryCaption : { flex: 1, minWidth: 0, gap: 4 }}
      >
        {!tileSize && (
          <Text style={s.muted}>
            {dateLabel(record.date)}
            {record.first ? " · 第一次" : ""}
          </Text>
        )}
        <Text
          numberOfLines={tileSize ? 2 : 3}
          style={tileSize && !large ? s.galleryTitle : s.heading}
        >
          {title}
        </Text>
        {!!caption && (
          <Text numberOfLines={tileSize ? 1 : 2} style={s.muted}>
            {caption}
          </Text>
        )}
        {!tileSize && record.mediaIds.length > 0 && (
          <Text style={s.muted}>
            {images.length
              ? `${images.length} 张照片`
              : `${record.mediaIds.length} 份素材`}
          </Text>
        )}
      </View>
      {selected !== undefined && (
        <Text style={{ color: colors.accent, width: 24 }}>
          {selected ? "●" : "○"}
        </Text>
      )}
    </Pressable>
  );
}

export function CaptureDock() {
  const store = useStore(),
    nav = useNav(),
    { colors, dark } = useTheme();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const scale = useSharedValue(1);
  const pressStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));
  return (
    <View
      pointerEvents="box-none"
      style={{
        position: "absolute",
        right: 20,
        bottom: insets.bottom + 20,
        alignItems: "flex-end",
        gap: 8,
      }}
    >
      <ErrorText message={error} />
      <Animated.View
        entering={FadeInUp.delay(240).duration(360)}
        style={pressStyle}
      >
        <Pressable
          testID="capture-new"
          accessibilityRole="button"
          accessibilityLabel="记一刻"
          disabled={busy}
          onPress={() => {
            setBusy(true);
            void beginDraft(store)
              .then((draftId) => nav.navigate("Editor", { draftId }))
              .catch((e) => setError(messageOf(e)))
              .finally(() => setBusy(false));
          }}
          onPressIn={() => {
            // eslint-disable-next-line react-hooks/immutability -- reanimated 共享值的就地修改是其既定用法
            scale.value = withSpring(0.92, PRESS_SPRING);
          }}
          onPressOut={() => {
            // eslint-disable-next-line react-hooks/immutability -- reanimated 共享值的就地修改是其既定用法
            scale.value = withSpring(1, PRESS_SPRING);
          }}
          style={{
            width: 56,
            height: 56,
            borderRadius: 28,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: colors.accent,
            opacity: busy ? 0.5 : 1,
            shadowColor: dark ? "#000000" : "#7A5C3E",
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.25,
            shadowRadius: 10,
            elevation: 4,
          }}
        >
          <JournalIcon name="plus" color={colors.onAccent} size={26} />
        </Pressable>
      </Animated.View>
    </View>
  );
}

export function Month({ route }: Props<"Month">) {
  const state = useLibrary(),
    nav = useNav(),
    s = useStyles(),
    { colors, large } = useTheme();
  const insets = useSafeAreaInsets(),
    { width, fontScale } = useWindowDimensions();
  const columns = large || fontScale >= 1.3 ? 1 : width >= 600 ? 3 : 2;
  const tileSize =
    (width - insets.left - insets.right - 40 - 12 * (columns - 1)) / columns;
  const [query, setQuery] = useState(""),
    [searchOpen, setSearchOpen] = useState(false);
  const records = useMemo(() => {
    return Object.values(state.records)
      .filter((r) => monthKey(r.date) === route.params.month)
      .filter(
        (r) =>
          !query ||
          `${r.title}\n${r.text}\n${r.location}`
            .toLocaleLowerCase()
            .includes(query.toLocaleLowerCase()),
      )
      .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  }, [state, query, route.params.month]);
  const byDay = new Map<string, LocalRecord[]>();
  for (const record of records) {
    const day = dateLabel(record.date);
    const group = byDay.get(day) ?? [];
    group.push(record);
    byDay.set(day, group);
  }
  const sections = [...byDay].map(([title, dayRecords]) => {
    const data: LocalRecord[][] = [];
    for (let i = 0; i < dayRecords.length; i += columns)
      data.push(dayRecords.slice(i, i + columns));
    return { title, count: dayRecords.length, data };
  });
  return (
    <Page scroll={false}>
      <SectionList
        sections={sections}
        keyExtractor={(row) => row.map((r) => r.id).join("/")}
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: 12,
          paddingBottom: 96,
        }}
        keyboardShouldPersistTaps="handled"
        stickySectionHeadersEnabled={false}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View style={{ gap: 12, marginBottom: 12 }}>
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
            >
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.title} numberOfLines={2}>
                  {monthLabel(route.params.month)}
                </Text>
                <Text style={s.muted}>{records.length} 段时光</Text>
              </View>
              <IconButton
                label="搜索本册"
                icon="search"
                selected={searchOpen}
                onPress={() => setSearchOpen(!searchOpen)}
              />
            </View>
            {(searchOpen || !!query) && (
              <Field
                label="搜索本册"
                hideLabel
                placeholder="搜索标题、内容或地点"
                value={query}
                onChangeText={setQuery}
                testID="record-search"
                returnKeyType="search"
              />
            )}
          </View>
        }
        renderSectionHeader={({ section }) => (
          <View style={s.dateHeading}>
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
            >
              <View
                style={{
                  width: 4,
                  height: 16,
                  borderRadius: 2,
                  backgroundColor: colors.accent,
                }}
              />
              <Text style={s.galleryTitle}>{section.title}</Text>
            </View>
            <Text style={s.muted}>{section.count} 条</Text>
          </View>
        )}
        renderItem={({ item }) => (
          <View style={columns === 1 ? undefined : s.galleryRow}>
            {item.map((record) => (
              <RecordCard
                key={record.id}
                record={record}
                tileSize={columns === 1 ? undefined : tileSize}
                onPress={() => nav.navigate("Record", { id: record.id })}
              />
            ))}
          </View>
        )}
        ListEmptyComponent={
          <View style={s.empty}>
            <Text style={s.heading}>
              {query ? "没有找到这段记录" : "这一册还是空的"}
            </Text>
            <Text style={s.muted}>
              {query
                ? "试试其他关键词。"
                : "点右下角「记一刻」，写几句话，留一张照片。"}
            </Text>
            <Ornament />
          </View>
        }
      />
      <CaptureDock />
    </Page>
  );
}
