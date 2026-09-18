import { useMemo, useState, type ReactNode } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";
import Animated, {
  FadeInUp,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { GlassView } from "expo-glass-effect";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLibrary, useStore } from "./context";
import { beginDraft, beginSelection, beginSeries } from "./services";
import {
  monthIndex,
  monthKey,
  recordTitle,
  sortedRecords,
  yearKey,
  type LocalMedia,
} from "./model";
import { useNav } from "./navigation";
import { daysSinceExport } from "./backup";
import { nudgeOf } from "./nudge";
import { clusterPlaces } from "./places";
import { ageLine, milestoneLabel, milestoneNumeral, milestoneOf } from "./dates";
import {
  Button,
  Card,
  ErrorText,
  Glass,
  IconButton,
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
import { Photo } from "./Media";

const PRESS_SPRING = { damping: 14, stiffness: 220 };

/** 双线印章圆环：扉页名字首字与年度册封面共用。 */
export function Stamp({
  size,
  children,
}: {
  size: number;
  children: ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: 2,
        borderColor: colors.accent,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          top: 5,
          left: 5,
          right: 5,
          bottom: 5,
          borderRadius: size / 2 - 5,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: colors.accent,
          opacity: 0.5,
        }}
      />
      {children}
    </View>
  );
}

export function Volume({
  title,
  caption,
  cover,
  fallbackIcon,
  stamp,
  onPress,
  testID,
  width,
  index = 0,
}: {
  title: string;
  caption: string;
  cover?: LocalMedia;
  fallbackIcon?: "book" | "star" | "plus";
  /** 无封面时盖在纸封面上的印章文字（年度册年份）。 */
  stamp?: string;
  onPress: () => void;
  testID?: string;
  width: number;
  index?: number;
}) {
  const s = useStyles(),
    { colors } = useTheme();
  const reduceMotion = useReducedMotion();
  const scale = useSharedValue(1);
  const pressStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));
  return (
    <Animated.View
      entering={
        reduceMotion
          ? undefined
          : FadeInUp.delay(Math.min(index, 8) * 60).duration(320)
      }
      style={[{ width, marginBottom: 24 }, pressStyle]}
    >
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={`${title}，${caption}`}
        onPress={onPress}
        onPressIn={() => {
          if (reduceMotion) return;
          // eslint-disable-next-line react-hooks/immutability -- reanimated 共享值的就地修改是其既定用法
          scale.value = withSpring(0.96, PRESS_SPRING);
        }}
        onPressOut={() => {
          if (reduceMotion) return;
          // eslint-disable-next-line react-hooks/immutability -- reanimated 共享值的就地修改是其既定用法
          scale.value = withSpring(1, PRESS_SPRING);
        }}
        style={{ gap: 8 }}
      >
        {cover ? (
          <Photo media={cover} preview />
        ) : (
          <View
            style={[
              s.section,
              {
                aspectRatio: 4 / 3,
                justifyContent: "center",
                alignItems: "center",
                gap: 8,
              },
            ]}
          >
            <View
              pointerEvents="none"
              style={{
                position: "absolute",
                left: 10,
                top: 12,
                bottom: 12,
                width: 4,
                borderRadius: 2,
                backgroundColor: colors.accent,
                opacity: 0.7,
              }}
            />
            {stamp ? (
              <Stamp size={56}>
                <Text
                  style={{
                    fontFamily: serif,
                    fontSize: stamp.length > 3 ? 13 : 18,
                    color: colors.accent,
                    fontWeight: "600",
                    letterSpacing: 0.3,
                  }}
                >
                  {stamp}
                </Text>
              </Stamp>
            ) : (
              <JournalIcon
                name={fallbackIcon ?? "book"}
                color={colors.accent}
                size={28}
              />
            )}
          </View>
        )}
        <Text
          numberOfLines={1}
          style={{ fontFamily: serif, fontWeight: "600", letterSpacing: 0.3 }}
        >
          {title}
        </Text>
        <Text numberOfLines={1} style={s.muted}>
          {caption}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

function CapturePen() {
  const store = useStore(),
    nav = useNav(),
    { colors, dark, liquid } = useTheme();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const reduceMotion = useReducedMotion();
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
        entering={reduceMotion ? undefined : FadeInUp.delay(240).duration(360)}
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
            if (reduceMotion) return;
            // eslint-disable-next-line react-hooks/immutability -- reanimated 共享值的就地修改是其既定用法
            scale.value = withSpring(0.92, PRESS_SPRING);
          }}
          onPressOut={() => {
            if (reduceMotion) return;
            // eslint-disable-next-line react-hooks/immutability -- reanimated 共享值的就地修改是其既定用法
            scale.value = withSpring(1, PRESS_SPRING);
          }}
          style={{
            width: 56,
            height: 56,
            borderRadius: 28,
            alignItems: "center",
            justifyContent: "center",
            opacity: busy ? 0.5 : 1,
            ...(liquid
              ? {}
              : {
                  backgroundColor: colors.accent,
                  shadowColor: dark ? "#000000" : "#7A5C3E",
                  shadowOffset: { width: 0, height: 4 },
                  shadowOpacity: 0.25,
                  shadowRadius: 10,
                  elevation: 4,
                }),
          }}
        >
          {liquid && (
            <GlassView
              glassEffectStyle="regular"
              colorScheme={dark ? "dark" : "light"}
              tintColor={colors.accent}
              isInteractive
              style={{
                position: "absolute",
                width: 56,
                height: 56,
                borderRadius: 28,
              }}
            />
          )}
          <JournalIcon name="plus" color={colors.onAccent} size={26} />
        </Pressable>
      </Animated.View>
    </View>
  );
}

