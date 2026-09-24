import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AppState,
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
import { useLibrary, useStore, useSyncStatus } from "./context";
import { CaptureFab, FAB_INSET, FAB_SIZE } from "./CaptureFab";
import {
  beginDraft,
  beginLetter,
  beginSelection,
  now,
} from "./services";
import {
  letterCaption,
  letterShortCaption,
  letterState,
  sortLetters,
} from "./letters";
import {
  fullNameLine,
  sealInitial,
  letterSeal,
  monthKey,
  recordTitle,
  sortedRecords,
  yearKey,
  type LocalMedia,
  type LocalRecord,
  type RecordDraft,
  type Stored, stampUnsigned, unsignedRecords,
  compareDates,
} from "./model";
import { useNav } from "./navigation";
import { daysSinceExport } from "./backup";
import {
  backupDueOf,
  backupNudgeBody,
  bookNudgeOf,
  nudgeOf,
  pickNudge,
  type NudgeKind,
} from "./nudge";
import { pickAnother } from "./shuffle";
import {
  heroItems,
  shelfTiles,
  type HeroItem,
  type ShelfTile,
} from "./shelf-plan";
import {
  ageLine,
  milestoneLabel,
  milestoneNumeral,
  milestoneOf,
  toDayKey,
} from "./dates";
import {
  Button,
  Card,
  ErrorText,
  IconButton,
  IconTile,
  Ornament,
  PRESS_SPRING,
  Page,
  SectionHeader,
  SettingsRow,
  Stamp,
  Text,
  dateLabel,
  hapticLight,
  messageOf,
  serif,
  useLargeLayout,
  useStyles,
  useTextScale,
  useTheme,
  type TileTone,
} from "./ui";
import { JournalIcon, type JournalIconName } from "../components/JournalIcon";
import { Photo } from "./Media";

/** 卡片投影（y5／半径 18）在横向条里要留的底部空间；再往下投影已淡到看不出裁切。 */
const CARD_SHADOW_ROOM = 14;
/**
 * 「最近」卡最矮多高：首屏剩下的地方比这还少（更大文字、小屏、提醒卡与草稿同时在），
 * 首页才退回可以往下滑——宁可滑一点，也不把照片压成一道缝。卡里最少的内容
 * （照片 + 日期 + 标题一行 + 正文一行）按实际行高比这还高时，以内容为准，见 heroCardMin。
 */
const HERO_CARD_MIN = 180;
/** 有字的卡上照片最矮多高：卡矮时照片先让出地方给字，但不压成一道缝。 */
const HERO_PHOTO_MIN = 64;
/** 有图的卡照片下那一段字的上下内边距与行距；无图的卡是纸面内边距与行距。 */
const HERO_TEXT_PAD = 12,
  HERO_TEXT_GAP = 2,
  HERO_PLAIN_PAD = 16,
  HERO_PLAIN_GAP = 4;
/** 「N 年前的今天」前面日历图标的边长。 */
const HERO_EYEBROW_ICON = 16;
/** 卡里衬线正文的字号与行高（系统字号放大之前），跟应用的「更大文字」走。 */
const heroBodyFont = (large: boolean) =>
  large ? { fontSize: 19, lineHeight: 30 } : { fontSize: 17, lineHeight: 27 };
/** 书架一格的宽，也是方形小封面的边长；按大字排版（更大文字或系统字号 ≥ 1.3）时放大。 */
const TILE = 76;
const TILE_LARGE = 92;
/** 书架一格的书名：衬线一行，字号跟应用的「更大文字」走。 */
const tileTitleFont = (large: boolean) =>
  large ? { fontSize: 16, lineHeight: 22 } : { fontSize: 14, lineHeight: 20 };
/** 书名最长的那本（「第一次合集」）有几个字：格宽至少放得下这么多字，书名不截成「202…」。 */
const TILE_TITLE_CHARS = 5;
/**
 * 书架一格的边长：大字排版时放大；系统字号再往上放大时，格宽跟着实际字号走，
 * 至少放得下 TILE_TITLE_CHARS 个书名字（含字距）。
 */
function useTileSize() {
  const { large } = useTheme();
  const base = useLargeLayout() ? TILE_LARGE : TILE;
  const title = tileTitleFont(large).fontSize * useTextScale();
  return Math.max(base, Math.ceil((title + 0.3) * TILE_TITLE_CHARS));
}

/**
 * 新建的引导行：图标砖 + 一句说明，点按即新建——说明与下一步合一，不摆虚位册。
 * 调用方把几行成组放进一张 BookRows。
 */
