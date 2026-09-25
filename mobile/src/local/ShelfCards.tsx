import { useEffect, useState, type ReactNode } from "react";
import {
  AppState,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeInUp } from "react-native-reanimated";
import { useLibrary } from "./context";
import {
  recordTitle,
  type LocalMedia,
  type LocalRecord,
  type RecordDraft,
  type Stored,
} from "./model";
import { type HeroItem } from "./shelf-plan";
import { toDayKey } from "./dates";
import {
  Button,
  Card,
  IconButton,
  Ornament,
  SettingsRow,
  Stamp,
  Text,
  dateLabel,
  serif,
  useLargeLayout,
  usePressScale,
  useStyles,
  useTextScale,
  useTheme,
} from "./ui";
import { JournalIcon, type JournalIconName } from "../components/JournalIcon";
import { Photo } from "./Media";

/**
 * 书架上的零件：横条里的一本本书、「最近」翻页卡、提醒卡与草稿卡，以及封面怎么挑。
 * 页面本身在 Shelf.tsx，月册与年度册的版面在 Volume.tsx。
 */
/** 卡片投影（y5／半径 18）在横向条里要留的底部空间；再往下投影已淡到看不出裁切。 */
const CARD_SHADOW_ROOM = 14;
/**
 * 「最近」卡最矮多高：首屏剩下的地方比这还少（更大文字、小屏、提醒卡与草稿同时在），
 * 首页才退回可以往下滑——宁可滑一点，也不把照片压成一道缝。卡里最少的内容
 * （照片 + 日期 + 标题一行 + 正文一行）按实际行高比这还高时，以内容为准，见 heroCardMin。
 */
export const HERO_CARD_MIN = 180;
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
export const heroBodyFont = (large: boolean) =>
  large ? { fontSize: 19, lineHeight: 30 } : { fontSize: 17, lineHeight: 27 };
/** 书架一格的宽，也是方形小封面的边长；按大字排版（更大文字或系统字号 ≥ 1.3）时放大。 */
export const TILE = 76;
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
 * 新建的引导行：线性图标 + 一句说明，点按即新建——说明与下一步合一，不摆虚位册。
 * 调用方把几行成组放进一张 BookRows。
 */
export function GuideRow({
  icon,
  title,
  hint,
  testID,
  onPress,
  last = false,
}: {
  icon: JournalIconName;
  title: string;
  hint: string;
  testID?: string;
  onPress: () => void;
  last?: boolean;
}) {
  return (
    <SettingsRow
      icon={icon}
      label={title}
      subtitle={hint}
      onPress={onPress}
      testID={testID}
      last={last}
    />
  );
}
/** 书架上的月册名：年度册就摆在它前面，只留「9 月」。 */
export const monthName = (key: string) => `${Number(key.slice(5, 7))} 月`;
/** 几行成组的纸卡：行与行之间只有一条细线。 */
export function BookRows({ children }: { children: ReactNode }) {
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
export function ShelfTileView({
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
    { large, reduceMotion } = useTheme();
  const press = usePressScale();
  const size = useTileSize();
  return (
    <Animated.View
      entering={
        reduceMotion
          ? undefined
          : FadeInUp.delay(Math.min(index, 8) * 50).duration(300)
      }
      style={[{ width: size }, press.style]}
    >
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={`${title}，${spokenCaption ?? caption}`}
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
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
export function ShelfStrip({ time, topics }: { time: ReactNode[]; topics: ReactNode[] }) {
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
export function RecentFlip({
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
export function heroCardMin(
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
    { colors, liquid, reduceMotion } = useTheme();
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
export function NudgeCard({
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
    { colors, liquid, reduceMotion } = useTheme();
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
export function DraftCard({
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

/** 今天的本地日期：回到前台或过了午夜就换，「N 年前的今天」、信的状态与提醒才跟得上。 */
export function useDayKey(): string {
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
export function coverForRecords(
  monthRecords: readonly { mediaIds: readonly string[]; coverId: string | null }[],
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

export function coverForAlbum(
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