export function Shelf() {
  const state = useLibrary(),
    store = useStore(),
    nav = useNav(),
    s = useStyles(),
    { colors, large } = useTheme();
  const { width, fontScale } = useWindowDimensions(),
    insets = useSafeAreaInsets();
  const columns = large || fontScale >= 1.3 ? 1 : 2;
  const reduceMotion = useReducedMotion();
  const entrance = reduceMotion ? undefined : FadeInUp.duration(320);
  const volumeWidth =
    (width - insets.left - insets.right - 40 - 16 * (columns - 1)) / columns;
  const [draftsOpen, setDraftsOpen] = useState(false),
    [error, setError] = useState(""),
    [nudgeClosed, setNudgeClosed] = useState(false);
  const records = useMemo(() => sortedRecords(state), [state]);
  const months = [...new Set(records.map((r) => monthKey(r.date)))];
  const years = [...new Set(records.map((r) => yearKey(r.date)))];
  const firsts = records
    .filter((r) => r.first)
    .sort((a, b) => a.date.localeCompare(b.date));
  const today = new Date();
  const anniversaries = records.filter((r) => {
    const d = new Date(r.date);
    return (
      d.getFullYear() < today.getFullYear() &&
      d.getMonth() === today.getMonth() &&
      d.getDate() === today.getDate()
    );
  });
  const albums = Object.values(state.albums).sort(
    (a, b) =>
      b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id),
  );
  const seriesList = Object.values(state.series).sort(
    (a, b) =>
      b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id),
  );
  const clusters = clusterPlaces(Object.values(state.media));
  const drafts = Object.values(state.drafts).sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
  const latestDraft = drafts[0];
  const nudge = nudgeOf(
    records[0]?.date ?? null,
    latestDraft?.updatedAt ?? null,
    drafts.length,
  );
  const exportedDays = daysSinceExport(state),
    backupDue =
      records.length > 0 && (exportedDays === null || exportedDays > 30);
  const age = ageLine(state.profile.birthday),
    milestone = milestoneOf(state.profile.birthday);
  return (
    <Page scroll={false} top>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: 16,
          paddingBottom: 120,
        }}
        showsVerticalScrollIndicator={false}
      >
        <View style={s.between}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="翻开扉页"
            onPress={() => nav.navigate("Title")}
            style={{ flex: 1, minWidth: 0 }}
          >
            <Text numberOfLines={2} style={s.title}>
              {state.profile.name
                ? `${state.profile.name}的成长记`
                : "成长中的每一天"}
            </Text>
            <Text style={s.muted}>
              {records.length
                ? `${months.length} 册 · ${records.length} 段时光`
                : "从今天的一件小事开始"}
            </Text>
            {age && (
              <Text style={s.muted} testID="shelf-age">
                {state.profile.name ? `${state.profile.name} · ` : ""}
                {age}
              </Text>
            )}
          </Pressable>
          <IconButton
            label="搜索全部记录"
            icon="search"
            testID="open-search"
            onPress={() => nav.navigate("Search")}
          />
          <IconButton
            label="打开设置"
            icon="seal"
            testID="open-settings"
            onPress={() => nav.navigate("Settings")}
          />
        </View>
        {milestone && (
          <Animated.View entering={entrance}>
            <Pressable
              testID="milestone-card"
              accessibilityRole="button"
              accessibilityLabel={`${milestoneLabel(milestone)}，记下这一天`}
              onPress={() => {
                void beginDraft(store)
                  .then((draftId) => nav.navigate("Editor", { draftId }))
                  .catch((e) => setError(messageOf(e)));
              }}
            >
              <Glass radius={16} style={{ padding: 16, gap: 8 }}>
                <View
                  style={{ flexDirection: "row", alignItems: "center", gap: 12 }}
                >
                  <View
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 22,
                      borderWidth: 2,
                      borderColor: colors.accent,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <View
                      pointerEvents="none"
                      style={{
                        position: "absolute",
                        top: 3,
                        left: 3,
                        right: 3,
                        bottom: 3,
                        borderRadius: 19,
                        borderWidth: StyleSheet.hairlineWidth,
                        borderColor: colors.accent,
                        opacity: 0.5,
                      }}
                    />
                    <Text
                      style={{
                        fontFamily: serif,
                        fontSize: milestone!.kind === "hundred" ? 13 : 18,
                        color: colors.accent,
                        fontWeight: "600",
                      }}
                    >
                      {milestoneNumeral(milestone!)}
                    </Text>
                  </View>
                  <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                    <Text
                      style={[s.muted, { color: colors.accent, fontWeight: "600" }]}
                    >
                      {milestoneLabel(milestone!)}
                    </Text>
                    <Text style={s.heading}>把今天好好记下来</Text>
                  </View>
                </View>
              </Glass>
            </Pressable>
          </Animated.View>
        )}
        {backupDue && (
          <Animated.View entering={entrance}>
            <Pressable
              testID="backup-reminder"
              accessibilityRole="button"
              accessibilityLabel={
                exportedDays === null
                  ? "还没有导出过备份，去备份"
                  : `已经 ${exportedDays} 天没有备份了，去备份`
              }
              onPress={() => nav.navigate("Backup")}
            >
              <Glass radius={16} style={{ padding: 16, gap: 6 }}>
                <Text style={s.heading}>
                  {exportedDays === null
                    ? "还没有导出过备份"
                    : `已经 ${exportedDays} 天没有备份了`}
                </Text>
                <Text style={s.muted}>
                  记录只保存在这台设备。定期导出一份，把这段时光留到应用之外。
                </Text>
                <Button
                  title="去备份"
                  compact
                  onPress={() => nav.navigate("Backup")}
                />
              </Glass>
            </Pressable>
          </Animated.View>
        )}
        {nudge && !nudgeClosed && (
          <Animated.View entering={entrance}>
            <Glass radius={16} style={{ padding: 16, gap: 8 }}>
              <View style={s.between}>
                <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                  <Text style={s.heading} testID="rhythm-nudge">
                    {nudge.kind === "draft"
                      ? "有一份草稿还没写完"
                      : `有 ${nudge.days} 天没记啦`}
                  </Text>
                  <Text style={s.muted}>
                    {nudge.kind === "draft"
                      ? "接着上次的话头写下去吧。"
                      : "日子过得快，挑一件小事写下来。"}
                  </Text>
                </View>
                <IconButton
                  label="今天不再提醒"
                  icon="close"
                  onPress={() => setNudgeClosed(true)}
                />
              </View>
              <Button
                title={nudge.kind === "draft" ? "继续写" : "记一刻"}
                compact
                testID="rhythm-nudge-action"
                onPress={() => {
                  if (nudge.kind === "draft" && latestDraft) {
                    nav.navigate("Editor", { draftId: latestDraft.id });
                    return;
                  }
                  void beginDraft(store)
                    .then((draftId) => nav.navigate("Editor", { draftId }))
                    .catch((e) => setError(messageOf(e)));
                }}
              />
            </Glass>
          </Animated.View>
        )}
        {anniversaries.length > 0 && (
          <Animated.View entering={entrance}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 12, paddingRight: 20 }}
            >
              {anniversaries.map((record, index) => (
                <Pressable
                  key={record.id}
                  testID={index === 0 ? "anniversary" : `anniversary-${index}`}
                  accessibilityRole="button"
                  accessibilityLabel={`那年今日，${recordTitle(record)}`}
                  onPress={() => nav.navigate("Record", { id: record.id })}
                  style={{ width: 248 }}
                >
                  <Glass radius={16} style={{ padding: 16, gap: 6 }}>
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      <JournalIcon
                        name="heart"
                        color={colors.accent}
                        size={18}
                      />
                      <Text
                        style={[
                          s.muted,
                          { color: colors.accent, fontWeight: "600" },
                        ]}
                      >
                        {today.getFullYear() -
                          new Date(record.date).getFullYear()}{" "}
                        年前的今天
                      </Text>
                    </View>
                    <Text numberOfLines={2} style={s.heading}>
                      {recordTitle(record)}
                    </Text>
                    <Text style={s.muted}>{dateLabel(record.date)}</Text>
                  </Glass>
                </Pressable>
              ))}
            </ScrollView>
            {anniversaries.length > 1 && (
              <Text style={s.muted}>左右滑动，翻看每一个那年的今天。</Text>
            )}
          </Animated.View>
        )}
        {latestDraft && (
          <Card compact>
            <View style={s.between}>
              <Text style={s.muted}>{drafts.length} 份草稿</Text>
              <View style={s.row}>
                <Button
                  title="继续编辑"
                  compact
                  testID={`resume-${latestDraft.id}`}
                  onPress={() =>
                    nav.navigate("Editor", { draftId: latestDraft.id })
                  }
                />
                {drafts.length > 1 && (
                  <IconButton
                    label={draftsOpen ? "收起其他草稿" : "查看其他草稿"}
                    icon={draftsOpen ? "close" : "chevron-down"}
                    selected={draftsOpen}
                    onPress={() => setDraftsOpen(!draftsOpen)}
                  />
                )}
              </View>
            </View>
            {draftsOpen &&
              drafts.slice(1).map((draft) => (
                <Pressable
                  key={draft.id}
                  testID={`resume-${draft.id}`}
                  accessibilityRole="button"
                  accessibilityLabel={`继续编辑：${recordTitle(draft.content)}`}
                  onPress={() => nav.navigate("Editor", { draftId: draft.id })}
                  style={{ minHeight: 44, justifyContent: "center", gap: 2 }}
                >
                  <Text numberOfLines={1}>{recordTitle(draft.content)}</Text>
                  <Text style={s.muted}>
                    {dateLabel(draft.updatedAt)} ·{" "}
                    {draft.content.mediaIds.length} 份素材
                  </Text>
                </Pressable>
              ))}
          </Card>
        )}
        <ErrorText message={error} />
        {years.length > 0 && (
          <View style={{ gap: 16, marginTop: 8 }}>
            <Text style={[s.muted, { fontFamily: serif }]}>年度册</Text>
            <View
              style={{
                flexDirection: "row",
                flexWrap: "wrap",
                gap: 16,
              }}
            >
              {years.map((y, i) => {
                const yearRecords = records.filter(
                  (r) => yearKey(r.date) === y,
                );
                const yearFirsts = yearRecords.filter((r) => r.first).length;
                return (
                  <Volume
                    key={y}
                    title={`${y} 年`}
                    caption={
                      yearFirsts
                        ? `${yearRecords.length} 段时光 · ${yearFirsts} 个第一次`
                        : `${yearRecords.length} 段时光`
                    }
                    cover={coverForRecords(yearRecords, state.media)}
                    stamp={y}
                    testID={`volume-year-${y}`}
                    width={volumeWidth}
                    index={i}
                    onPress={() => nav.navigate("Year", { year: y })}
                  />
                );
              })}
            </View>
          </View>
        )}
        {months.length > 0 && (
          <View style={{ gap: 16, marginTop: 8 }}>
            <Text style={[s.muted, { fontFamily: serif }]}>月度册</Text>
            <View
              style={{
                flexDirection: "row",
                flexWrap: "wrap",
                gap: 16,
              }}
            >
              {firsts.length > 0 && (
                <Volume
                  title="第一次合集"
                  caption={`${firsts.length} 个第一次`}
                  fallbackIcon="star"
                  testID="volume-firsts"
                  width={volumeWidth}
                  index={0}
                  onPress={() => nav.navigate("Firsts")}
                />
              )}
              {months.map((m, i) => {
                const monthRecords = records.filter(
                  (r) => monthKey(r.date) === m,
                );
                const cover = coverForRecords(monthRecords, state.media);
                return (
                  <Volume
                    key={m}
                    title={monthLabel(m)}
                    caption={`${monthRecords.length} 段时光`}
                    cover={cover}
                    testID={`volume-${m}`}
                    width={volumeWidth}
                    index={firsts.length > 0 ? i + 1 : i}
                    onPress={() => nav.navigate("Month", { month: m })}
                  />
                );
              })}
            </View>
          </View>
        )}
        <View style={{ gap: 16, marginTop: 8 }}>
          <Text style={[s.muted, { fontFamily: serif }]}>专题册</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 16 }}>
            {albums.map((album, i) => (
              <Volume
                key={album.id}
                title={album.name}
                caption={`${album.items.length} 段记录`}
                cover={coverForAlbum(album, state)}
                testID={`album-${album.id}`}
                width={volumeWidth}
                index={i}
                onPress={() => nav.navigate("Album", { id: album.id })}
              />
            ))}
            <Volume
              title="新建相册"
              caption="把回忆放在一起"
              fallbackIcon="plus"
              testID="album-new"
              width={volumeWidth}
              index={albums.length}
              onPress={() => {
                void beginSelection(store)
                  .then((sessionId) => nav.navigate("Picker", { sessionId }))
                  .catch((e) => setError(messageOf(e)));
              }}
            />
          </View>
        </View>
        <View style={{ gap: 16, marginTop: 8 }}>
          <Text style={[s.muted, { fontFamily: serif }]}>时光系列</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 16 }}>
            {seriesList.map((series, i) => {
              const items = [...series.items].sort((a, b) =>
                a.month.localeCompare(b.month),
              );
              const latest = items[items.length - 1];
              const span =
                items.length > 1
                  ? monthIndex(items[items.length - 1]!.month) -
                    monthIndex(items[0]!.month) +
                    1
                  : 0;
              return (
                <Volume
                  key={series.id}
                  title={series.name}
                  caption={
                    items.length
                      ? span > 1
                        ? `${items.length} 张 · 跨 ${span} 个月`
                        : `${items.length} 张照片`
                      : "还没有照片"
                  }
                  cover={latest ? state.media[latest.mediaId] : undefined}
                  stamp={span > 1 ? `${span} 个月` : undefined}
                  testID={`series-${series.id}`}
                  width={volumeWidth}
                  index={i}
                  onPress={() => nav.navigate("Series", { id: series.id })}
                />
              );
            })}
            <Volume
              title="新建时光系列"
              caption="每月一张，看着长大"
              fallbackIcon="plus"
              testID="series-new"
              width={volumeWidth}
              index={seriesList.length}
              onPress={() => {
                void beginSeries(store)
                  .then((id) => nav.navigate("Series", { id }))
                  .catch((e) => setError(messageOf(e)));
              }}
            />
          </View>
          {clusters.length > 0 && (
            <Pressable
              testID="open-footprint"
              accessibilityRole="button"
              accessibilityLabel={`足迹，${clusters.length} 个常去的地方`}
              onPress={() => nav.navigate("Footprint")}
            >
              <Glass radius={16} style={{ padding: 16, gap: 6 }}>
                <Text style={s.heading}>足迹</Text>
                <Text style={s.muted}>
                  按拍摄位置聚成 {clusters.length} 个地点，看看她常去的地方。
                </Text>
              </Glass>
            </Pressable>
          )}
        </View>
        {records.length === 0 && (
          <View style={s.empty}>
            <Text style={s.heading}>把今天的小事留下来</Text>
            <Text style={s.muted}>
              点右下角的笔，写几句话，留一张照片。日子会慢慢长成一册册书。
            </Text>
            <Ornament />
          </View>
        )}
      </ScrollView>
      <CapturePen />
    </Page>
  );
}