function GuideRow({
  icon,
  tone,
  title,
  hint,
  testID,
  onPress,
  last = false,
}: {
  icon: JournalIconName;
  tone: TileTone;
  title: string;
  hint: string;
  testID?: string;
  onPress: () => void;
  last?: boolean;
}) {
  return (
    <SettingsRow
      leading={<IconTile icon={icon} tone={tone} />}
      label={title}
      subtitle={hint}
      onPress={onPress}
      testID={testID}
      last={last}
    />
  );
}
/** 书架上的月册名：年度册就摆在它前面，只留「9 月」。 */
const monthName = (key: string) => `${Number(key.slice(5, 7))} 月`;
/** 几行成组的纸卡：行与行之间只有一条细线。 */
function BookRows({ children }: { children: ReactNode }) {
  return <Card style={{ gap: 0, paddingVertical: 4 }}>{children}</Card>;
}
/**
 * 纸面小签：没有照片的书在书架上的封面——白纸底、细描边、左侧赤陶书脊细条，
 * 中间一个图标或一枚小印章（年度册是年份、信是落款首字、她说的话是「语」）。
 */
function TileCover({
  size,
  icon,
  stamp,
}: {
  size: number;
  icon?: JournalIconName;
  stamp?: string;
}) {
  const { colors, dark } = useTheme();
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: 12,
        backgroundColor: colors.glass,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: colors.glassLine,
        alignItems: "center",
        justifyContent: "center",
        shadowColor: dark ? "#000000" : "#7A5C3E",
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: dark ? 0.3 : 0.08,
        shadowRadius: 10,
        elevation: 2,
      }}
    >
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          left: 7,
          top: 12,
          bottom: 12,
          width: 3,
          borderRadius: 1.5,
          backgroundColor: colors.accent,
          opacity: 0.7,
        }}
      />
      {stamp ? (
        <Stamp size={Math.round(size * 0.56)} inset={3}>
          {/* 印章里的字是装饰，读屏念的是整格的标签；Stamp 让它不跟系统字号放大。 */}
          <Text
            style={{
              fontFamily: serif,
              fontSize: stamp.length > 2 ? 12 : 17,
              lineHeight: stamp.length > 2 ? 16 : 22,
              color: colors.accent,
              fontWeight: "600",
            }}
          >
            {stamp}
          </Text>
        </Stamp>
      ) : (
        <JournalIcon
          name={icon ?? "book"}
          color={colors.accent}
          size={Math.round(size * 0.34)}
        />
      )}
    </View>
  );
}
/**
 * 书架一格：方形小封面（有照片用照片，没有就纸面小签）+ 衬线书名一行 + 说明一行。
 * 读屏把书名与说明合成一句，说明可以另给完整的一版（信的小格只写得下「封存至 2042」）。
 */
function ShelfTileView({
  title,
  caption,
  spokenCaption,
  cover,
  icon,
  stamp,
  testID,
  index,
  onPress,
}: {
  title: string;
  caption: string;
  spokenCaption?: string;
  cover?: LocalMedia;
  icon?: JournalIconName;
  stamp?: string;
  testID?: string;
  index: number;
  onPress: () => void;
}) {
  const s = useStyles(),
    { large } = useTheme();
  const reduceMotion = useReducedMotion();
  const scale = useSharedValue(1);
  const pressStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));
  const size = useTileSize();
  return (
    <Animated.View
      entering={
        reduceMotion
          ? undefined
          : FadeInUp.delay(Math.min(index, 8) * 50).duration(300)
      }
      style={[{ width: size }, pressStyle]}
    >
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={`${title}，${spokenCaption ?? caption}`}
        onPress={onPress}
        onPressIn={() => {
          if (reduceMotion) return;
          // eslint-disable-next-line react-hooks/immutability -- reanimated 共享值的就地修改是其既定用法
          scale.value = withSpring(0.94, PRESS_SPRING);
        }}
        onPressOut={() => {
          if (reduceMotion) return;
          // eslint-disable-next-line react-hooks/immutability -- reanimated 共享值的就地修改是其既定用法
          scale.value = withSpring(1, PRESS_SPRING);
        }}
        style={{ gap: 6 }}
      >
        {cover ? (
          <Photo media={cover} preview ratio={1} />
        ) : (
          <TileCover size={size} icon={icon} stamp={stamp} />
        )}
        <View>
          <Text
            numberOfLines={1}
            style={{
              fontFamily: serif,
              fontWeight: "600",
              letterSpacing: 0.3,
              ...tileTitleFont(large),
            }}
          >
            {title}
          </Text>
          <Text numberOfLines={1} style={s.footnote}>
            {caption}
          </Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}
/**
 * 书架横条：年份与月册、专题与信收成一条横着翻的小封面，两组之间一道细线。
 * 首页一屏放下，书再多也只是往右翻，不再一段段往下排。条不跟着首屏拉高（flexGrow 0）。
 */
