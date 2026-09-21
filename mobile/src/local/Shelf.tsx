import { useMemo, useState, type ReactNode } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  FadeInUp,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { useLibrary, useStore } from "./context";
import { CaptureFab } from "./CaptureFab";
import {
  beginDraft,
  beginLetter,
  beginSelection,
  beginSeries,
  now,
} from "./services";
import { letterCaption, letterState, sortLetters } from "./letters";
import {
  monthIndex,
  monthKey,
  recordTitle,
  sortedRecords,
  yearKey,
  type LocalMedia,
  type LocalRecord,
  type Stored, stampUnsigned, unsignedRecords } from "./model";
import { useNav } from "./navigation";
import { daysSinceExport } from "./backup";
import { CHILD_FALLBACK } from "./brand";
import { bookNudgeOf, nudgeOf, pickNudge, type NudgeKind } from "./nudge";
import { clusterPlaces } from "./places";
import { pickAnother } from "./shuffle";
import {
  ageLine,
  milestoneLabel,
  milestoneNumeral,
  milestoneOf,
} from "./dates";
import {
  Button,
  Card,
  ErrorText,
  IconButton,
  Ornament,
  PRESS_SPRING,
  Page,
  SectionHeader,
  SettingsRow,
  Text,
  dateLabel,
  hapticLight,
  messageOf,
  monthLabel,
  serif,
  useStyles,
  useTheme,
} from "./ui";
import { JournalIcon, type JournalIconName } from "../components/JournalIcon";
import { Photo } from "./Media";

/** 双线印章圆环：扉页名字首字与年度册封面共用；固定配色场景（重放剧场）用 color 覆盖。 */
export function Stamp({
  size,
  inset = 5,
  color,
  children,
}: {
  size: number;
  /** 内圈细线与外缘的留白；里程碑小印 44 用 3。 */
  inset?: number;
  color?: string;
  children: ReactNode;
}) {
  const { colors } = useTheme();
  const ring = color ?? colors.accent;
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: 2,
        borderColor: ring,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          top: inset,
          left: inset,
          right: inset,
          bottom: inset,
          borderRadius: size / 2 - inset,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: ring,
          opacity: 0.5,
        }}
      />
      {children}
    </View>
  );
}

/** 横向封面条：两侧出血到屏幕边，条内间距 12。 */
function Strip({ children }: { children: ReactNode }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ marginHorizontal: -20 }}
      contentContainerStyle={{
        paddingHorizontal: 20,
        gap: 12,
        alignItems: "flex-start",
      }}
    >
      {children}
    </ScrollView>
  );
}
/**
 * 书架区块：区标题 + 右侧文字级入口；没内容时一行说明，不摆虚位册。
 * heading 版给年份用：衬线大标题 + 一行统计——年份就是书架，月册摆在它名下。
 */