export function coverForRecords(
  monthRecords: { mediaIds: string[]; coverId: string | null }[],
  media: Record<string, LocalMedia>,
): LocalMedia | undefined {
  for (const r of monthRecords) {
    const candidate = r.coverId ? media[r.coverId] : undefined;
    if (candidate?.kind === "image") return candidate;
    for (const id of r.mediaIds) {
      const m = media[id];
      if (m?.kind === "image") return m;
    }
  }
  return undefined;
}

function coverForAlbum(
  album: { coverId: string | null; items: { recordId: string }[] },
  state: ReturnType<typeof useLibrary>,
): LocalMedia | undefined {
  if (album.coverId) {
    const candidate = state.media[album.coverId];
    if (candidate?.kind === "image") return candidate;
  }
  for (const item of album.items) {
    const record = state.records[item.recordId];
    if (!record) continue;
    const cover = coverForRecords([record], state.media);
    if (cover) return cover;
  }
  return undefined;
}

export function Firsts() {
  const state = useLibrary(),
    s = useStyles();
  const nav = useNav();
  const firsts = sortedRecords(state)
    .filter((r) => r.first)
    .sort((a, b) => a.date.localeCompare(b.date));
  return (
    <Page>
      <Text style={s.title}>第一次合集</Text>
      <Text style={s.muted}>
        {firsts.length ? `${firsts.length} 个第一次，按日子排好。` : ""}
      </Text>
      {firsts.map((record) => (
        <Pressable
          key={record.id}
          testID={`first-${record.id}`}
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
      {firsts.length === 0 && (
        <View style={s.empty}>
          <Text style={s.heading}>还没有第一次</Text>
          <Text style={s.muted}>
            在阅读页点亮「第一次」，它就会收进这一册。
          </Text>
          <Ornament />
        </View>
      )}
    </Page>
  );
}

export function TitlePage() {
  const state = useLibrary(),
    s = useStyles(),
    { colors } = useTheme();
  const nav = useNav();
  const initial = (state.profile.name.trim() || "美")[0]!;
  return (
    <Page>
      <View style={{ alignItems: "center", paddingVertical: 48, gap: 20 }}>
        <Stamp size={96}>
          <Text
            style={{
              fontFamily: serif,
              fontSize: 40,
              lineHeight: 48,
              color: colors.accent,
              fontWeight: "600",
            }}
          >
            {initial}
          </Text>
        </Stamp>
        <Text style={[s.title, { textAlign: "center" }]}>
          {state.profile.name || "小美成长记"}
        </Text>
        {!!state.profile.birthday && (
          <Text style={s.muted}>生于 {dateLabel(state.profile.birthday)}</Text>
        )}
        <Text style={[s.muted, { textAlign: "center" }]}>
          记录保存在这台设备，慢慢长成一册册书。
        </Text>
        <Ornament />
        <Button
          title="完善宝宝资料"
          icon="person"
          onPress={() => nav.navigate("Profile")}
        />
      </View>
    </Page>
  );
}