function ShelfStrip({ time, topics }: { time: ReactNode[]; topics: ReactNode[] }) {
  const { colors } = useTheme();
  const size = useTileSize();
  return (
    <ScrollView
      testID="shelf-strip"
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ marginHorizontal: -20, flexGrow: 0 }}
      contentContainerStyle={{
        paddingHorizontal: 20,
        // 纸面小签的投影往上也有一点，别让横向条切掉。
        paddingTop: 4,
        paddingBottom: 4,
        gap: 12,
        alignItems: "flex-start",
      }}
    >
      {time}
      {time.length > 0 && topics.length > 0 && (
        <View
          accessible={false}
          importantForAccessibility="no"
          style={{
            width: 1,
            height: Math.round(size * 0.6),
            marginTop: Math.round(size * 0.2),
            marginHorizontal: 2,
            backgroundColor: colors.line,
          }}
        />
      )}
      {topics}
    </ScrollView>
  );
}
/**
 * 「最近」翻页卡：整宽时光卡左右翻，按卡吸附，右侧露出下一张的一角提示还能翻；多于一张时下面一排圆点。
 * 卡高随首屏剩下的空间走（照片撑满卡顶），首页因此一屏放下、不用上下滑。只有一段时光时不翻页，
 * 整宽一张、与下面的书架左右对齐。那年今日排在最前，卡上带「N 年前的今天」。
 */
function RecentFlip({
  items,
  media,
  onOpen,
}: {
  items: HeroItem<Stored<LocalRecord>>[];
  media: Record<string, LocalMedia>;
  onOpen: (id: string) => void;
}) {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(0);
  // 卡宽 = 可用宽 − 两侧页边 40 − 16：加上 12 的卡距，下一张露出 24。右内边距 36 让最后一张也能对齐页边。
  const fullWidth = width - insets.left - insets.right - 40;
  const cardWidth = Math.max(200, fullWidth - 16);
  const interval = cardWidth + 12;
  const settle = (x: number) =>
    setIndex(
      Math.min(items.length - 1, Math.max(0, Math.round(x / interval))),
    );
  // 删掉几段后停在末尾之外的页码收回到最后一张。
  const current = Math.min(index, items.length - 1);
  const card = (item: HeroItem<Stored<LocalRecord>>, i: number, w?: number) => (
    <RecentCard
      key={item.record.id}
      item={item}
      cover={coverForRecords([item.record], media)}
      width={w}
      // 字是主角：有字的卡照片最多 16:10，卡再高多出来的地方给字。
      photoHeight={Math.round(((w ?? fullWidth) * 10) / 16)}
      index={i}
      testID={`recent-${item.record.id}`}
      onPress={() => onOpen(item.record.id)}
    />
  );
  if (items.length === 1) return card(items[0]!, 0);
  return (
    <View style={{ flex: 1, gap: 8 }}>
      {/* 横向条默认会在纵向撑满，卡片随之拉到条高：卡高就是首屏剩下的高度。 */}
      <ScrollView
        horizontal
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
          // 横向 ScrollView 会裁掉卡片的投影：底下留出位置，圆点就排在这段空白之后。
          paddingBottom: CARD_SHADOW_ROOM,
          gap: 12,
        }}
      >
        {items.map((item, i) => card(item, i, cardWidth))}
      </ScrollView>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{ flexDirection: "row", justifyContent: "center", gap: 6 }}
      >
        {items.map((item, i) => (
          <View
            key={item.record.id}
            style={{
              width: i === current ? 16 : 6,
              height: 6,
              borderRadius: 3,
              backgroundColor: i === current ? colors.accent : colors.line,
            }}
          />
        ))}
      </View>
    </View>
  );
}
/**
 * 卡里的衬线正文：占满卡里剩下的高度，按量到的高度排几行，不在半行处截断。
 * 字绝对定位、不参与撑高，容器只保底一行：卡高只由首屏剩下的空间决定。
 * 落款是内容（PRODUCT.md 原则 3）：放得下两行就把最后一行让给右下角的「—— 爸爸」；
 * 没落款时放得下三行才摆一枚装饰线。字少时空白留在正文与落款之间，像一页信。
 */