function ShelfSection({
  title,
  caption,
  heading = false,
  action,
  empty,
  children,
}: {
  title: string;
  caption?: string;
  heading?: boolean;
  action?: { label: string; onPress: () => void; testID?: string };
  empty?: string;
  children?: ReactNode;
}) {
  const s = useStyles();
  return (
    <View style={{ gap: 8 }}>
      {heading ? (
        <View>
          <View style={s.between}>
            <Text
              accessibilityRole="header"
              style={[s.heading, { flex: 1, minWidth: 0 }]}
            >
              {title}
            </Text>
            {action && (
              <Button
                title={action.label}
                kind="text"
                compact
                onPress={action.onPress}
                testID={action.testID}
              />
            )}
          </View>
          {!!caption && <Text style={s.muted}>{caption}</Text>}
        </View>
      ) : (
        <SectionHeader title={title} action={action} />
      )}
      {children ? children : !!empty && <Text style={s.muted}>{empty}</Text>}
    </View>
  );
}
/** 几本书册成组的纸卡：行与行之间只有一条细线。 */
function BookRows({ children }: { children: ReactNode }) {
  return <Card style={{ gap: 0, paddingVertical: 4 }}>{children}</Card>;
}
/** 纸面小签：没有照片的书册在行里的封面——纸底、细描边、左侧书脊细条，中间一个图标或一枚小印章。 */
function PaperTile({
  icon,
  stamp,
}: {
  icon?: JournalIconName;
  stamp?: string;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        width: 60,
        height: 45,
        borderRadius: 8,
        backgroundColor: colors.paper,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: colors.line,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          left: 5,
          top: 7,
          bottom: 7,
          width: 2,
          borderRadius: 1,
          backgroundColor: colors.accent,
          opacity: 0.7,
        }}
      />
      {stamp ? (
        <Stamp size={30} inset={3}>
          <Text
            style={{
              fontFamily: serif,
              fontSize: stamp.length > 1 ? 9 : 13,
              lineHeight: 16,
              color: colors.accent,
              fontWeight: "600",
            }}
          >
            {stamp}
          </Text>
        </Stamp>
      ) : (
        <JournalIcon name={icon ?? "book"} color={colors.accent} size={20} />
      )}
    </View>
  );
}
/** 书册行：小封面（照片缩略图，没有就纸面小签）+ 衬线书名 + 说明 + 右箭头。 */
function BookRow({
  title,
  caption,
  cover,
  tile,
  testID,
  onPress,
  last = false,
}: {
  title: string;
  caption: string;
  cover?: LocalMedia;
  tile: ReactNode;
  testID?: string;
  onPress: () => void;
  last?: boolean;
}) {
  return (
    <SettingsRow
      leading={
        cover ? (
          <View style={{ width: 60 }}>
            <Photo media={cover} preview ratio={4 / 3} radius={8} />
          </View>
        ) : (
          tile
        )
      }
      serifLabel
      label={title}
      subtitle={caption}
      onPress={onPress}
      testID={testID}
      last={last}
    />
  );
}
/**
 * 「最近」翻页条：整宽时光卡左右翻，按卡吸附，右侧露出下一张的一角提示还能翻；
 * 多于一张时下面一排圆点。只有一段时光时首页顶上就是一张大照片，而不是一个小方块。
 */