function SerifBody({ text, by }: { text: string; by?: string }) {
  const s = useStyles(),
    { large } = useTheme();
  const font = heroBodyFont(large);
  // 系统字号会把行高一起放大（useTextScale）。
  const line = font.lineHeight * useTextScale();
  const [room, setRoom] = useState(1);
  const footer = room >= (by ? 2 : 3);
  return (
    <View
      style={{ flex: 1, minHeight: line, overflow: "hidden" }}
      onLayout={(e) =>
        setRoom(Math.max(1, Math.floor(e.nativeEvent.layout.height / line)))
      }
    >
      {!!text && (
        <Text
          numberOfLines={footer ? room - 1 : room}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            fontFamily: serif,
            ...font,
            letterSpacing: 0.3,
          }}
        >
          {text}
        </Text>
      )}
      {footer && (
        <View style={{ position: "absolute", left: 0, right: 0, bottom: 0 }}>
          {by ? (
            <Text style={[s.muted, { textAlign: "right" }]}>{`—— ${by}`}</Text>
          ) : (
            <Ornament />
          )}
        </View>
      )}
    </View>
  );
}
/**
 * 卡上的正文：有图的卡总摆标题，标题是拿正文首行凑出来的，就不要再把同一句当正文重复一遍；
 * 无图的卡没起标题时不摆标题，正文从首行读起。
 */
function heroWords(record: Stored<LocalRecord>, cover: LocalMedia | undefined) {
  const titled = !!record.title.trim();
  const body = record.text.trim();
  return cover
    ? titled
      ? body
      : body.split("\n").slice(1).join(" ").trim()
    : titled
      ? body
      : body || recordTitle(record);
}
/**
 * 一张时光卡最矮多高才放得下它最少的内容：（照片 64、）「N 年前的今天」、日期、标题一行、正文一行，
 * 与 RecentCard 同一套内边距与行距。行高是实际排版用的（应用大字 × 系统字号），不写死像素。
 */
function heroCardMin(
  item: HeroItem<Stored<LocalRecord>>,
  cover: LocalMedia | undefined,
  lines: { footnote: number; heading: number; body: number },
) {
  const words = heroWords(item.record, cover);
  const eyebrow =
    item.yearsAgo !== undefined
      ? [Math.max(HERO_EYEBROW_ICON, lines.footnote)]
      : [];
  const stack = (heights: number[], gap: number) =>
    heights.reduce((a, b) => a + b, 0) + gap * (heights.length - 1);
  if (cover)
    return (
      HERO_PHOTO_MIN +
      HERO_TEXT_PAD * 2 +
      stack(
        [
          ...eyebrow,
          lines.footnote,
          lines.heading,
          ...(words ? [lines.body] : []),
        ],
        HERO_TEXT_GAP,
      )
    );
  return (
    HERO_PLAIN_PAD * 2 +
    stack(
      [
        ...eyebrow,
        lines.footnote,
        ...(item.record.title.trim() ? [lines.heading] : []),
        lines.body,
      ],
      HERO_PLAIN_GAP,
    )
  );
}
/**
 * 时光卡，与阅读页同一顺序。有图时照片在卡顶、最多 16:10（卡矮时先缩照片，不低于 64），
 * 下面日期、衬线标题、衬线正文：卡再高多出来的地方给字，不给照片（字是主角）；
 * 只有照片没有字时照片撑满。无图时纸面上日期、起了的标题、衬线正文。
 * 那年今日的卡在日期上面多一行「N 年前的今天」。不传 width 时撑满父容器。
 */
function RecentCard({
  item,
  cover,
  width,
  photoHeight,
  index,
  testID,
  onPress,
}: {
  item: HeroItem<Stored<LocalRecord>>;
  cover?: LocalMedia;
  width?: number;
  photoHeight: number;
  index: number;
  testID?: string;
  onPress: () => void;
}) {
  const s = useStyles(),
    { colors, liquid } = useTheme();
  const reduceMotion = useReducedMotion();
  const { record, yearsAgo } = item;
  const title = recordTitle(record);
  const titled = !!record.title.trim();
  const words = heroWords(record, cover);
  const anniversary = yearsAgo !== undefined;
  const eyebrow = anniversary && (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      <JournalIcon
        name="calendar"
        color={colors.accent}
        size={HERO_EYEBROW_ICON}
      />
      <Text style={[s.footnote, { color: colors.accent, fontWeight: "600" }]}>
        {yearsAgo} 年前的今天
      </Text>
    </View>
  );
  return (
    <Animated.View
      // 卡片在 iOS 是液态玻璃：淡入会让祖先透明度从 0 起步，系统就不画玻璃，字直接浮在底色上。
      entering={
        reduceMotion || liquid
          ? undefined
          : FadeInUp.delay(Math.min(index, 8) * 60).duration(320)
      }
      style={width ? { width } : { flex: 1 }}
    >
      {/* 按压透明度同理落在卡片里面。 */}
      <Card style={{ flex: 1, padding: 0, gap: 0 }}>
        <Pressable
          testID={testID}
          accessibilityRole="button"
          accessibilityLabel={`${anniversary ? `${yearsAgo} 年前的今天，` : ""}${title}，${dateLabel(record.date)}`}
          onPress={onPress}
          style={({ pressed }) => ({ flex: 1, opacity: pressed ? 0.7 : 1 })}
        >
          {cover ? (
            <>
              <View
                style={[
                  {
                    borderTopLeftRadius: 16,
                    borderTopRightRadius: 16,
                    overflow: "hidden",
                  },
                  words
                    ? {
                        height: photoHeight,
                        flexShrink: 1,
                        minHeight: HERO_PHOTO_MIN,
                      }
                    : { flex: 1 },
                ]}
              >
                <Photo media={cover} preview fill radius={0} />
              </View>
              <View
                style={{
                  flexGrow: words ? 1 : 0,
                  paddingHorizontal: 16,
                  paddingVertical: HERO_TEXT_PAD,
                  gap: HERO_TEXT_GAP,
                }}
              >
                {eyebrow}
                <Text style={s.footnote}>{dateLabel(record.date)}</Text>
                <Text numberOfLines={1} style={s.heading}>
                  {title}
                </Text>
                {!!words && <SerifBody text={words} by={record.by} />}
              </View>
            </>
          ) : (
            <View
              style={{ flex: 1, padding: HERO_PLAIN_PAD, gap: HERO_PLAIN_GAP }}
            >
              {eyebrow}
              <Text style={s.footnote}>{dateLabel(record.date)}</Text>
              {titled && (
                <Text numberOfLines={1} style={s.heading}>
                  {title}
                </Text>
              )}
              <SerifBody text={words} by={record.by} />
            </View>
          )}
        </Pressable>
      </Card>
    </Animated.View>
  );
}
/** 书架提醒卡：一行标题（可带印章与引导语）、一句说明、一个文字级动作，右上 ✕ 关掉。 */
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
    { colors, liquid } = useTheme();
  const reduceMotion = useReducedMotion();
  return (
    <Animated.View
      // 卡片在 iOS 是液态玻璃：淡入会让祖先透明度从 0 起步，系统就不画玻璃（见 RecentCard）。
      entering={reduceMotion || liquid ? undefined : FadeInUp.duration(320)}
      testID={testID}
    >
      {/* 文字级动作自带 44 的触控高，卡底内边距收到 4，字到卡边仍是 16。 */}
      <Card style={{ paddingBottom: 4 }}>
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
            {/* 提醒只是建议，动作用文字级、不摆胶囊；左移 8 让字与上面的正文对齐。 */}
            <View style={{ alignSelf: "flex-start", marginLeft: -8 }}>
              <Button
                title={action.label}
                kind="text"
                compact
                testID={action.testID}
                onPress={action.onPress}
              />
            </View>
          </View>
          <View style={{ marginTop: -8, marginRight: -8 }}>
            <IconButton label="关掉这条提醒" icon="close" onPress={onClose} />
          </View>
        </View>
      </Card>
    </Animated.View>
  );
}
/** 草稿合成一张紧凑纸卡：最新一份的标题一行 + 文字级「继续编辑」，多份可以展开。 */
function DraftCard({
  drafts,
  onResume,
}: {
  drafts: Stored<RecordDraft>[];
  onResume: (id: string) => void;
}) {
  const s = useStyles();
  const [open, setOpen] = useState(false);
  const latest = drafts[0]!;
  return (
    <Card compact>
      <View style={s.between}>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text style={s.muted}>
            {drafts.length > 1 ? `${drafts.length} 份草稿` : "上次没写完"}
          </Text>
          <Text numberOfLines={1}>{recordTitle(latest.content)}</Text>
        </View>
        <Button
          title="继续编辑"
          kind="text"
          compact
          testID={`resume-${latest.id}`}
          onPress={() => onResume(latest.id)}
        />
        {drafts.length > 1 && (
          <IconButton
            label={open ? "收起其他草稿" : "查看其他草稿"}
            icon={open ? "close" : "chevron-down"}
            selected={open}
            onPress={() => setOpen(!open)}
          />
        )}
      </View>
      {open &&
        drafts.slice(1).map((draft) => (
          <Pressable
            key={draft.id}
            testID={`resume-${draft.id}`}
            accessibilityRole="button"
            accessibilityLabel={`继续编辑：${recordTitle(draft.content)}`}
            onPress={() => onResume(draft.id)}
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
  /** 封面裁切比例，默认 4:3；年度册里的月册网格用 1。 */
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

/**
 * 书架即首页，而且首屏就是全部：页头、（提醒卡）、「最近」翻页卡、（草稿卡）、书架横条、底行。
 * 「最近」卡的高度吃掉剩下的空间，所以放得下时整页不能上下滑、不回弹；要看更多就左右翻。
 * 底行与悬浮钮同高，「新建相册」「写一封信」排在它左边，悬浮钮底下从不压着东西。
 * 只有真放不下（更大文字、小屏、提醒卡与草稿同时在）时才退回可以往下滑。
 */
/** 今天的本地日期：回到前台或过了午夜就换，「N 年前的今天」、信的状态与提醒才跟得上。 */
function useDayKey(): string {
  const [day, setDay] = useState(() => toDayKey(new Date()));
  useEffect(() => {
    const check = () => setDay(toDayKey(new Date()));
    const sub = AppState.addEventListener("change", (status) => {
      if (status === "active") check();
    });
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const timer = setTimeout(check, next.getTime() - now.getTime() + 1000);
    return () => {
      sub.remove();
      clearTimeout(timer);
    };
  }, [day]);
  return day;
}
export function Shelf() {
  const sync = useSyncStatus();
  const state = useLibrary(),
    store = useStore(),
    nav = useNav(),
    s = useStyles(),
    { colors, large } = useTheme();
  const textScale = useTextScale();
  const insets = useSafeAreaInsets();
  const [error, setError] = useState(""),
    [viewport, setViewport] = useState(0),
    [contentHeight, setContentHeight] = useState(0),
    [heroHeader, setHeroHeader] = useState(0);
  // store 只在某个集合真的动过时才换它的引用，所以按集合记忆：改一条草稿不会
  // 让一万条记录重新排序，主题、尺寸与本页 useState 引起的重渲染都命中缓存。
  const {
    records: recordMap,
    albums: albumMap,
    media: mediaMap,
    drafts: draftMap,
    letters: letterMap,
  } = state;
  const records = useMemo(
    () => sortedRecords({ records: recordMap }),
    [recordMap],
  );
  // 下面几项都是对已排序数组的一趟线性遍历，每次渲染重算。
  const months = [...new Set(records.map((r) => monthKey(r.date)))];
  const years = [...new Set(records.map((r) => yearKey(r.date)))];
  const firsts = records.filter((r) => r.first).length;
  const quotes = records.filter((r) => r.quote).length;
  // 换日时 day 变化触发重渲染，today 随之更新。
  const day = useDayKey();
  const today = new Date();
  const albums = useMemo(
    () =>
      Object.values(albumMap).sort(
        (a, b) =>
          b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id),
      ),
    [albumMap],
  );
  const drafts = useMemo(
    () =>
      Object.values(draftMap).sort((a, b) =>
        b.updatedAt.localeCompare(a.updatedAt),
      ),
    [draftMap],
  );
  const letters = useMemo(
    () => sortLetters(Object.values(letterMap), new Date(`${day}T00:00:00`)),
    [letterMap, day],
  );
  const hero = heroItems(records, today);
  const tiles = shelfTiles({
    months,
    years,
    firsts,
    quotes,
    albumIds: albums.map((a) => a.id),
    letterIds: letters.map((l) => l.id),
  });
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
  // records 按日期新到旧排，最后一段就是第一段时光：它满 7 天才提备份，刚开始记的头几天不打扰。
  const exportedDays = daysSinceExport(state),
    backupDue = backupDueOf(
      records[records.length - 1]?.date ?? null,
      exportedDays,
      today,
    );
  const age = ageLine(state.profile.birthday),
    milestone = milestoneOf(state.profile.birthday);
  const initial = sealInitial(state.profile.name);
  // 同屏只放一张提醒卡：合并冲突 > 落款 > 里程碑 > 装订 > 备份 > 节奏；关掉的写进库里，沉默期见 nudge.ts。
  const candidates: NudgeKind[] = [];
  // 落款卡：这台手机定了默认落款、库里还有没落款的记录时问一次；「都是」一次写上，关掉就永远不再问。
  const unsigned = useMemo(() => unsignedRecords({ records: recordMap }), [recordMap]);
  const defaultBy = state.settings.by;
  if (sync.conflicts > 0) candidates.push("conflict");
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
  const createAlbum = () => {
    void beginSelection(store)
      .then((sessionId) => nav.navigate("Picker", { sessionId }))
      .catch((e) => setError(messageOf(e)));
  };
  const createLetter = () => {
    void beginLetter(store)
      .then((id) => nav.navigate("LetterEditor", { id }))
      .catch((e) => setError(messageOf(e)));
  };
  const tileOf = (tile: ShelfTile, index: number) => {
    switch (tile.kind) {
      case "year":
        // 年度册打头，月册摆在它后面：不另占一行年份标题，也不和月册重复同一张封面照片。
        return (
          <ShelfTileView
            key={`year-${tile.year}`}
            index={index}
            title={`${tile.year} 年`}
            caption="年度册"
            stamp={tile.year}
            testID={`volume-year-${tile.year}`}
            onPress={() => nav.navigate("Year", { year: tile.year })}
          />
        );
      case "month": {
        const monthRecords = records.filter(
          (r) => monthKey(r.date) === tile.month,
        );
        return (
          <ShelfTileView
            key={tile.month}
            index={index}
            title={monthName(tile.month)}
            caption={`${monthRecords.length} 段时光`}
            cover={coverForRecords(monthRecords, mediaMap)}
            icon="calendar"
            testID={`volume-${tile.month}`}
            onPress={() => nav.navigate("Month", { month: tile.month })}
          />
        );
      }
      case "firsts":
        return (
          <ShelfTileView
            key="firsts"
            index={index}
            title="第一次合集"
            caption={`${firsts} 个第一次`}
            icon="star"
            testID="volume-firsts"
            onPress={() => nav.navigate("Firsts")}
          />
        );
      case "quotes":
        return (
          <ShelfTileView
            key="quotes"
            index={index}
            title="她说的话"
            caption={`${quotes} 句原话`}
            stamp="语"
            testID="volume-quotes"
            onPress={() => nav.navigate("Quotes")}
          />
        );
      case "album": {
        const album = albumMap[tile.id]!;
        return (
          <ShelfTileView
            key={album.id}
            index={index}
            title={album.name}
            caption={`${album.items.length} 段时光`}
            cover={coverForAlbum(album, state)}
            icon="book"
            testID={`album-${album.id}`}
            onPress={() => nav.navigate("Album", { id: album.id })}
          />
        );
      }
      case "letter": {
        const letter = letterMap[tile.id]!;
        return (
          <ShelfTileView
            key={letter.id}
            index={index}
            title={letter.title || "一封信"}
            caption={letterShortCaption(letter, today)}
            spokenCaption={letterCaption(letter, today)}
            stamp={letterSeal(letter.from)}
            testID={`letter-${letter.id}`}
            onPress={() =>
              nav.navigate(
                letterState(letter, today) === "draft"
                  ? "LetterEditor"
                  : "Letter",
                { id: letter.id },
              )
            }
          />
        );
      }
    }
  };
  const shelfCount = tiles.time.length + tiles.topics.length;
  const hasRecords = records.length > 0;
  // 「最近」区（区标题 + 8 + 卡 + 圆点）最矮多高；首屏剩下的比这还少才让整页可以往下滑。
  // 区标题按量到的高（系统字号放大时文字按钮会高过 44），没量到前带「随便翻翻」时是 44、不带 32；
  // 卡取 180 与每张卡最少内容的较大者（更大文字、系统字号放大时内容更高）；圆点那一截是投影留白 14 + 8 + 6。
  const shuffle = records.length >= 3;
  const lines = {
    footnote: s.footnote.lineHeight * textScale,
    heading: s.heading.lineHeight * textScale,
    body: heroBodyFont(large).lineHeight * textScale,
  };
  const cardMin = hero.reduce(
    (most, item) =>
      Math.max(
        most,
        heroCardMin(item, coverForRecords([item.record], mediaMap), lines),
      ),
    HERO_CARD_MIN,
  );
  const heroMin = Math.ceil(
    cardMin +
      (heroHeader || (shuffle ? 44 : 32)) +
      8 +
      (hero.length > 1 ? 28 : 0),
  );
  return (
    <Page scroll={false} top>
      <ScrollView
        onLayout={(e) => setViewport(e.nativeEvent.layout.height)}
        onContentSizeChange={(_, height) => setContentHeight(height)}
        // 首屏放得下就不能滑：不回弹、不露滚动条；真放不下（更大文字、小屏）才退回可以往下滑。
        scrollEnabled={contentHeight > viewport + 1}
        alwaysBounceVertical={false}
        overScrollMode="never"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          flexGrow: 1,
          paddingHorizontal: 20,
          paddingTop: 12,
          // 底行与悬浮钮同高：内容止于悬浮钮的下沿。
          paddingBottom: insets.bottom + FAB_INSET,
          gap: 16,
        }}
      >
        <View style={s.between}>
          <Pressable
            accessibilityRole="button"
            // 读屏要先听到名字与年龄，再知道点了是翻开扉页。
            accessibilityLabel={[
              state.profile.name
                ? `${state.profile.name}的成长记`
                : "成长中的每一天",
              age ||
                (records.length
                  ? `${records.length} 段时光`
                  : "从今天的一件小事开始"),
            ].join("，")}
            accessibilityHint="翻开扉页"
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
        {nudgeKind === "conflict" && (
          <NudgeCard
            titleTestID="conflict-nudge"
            title={`有 ${sync.conflicts} 段两台手机都改过`}
            body="时间新的一版已经留下，另一版收着，随时可以换回。"
            action={{
              label: "去看看",
              testID: "conflict-nudge-action",
              onPress: () => nav.navigate("Conflicts"),
            }}
            onClose={() => closeNudge("conflict")}
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
            body={backupNudgeBody(sync.joined, sync.lastSyncAt, today)}
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
        {hasRecords ? (
          // 「最近」区的高度只由首屏剩下的空间决定：里面的内容绝对定位、不参与撑高。否则有照片的卡
          // 按 16:10 算出的照片高度会反过来把整页撑高，书架与底行被挤出屏幕、整页又能滑了
          // （run 35868419219 的 iOS 首页就是这样）。左右出血 20，翻页条才能贴到屏幕边。
          <View style={{ flex: 1, minHeight: heroMin, marginHorizontal: -20 }}>
            <View
              style={[
                StyleSheet.absoluteFill,
                { paddingHorizontal: 20, gap: 8 },
              ]}
            >
              <View
                onLayout={(e) => setHeroHeader(e.nativeEvent.layout.height)}
              >
                <SectionHeader
                  title="最近"
                  action={
                    shuffle
                      ? {
                          label: "随便翻翻",
                          testID: "shuffle",
                          onPress: () => {
                            const id = pickAnother(records.map((r) => r.id));
                            if (id)
                              nav.navigate("Record", { id, shuffle: true });
                          },
                        }
                      : undefined
                  }
                />
              </View>
              <RecentFlip
                items={hero}
                media={mediaMap}
                onOpen={(id) => nav.navigate("Record", { id })}
              />
            </View>
          </View>
        ) : (
          // 空库只有这张欢迎卡，不挂「最近」的区标题。
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
        {latestDraft && (
          <DraftCard
            drafts={drafts}
            onResume={(draftId) => nav.navigate("Editor", { draftId })}
          />
        )}
        <ErrorText message={error} />
        {shelfCount > 0 && (
          <View style={{ gap: 8 }}>
            <SectionHeader title="书架" />
            <ShelfStrip
              time={tiles.time.map(tileOf)}
              topics={tiles.topics.map((tile, i) =>
                tileOf(tile, tiles.time.length + i),
              )}
            />
          </View>
        )}
        {shelfCount > 0 ? (
          <>
            {/* 空库时上面没有撑满的「最近」卡：垫一块弹性空白，底行照样落在悬浮钮那一行。 */}
            {!hasRecords && <View style={{ flex: 1 }} />}
            {/* 新建是工具，排在书架之后；与悬浮钮同高、靠左摆，右边让出悬浮钮的位置。左移 8 让字与页边对齐。 */}
            <View
              style={{
                flexDirection: "row",
                // 窄屏大字放不下两个动作时整个换到下一行，不把字一个个折开；右边照样让出悬浮钮。
                flexWrap: "wrap",
                alignItems: "center",
                alignContent: "center",
                minHeight: FAB_SIZE,
                marginLeft: -8,
                paddingRight: FAB_SIZE + 12,
              }}
            >
              {hasRecords && (
                <Button
                  title="新建相册"
                  kind="text"
                  compact
                  icon="plus"
                  testID="album-new"
                  onPress={createAlbum}
                />
              )}
              <Button
                title="写一封信"
                kind="text"
                compact
                icon="seal"
                testID="letter-new"
                onPress={createLetter}
              />
            </View>
          </>
        ) : (
          // 还没有任何记录与信：新建的引导行放一张卡（选材页是空的，先不给「新建相册」）。
          <BookRows>
            <GuideRow
              icon="seal"
              tone="indigo"
              title="写一封信"
              hint="给多年后的她写一封信，到日子再拆。"
              testID="letter-new"
              onPress={createLetter}
              last
            />
          </BookRows>
        )}
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
    .sort((a, b) => compareDates(a.date, b.date));
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
  const initial = sealInitial(state.profile.name);
  const name = state.profile.name || state.profile.fullName;
  const nameLine = state.profile.fullName
    ? fullNameLine(state.profile.fullName, state.profile.name)
    : "";
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
        {name ? (
          <Text style={[s.title, { textAlign: "center" }]}>
            {name}
          </Text>
        ) : (
          <Text
            style={[s.heading, { textAlign: "center", color: colors.muted }]}
          >
            还没填名字
          </Text>
        )}
        {!!nameLine && (
          <Text testID="title-full-name" style={[s.muted, { textAlign: "center" }]}>
            {nameLine}
          </Text>
        )}
        {!!state.profile.motto && (
          <Text
            testID="title-motto"
            style={{
              fontFamily: serif,
              fontSize: 16,
              lineHeight: 26,
              color: colors.muted,
              textAlign: "center",
              paddingHorizontal: 24,
            }}
          >
            {state.profile.motto}
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