function RecentFlip({
  records,
  media,
  onOpen,
}: {
  records: Stored<LocalRecord>[];
  media: Record<string, LocalMedia>;
  onOpen: (id: string) => void;
}) {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(0);
  // 卡宽 = 可用宽 − 两侧页边 40 − 16：加上 12 的卡距，下一张露出 24。右内边距 36 让最后一张也能对齐页边。
  const cardWidth = Math.max(200, width - insets.left - insets.right - 56);
  const interval = cardWidth + 12;
  const many = records.length > 1;
  const settle = (x: number) =>
    setIndex(
      Math.min(records.length - 1, Math.max(0, Math.round(x / interval))),
    );
  return (
    <View style={{ gap: 10 }}>
      <ScrollView
        horizontal
        scrollEnabled={many}
        showsHorizontalScrollIndicator={false}
        snapToInterval={interval}
        snapToAlignment="start"
        decelerationRate="fast"
        disableIntervalMomentum
        onMomentumScrollEnd={(e) => settle(e.nativeEvent.contentOffset.x)}
        onScrollEndDrag={(e) => settle(e.nativeEvent.contentOffset.x)}
        style={{ marginHorizontal: -20 }}
        contentContainerStyle={{
          paddingLeft: 20,
          paddingRight: 36,
          gap: 12,
          alignItems: "flex-start",
        }}
      >
        {records.map((record, i) => (
          <RecentCard
            key={record.id}
            record={record}
            cover={coverForRecords([record], media)}
            width={cardWidth}
            index={i}
            testID={`recent-${record.id}`}
            onPress={() => onOpen(record.id)}
          />
        ))}
      </ScrollView>
      {many && (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{ flexDirection: "row", justifyContent: "center", gap: 6 }}
        >
          {records.map((record, i) => (
            <View
              key={record.id}
              style={{
                width: i === index ? 16 : 6,
                height: 6,
                borderRadius: 3,
                backgroundColor: i === index ? colors.accent : colors.line,
              }}
            />
          ))}
        </View>
      )}
    </View>
  );
}
/** 整宽时光卡：有图时照片 4:3 铺满卡顶，下面日期、衬线标题与正文两行；无图时纸面上正文四行 + 日期。 */
function RecentCard({
  record,
  cover,
  width,
  index,
  testID,
  onPress,
}: {
  record: Stored<LocalRecord>;
  cover?: LocalMedia;
  width: number;
  index: number;
  testID?: string;
  onPress: () => void;
}) {
  const s = useStyles();
  const reduceMotion = useReducedMotion();
  const title = recordTitle(record);
  const body = record.text.trim();
  // 标题是拿正文首行凑出来的，就不要再把同一句当摘要重复一遍。
  const excerpt = record.title.trim()
    ? body
    : body.split("\n").slice(1).join(" ").trim();
  return (
    <Animated.View
      entering={
        reduceMotion
          ? undefined
          : FadeInUp.delay(Math.min(index, 8) * 60).duration(320)
      }
      style={{ width }}
    >
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={`${title}，${dateLabel(record.date)}`}
        onPress={onPress}
        style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
      >
        <Card style={{ padding: 0, gap: 0 }}>
          {cover ? (
            <View
              style={{
                borderTopLeftRadius: 16,
                borderTopRightRadius: 16,
                overflow: "hidden",
              }}
            >
              <Photo media={cover} preview ratio={4 / 3} radius={0} />
            </View>
          ) : (
            <View
              style={{
                paddingHorizontal: 16,
                paddingTop: 18,
                minHeight: 120,
                justifyContent: "center",
              }}
            >
              <Text
                numberOfLines={4}
                style={{
                  fontFamily: serif,
                  fontSize: 17,
                  lineHeight: 27,
                  letterSpacing: 0.3,
                }}
              >
                {body || title}
              </Text>
            </View>
          )}
          <View style={{ paddingHorizontal: 16, paddingVertical: 12, gap: 2 }}>
            <Text style={s.footnote}>{dateLabel(record.date)}</Text>
            {(cover || !!record.title.trim()) && (
              <Text numberOfLines={1} style={s.heading}>
                {title}
              </Text>
            )}
            {!!cover && !!excerpt && (
              <Text numberOfLines={2} style={s.muted}>
                {excerpt}
              </Text>
            )}
          </View>
        </Card>
      </Pressable>
    </Animated.View>
  );
}
/** 书架提醒卡：一行标题（可带印章与引导语）、一句说明、一个次级动作，右上 ✕ 关掉。 */
function NudgeCard({
  testID,
  titleTestID,
  stamp,
  eyebrow,
  title,
  body,
  action,
  onClose,
}: {
  testID?: string;
  titleTestID?: string;
  stamp?: ReactNode;
  eyebrow?: string;
  title: string;
  body?: string;
  action: { label: string; testID?: string; onPress: () => void };
  onClose: () => void;
}) {
  const s = useStyles(),
    { colors } = useTheme();
  const reduceMotion = useReducedMotion();
  return (
    <Animated.View
      entering={reduceMotion ? undefined : FadeInUp.duration(320)}
      testID={testID}
    >
      <Card>
        <View
          style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}
        >
          {stamp}
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            {!!eyebrow && (
              <Text
                style={[s.muted, { color: colors.accent, fontWeight: "600" }]}
              >
                {eyebrow}
              </Text>
            )}
            <Text style={s.heading} testID={titleTestID}>
              {title}
            </Text>
            {!!body && <Text style={s.muted}>{body}</Text>}
          </View>
          <View style={{ marginTop: -8, marginRight: -8 }}>
            <IconButton label="关掉这条提醒" icon="close" onPress={onClose} />
          </View>
        </View>
        <View style={s.row}>
          <Button
            title={action.label}
            compact
            testID={action.testID}
            onPress={action.onPress}
          />
        </View>
      </Card>
    </Animated.View>
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
  ratio = 4 / 3,
}: {
  title: string;
  caption: string;
  cover?: LocalMedia;
  fallbackIcon?: "book" | "star" | "plus" | "pin";
  /** 无封面时盖在纸封面上的印章文字（年度册年份）。 */
  stamp?: string;
  onPress: () => void;
  testID?: string;
  width: number;
  index?: number;
  /** 封面裁切比例：书架条 4:3，年度册里的月册网格用 1。 */
  ratio?: number;
}) {
  const s = useStyles(),
    { colors, large } = useTheme();
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
      style={[{ width }, pressStyle]}
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
        style={{ gap: 6 }}
      >
        {cover ? (
          <Photo media={cover} preview ratio={ratio} />
        ) : (
          <View
            style={[
              s.section,
              {
                aspectRatio: ratio,
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
        <View style={{ gap: 1 }}>
          <Text
            numberOfLines={1}
            style={{
              fontFamily: serif,
              fontWeight: "600",
              letterSpacing: 0.3,
              lineHeight: large ? 26 : 22,
            }}
          >
            {title}
          </Text>
          <Text
            numberOfLines={1}
            style={[s.muted, { lineHeight: large ? 20 : 18 }]}
          >
            {caption}
          </Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}

export function Shelf() {
  const state = useLibrary(),
    store = useStore(),
    nav = useNav(),
    s = useStyles(),
    { colors, large } = useTheme();
  // 横向封面条：封面固定 4:3 裁切，宽 140、大字 200。
  const stripWidth = large ? 200 : 140;
  const [draftsOpen, setDraftsOpen] = useState(false),
    [error, setError] = useState("");
  // store 只在某个集合真的动过时才换它的引用，所以按集合记忆：改一条草稿不会
  // 让一万条记录重新排序，主题、尺寸与本页 useState 引起的重渲染都命中缓存。
  const {
    records: recordMap,
    albums: albumMap,
    series: seriesMap,
    media: mediaMap,
    drafts: draftMap,
    letters: letterMap,
  } = state;
  const records = useMemo(
    () => sortedRecords({ records: recordMap }),
    [recordMap],
  );
  // 下面几项都是对已排序数组的一趟线性遍历，交给 React Compiler 自动记忆即可。
  const months = [...new Set(records.map((r) => monthKey(r.date)))];
  const years = [...new Set(records.map((r) => yearKey(r.date)))];
  const firsts = records
    .filter((r) => r.first)
    .sort((a, b) => a.date.localeCompare(b.date));
  const quotes = records.filter((r) => r.quote);
  // 年份就是书架：最近 6 个月按年归组，每年一条月册封面条；更早的年份收成「往年」几行。
  const shelfMonths = months.slice(0, 6);
  const shelfYearKeys = [...new Set(shelfMonths.map((m) => m.slice(0, 4)))];
  const yearStats = (year: string) => {
    const yearRecords = records.filter((r) => yearKey(r.date) === year);
    const yearFirsts = yearRecords.filter((r) => r.first).length;
    return {
      year,
      caption: yearFirsts
        ? `${yearRecords.length} 段时光 · ${yearFirsts} 个第一次`
        : `${yearRecords.length} 段时光`,
      cover: coverForRecords(yearRecords, mediaMap),
    };
  };
  const shelfYears = shelfYearKeys.map((year) => ({
    ...yearStats(year),
    months: shelfMonths.filter((m) => m.startsWith(year)),
  }));
  const olderYears = years
    .filter((year) => !shelfYearKeys.includes(year))
    .map(yearStats);
  const today = new Date();
  const anniversaries = records.filter((r) => {
    const d = new Date(r.date);
    return (
      d.getFullYear() < today.getFullYear() &&
      d.getMonth() === today.getMonth() &&
      d.getDate() === today.getDate()
    );
  });
  const albums = useMemo(
    () =>
      Object.values(albumMap).sort(
        (a, b) =>
          b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id),
      ),
    [albumMap],
  );
  const seriesList = useMemo(
    () =>
      Object.values(seriesMap).sort(
        (a, b) =>
          b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id),
      ),
    [seriesMap],
  );
  const clusters = useMemo(
    () => clusterPlaces(Object.values(mediaMap)),
    [mediaMap],
  );
  const drafts = useMemo(
    () =>
      Object.values(draftMap).sort((a, b) =>
        b.updatedAt.localeCompare(a.updatedAt),
      ),
    [draftMap],
  );
  const letters = useMemo(
    () => sortLetters(Object.values(letterMap), new Date()),
    [letterMap],
  );
  const latestDraft = drafts[0];
  const nudge = nudgeOf(
    records[0]?.date ?? null,
    latestDraft?.updatedAt ?? null,
    drafts.length,
  );
  const bookNudge = bookNudgeOf(
    today,
    years,
    Object.keys(state.yearBooksBoundAt ?? {}),
  );
  const exportedDays = daysSinceExport(state),
    backupDue =
      records.length > 0 && (exportedDays === null || exportedDays > 30);
  const age = ageLine(state.profile.birthday),
    milestone = milestoneOf(state.profile.birthday);
  const initial = (state.profile.name.trim() || CHILD_FALLBACK)[0]!;
  // 同屏只放一张提醒卡：里程碑 > 装订 > 备份 > 节奏；关掉的写进库里，沉默期见 nudge.ts。
  const candidates: NudgeKind[] = [];
  // 落款卡：这台手机定了默认落款、库里还有没落款的记录时问一次；「都是」一次写上，关掉就永远不再问。
  const unsigned = useMemo(() => unsignedRecords({ records: recordMap }), [recordMap]);
  const defaultBy = state.settings.by;
  if (defaultBy && unsigned.length) candidates.push("by");
  if (milestone) candidates.push("milestone");
  if (bookNudge) candidates.push("book");
  if (backupDue) candidates.push("backup");
  if (nudge) candidates.push("rhythm");
  const nudgeKind = pickNudge(candidates, state.nudgeClosedAt, today);
  const closeNudge = (kind: NudgeKind) => {
    void store
      .change((lib) => {
        lib.nudgeClosedAt = { ...lib.nudgeClosedAt, [kind]: now() };
      })
      .catch((e) => setError(messageOf(e)));
  };
  const captureNow = () => {
    hapticLight();
    void beginDraft(store)
      .then((draftId) => nav.navigate("Editor", { draftId }))
      .catch((e) => setError(messageOf(e)));
  };
  return (
    <Page scroll={false} top>
      <ScrollView
        contentContainerStyle={[s.content, { gap: 24, paddingBottom: 120 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={s.between}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="翻开扉页"
            onPress={() => nav.navigate("Title")}
            style={{ flex: 1, minWidth: 0, gap: 2 }}
          >
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 2 }}
            >
              <Text numberOfLines={2} style={[s.title, { flexShrink: 1 }]}>
                {state.profile.name
                  ? `${state.profile.name}的成长记`
                  : "成长中的每一天"}
              </Text>
              <JournalIcon
                name="chevron-right"
                color={colors.muted}
                size={18}
              />
            </View>
            {age ? (
              <Text style={s.muted} testID="shelf-age">
                {age}
              </Text>
            ) : (
              <Text style={s.muted}>
                {records.length
                  ? `${records.length} 段时光`
                  : "从今天的一件小事开始"}
              </Text>
            )}
          </Pressable>
          <IconButton
            label="搜索全部记录"
            icon="search"
            testID="open-search"
            onPress={() => nav.navigate("Search")}
          />
          <Pressable
            testID="open-settings"
            accessibilityRole="button"
            accessibilityLabel="我的"
            onPress={() => nav.navigate("Settings")}
            style={({ pressed }) => ({
              width: 44,
              height: 44,
              alignItems: "center",
              justifyContent: "center",
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Stamp size={32} inset={3}>
              <Text
                style={{
                  fontFamily: serif,
                  fontSize: 15,
                  lineHeight: 18,
                  color: colors.accent,
                  fontWeight: "600",
                }}
              >
                {initial}
              </Text>
            </Stamp>
          </Pressable>
        </View>
        {nudgeKind === "milestone" && milestone && (
          <NudgeCard
            testID="milestone-card"
            eyebrow={milestoneLabel(milestone)}
            title="把今天好好记下来"
            stamp={
              <Stamp size={44} inset={3}>
                <Text
                  style={{
                    fontFamily: serif,
                    fontSize: milestone.kind === "hundred" ? 13 : 18,
                    color: colors.accent,
                    fontWeight: "600",
                  }}
                >
                  {milestoneNumeral(milestone)}
                </Text>
              </Stamp>
            }
            action={{
              label: "记一刻",
              testID: "milestone-card-action",
              onPress: captureNow,
            }}
            onClose={() => closeNudge("milestone")}
          />
        )}
        {nudgeKind === "by" && defaultBy && (
          <NudgeCard
            titleTestID="by-nudge"
            title={`以前的 ${unsigned.length} 段时光还没有落款`}
            body={`都是${defaultBy}写的吗？点「都是」一次写上；不是的话关掉，以后不再问。`}
            action={{
              label: "都是",
              testID: "by-nudge-action",
              onPress: () => {
                void store
                  .change((lib) => {
                    stampUnsigned(lib, defaultBy);
                    lib.nudgeClosedAt = { ...lib.nudgeClosedAt, by: now() };
                  })
                  .catch((e) => setError(messageOf(e)));
              },
            }}
            onClose={() => closeNudge("by")}
          />
        )}
        {nudgeKind === "book" && bookNudge && (
          <NudgeCard
            titleTestID="book-nudge"
            title="去年的纪念册可以装订了"
            body={`${bookNudge.year} 年已经翻过去了，把它排成一本册子，留在书架上。`}
            action={{
              label: "去年度册",
              testID: "book-nudge-action",
              onPress: () => nav.navigate("Year", { year: bookNudge.year }),
            }}
            onClose={() => closeNudge("book")}
          />
        )}
        {nudgeKind === "backup" && (
          <NudgeCard
            testID="backup-reminder"
            title={
              exportedDays === null
                ? "还没有导出过备份"
                : `已经 ${exportedDays} 天没有备份了`
            }
            body="记录只保存在这台手机上。定期导出一份，把这段时光留到应用之外。"
            action={{
              label: "去备份",
              testID: "backup-reminder-action",
              onPress: () => nav.navigate("Backup"),
            }}
            onClose={() => closeNudge("backup")}
          />
        )}
        {nudgeKind === "rhythm" && nudge && (
          <NudgeCard
            titleTestID="rhythm-nudge"
            title={
              nudge.kind === "draft"
                ? "有一份草稿还没写完"
                : `有 ${nudge.days} 天没记啦`
            }
            body={
              nudge.kind === "draft"
                ? "接着上次的话头写下去吧。"
                : "日子过得快，挑一件小事写下来。"
            }
            action={{
              label: nudge.kind === "draft" ? "继续写" : "记一刻",
              testID: "rhythm-nudge-action",
              onPress: () => {
                if (nudge.kind === "draft" && latestDraft) {
                  nav.navigate("Editor", { draftId: latestDraft.id });
                  return;
                }
                captureNow();
              },
            }}
            onClose={() => closeNudge("rhythm")}
          />
        )}
        <ShelfSection
          title="最近"
          action={
            records.length >= 3
              ? {
                  label: "随便翻翻",
                  testID: "shuffle",
                  onPress: () => {
                    const id = pickAnother(records.map((r) => r.id));
                    if (id) nav.navigate("Record", { id, shuffle: true });
                  },
                }
              : undefined
          }
        >
          {records.length > 0 ? (
            <RecentFlip
              records={records.slice(0, 10)}
              media={mediaMap}
              onOpen={(id) => nav.navigate("Record", { id })}
            />
          ) : (
            <Card>
              <Text style={s.heading}>把今天的小事留下来</Text>
              <Text style={s.muted}>
                写几句话，留一张照片。日子会慢慢长成一册册书。
              </Text>
              <View style={s.row}>
                <Button
                  title="记一刻"
                  primary
                  icon="edit"
                  testID="capture-first"
                  onPress={captureNow}
                />
              </View>
            </Card>
          )}
        </ShelfSection>
        {latestDraft && (
          <Card compact>
            <View style={s.between}>
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <Text style={s.muted}>
                  {drafts.length > 1 ? `${drafts.length} 份草稿` : "上次没写完"}
                </Text>
                <Text numberOfLines={1}>
                  {recordTitle(latestDraft.content)}
                </Text>
              </View>
              <Button
                title="继续编辑"
                kind="text"
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
                    {dateLabel(draft.updatedAt)}
                    {draft.content.mediaIds.length
                      ? ` · ${draft.content.mediaIds.length} 个附件`
                      : ""}
                  </Text>
                </Pressable>
              ))}
          </Card>
        )}
        <ErrorText message={error} />
        {anniversaries.length > 0 && (
          <ShelfSection title="那年今日">
            <Strip>
              {anniversaries.map((record, index) => (
                <Pressable
                  key={record.id}
                  testID={index === 0 ? "anniversary" : `anniversary-${index}`}
                  accessibilityRole="button"
                  accessibilityLabel={`那年今日，${recordTitle(record)}`}
                  onPress={() => nav.navigate("Record", { id: record.id })}
                  style={{ width: 248 }}
                >
                  <Card compact style={{ gap: 4 }}>
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      <JournalIcon
                        name="calendar"
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
                  </Card>
                </Pressable>
              ))}
            </Strip>
          </ShelfSection>
        )}
        {shelfYears.map((shelf) => (
          <ShelfSection
            key={shelf.year}
            heading
            title={`${shelf.year} 年`}
            caption={shelf.caption}
            action={{
              label: "翻开年度册",
              testID: `volume-year-${shelf.year}`,
              onPress: () => nav.navigate("Year", { year: shelf.year }),
            }}
          >
            <Strip>
              {shelf.months.map((m, i) => {
                const monthRecords = records.filter(
                  (r) => monthKey(r.date) === m,
                );
                return (
                  <Volume
                    key={m}
                    title={monthLabel(m)}
                    caption={`${monthRecords.length} 段时光`}
                    cover={coverForRecords(monthRecords, mediaMap)}
                    testID={`volume-${m}`}
                    width={stripWidth}
                    index={i}
                    onPress={() => nav.navigate("Month", { month: m })}
                  />
                );
              })}
            </Strip>
          </ShelfSection>
        ))}
        {olderYears.length > 0 && (
          <ShelfSection title="往年">
            <BookRows>
              {olderYears.map((shelf, i) => (
                <BookRow
                  key={shelf.year}
                  title={`${shelf.year} 年`}
                  caption={shelf.caption}
                  cover={shelf.cover}
                  tile={<PaperTile icon="book" />}
                  testID={`volume-year-${shelf.year}`}
                  onPress={() => nav.navigate("Year", { year: shelf.year })}
                  last={i === olderYears.length - 1}
                />
              ))}
            </BookRows>
          </ShelfSection>
        )}
        {(firsts.length > 0 || quotes.length > 0 || clusters.length > 0) && (
          <ShelfSection title="合集">
            <BookRows>
              {firsts.length > 0 && (
                <BookRow
                  title="第一次合集"
                  caption={`${firsts.length} 个第一次`}
                  tile={<PaperTile icon="star" />}
                  testID="volume-firsts"
                  onPress={() => nav.navigate("Firsts")}
                  last={quotes.length === 0 && clusters.length === 0}
                />
              )}
              {quotes.length > 0 && (
                <BookRow
                  title="她说的话"
                  caption={`${quotes.length} 句原话`}
                  tile={<PaperTile stamp="语" />}
                  testID="volume-quotes"
                  onPress={() => nav.navigate("Quotes")}
                  last={clusters.length === 0}
                />
              )}
              {clusters.length > 0 && (
                <BookRow
                  title="足迹"
                  caption={`${clusters.length} 个常去的地方`}
                  tile={<PaperTile icon="pin" />}
                  testID="open-footprint"
                  onPress={() => nav.navigate("Footprint")}
                  last
                />
              )}
            </BookRows>
          </ShelfSection>
        )}
        <ShelfSection
          title="专题册"
          action={{
            label: "新建相册",
            testID: "album-new",
            onPress: () => {
              void beginSelection(store)
                .then((sessionId) => nav.navigate("Picker", { sessionId }))
                .catch((e) => setError(messageOf(e)));
            },
          }}
          empty="还没有相册。把几段时光放在一起，就是一本。"
        >
          {albums.length > 0 && (
            <BookRows>
              {albums.map((album, i) => (
                <BookRow
                  key={album.id}
                  title={album.name}
                  caption={`${album.items.length} 段时光`}
                  cover={coverForAlbum(album, state)}
                  tile={<PaperTile icon="book" />}
                  testID={`album-${album.id}`}
                  onPress={() => nav.navigate("Album", { id: album.id })}
                  last={i === albums.length - 1}
                />
              ))}
            </BookRows>
          )}
        </ShelfSection>
        <ShelfSection
          title="时间胶囊"
          action={{
            label: "写一封信",
            testID: "letter-new",
            onPress: () => {
              void beginLetter(store)
                .then((id) => nav.navigate("LetterEditor", { id }))
                .catch((e) => setError(messageOf(e)));
            },
          }}
          empty="给多年后的她写一封信，到日子再拆。"
        >
          {letters.length > 0 && (
            <BookRows>
              {letters.map((letter, i) => (
                <BookRow
                  key={letter.id}
                  title={letter.title || "一封信"}
                  caption={letterCaption(letter, today)}
                  tile={
                    <PaperTile stamp={letter.from.trim().charAt(0) || "信"} />
                  }
                  testID={`letter-${letter.id}`}
                  onPress={() =>
                    nav.navigate(
                      letterState(letter, today) === "draft"
                        ? "LetterEditor"
                        : "Letter",
                      { id: letter.id },
                    )
                  }
                  last={i === letters.length - 1}
                />
              ))}
            </BookRows>
          )}
        </ShelfSection>
        <ShelfSection
          title="时光系列"
          action={{
            label: "新建系列",
            testID: "series-new",
            onPress: () => {
              void beginSeries(store)
                .then((id) => nav.navigate("Series", { id }))
                .catch((e) => setError(messageOf(e)));
            },
          }}
          empty="每月一张同款照片，看着她慢慢长大。"
        >
          {seriesList.length > 0 && (
            <BookRows>
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
                  <BookRow
                    key={series.id}
                    title={series.name}
                    caption={
                      items.length
                        ? span > 1
                          ? `${items.length} 张 · 跨 ${span} 个月`
                          : `${items.length} 张照片`
                        : "还没有照片"
                    }
                    cover={latest ? mediaMap[latest.mediaId] : undefined}
                    tile={<PaperTile icon="image" />}
                    testID={`series-${series.id}`}
                    onPress={() => nav.navigate("Series", { id: series.id })}
                    last={i === seriesList.length - 1}
                  />
                );
              })}
            </BookRows>
          )}
        </ShelfSection>
      </ScrollView>
      <CaptureFab />
    </Page>
  );
}

export function coverForRecords(
  monthRecords: { mediaIds: readonly string[]; coverId: string | null }[],
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
  album: { coverId: string | null; items: readonly { recordId: string }[] },
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
    <Page title="第一次合集">
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
          <View style={s.row}>
            <Button title="回书架" kind="text" onPress={() => nav.goBack()} />
          </View>
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
  const initial = (state.profile.name.trim() || CHILD_FALLBACK)[0]!;
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
        {state.profile.name ? (
          <Text style={[s.title, { textAlign: "center" }]}>
            {state.profile.name}
          </Text>
        ) : (
          <Text
            style={[s.heading, { textAlign: "center", color: colors.muted }]}
          >
            还没填名字
          </Text>
        )}
        {!!state.profile.birthday && (
          <Text style={s.muted}>生于 {dateLabel(state.profile.birthday)}</Text>
        )}
        <Text style={[s.muted, { textAlign: "center" }]}>
          记录保存在这台手机上，慢慢长成一册册书。
        </Text>
        <Ornament />
        <Button
          title="完善资料"
          icon="person"
          onPress={() => nav.navigate("Profile")}
        />
      </View>
    </Page>
  );
}
