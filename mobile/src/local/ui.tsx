import { BY_LIMIT, type LocalMedia } from "./model";
import {
  createContext,
  memo,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  AccessibilityInfo,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text as NativeText,
  TextInput,
  useWindowDimensions,
  View,
  useColorScheme,
  type StyleProp,
  type TextProps,
  type TextInputProps,
  type ViewStyle,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { NavigationContext } from "@react-navigation/native";
import Svg, { Defs, RadialGradient, Rect, Stop } from "react-native-svg";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import * as Haptics from "expo-haptics";
import { JournalIcon, type JournalIconName } from "../components/JournalIcon";
import { useLibrary } from "./context";
import { File } from "expo-file-system";
import { mediaDirectory, mediaUri } from "./files";

/** 主动作触感反馈；设备不支持或调用失败时静默略过。 */
export const hapticLight = () => {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
};
export const hapticSuccess = () => {
  void Haptics.notificationAsync(
    Haptics.NotificationFeedbackType.Success,
  ).catch(() => {});
};
const light = {
  paper: "#FAF5EC",
  card: "#FFFFFF",
  ink: "#3B3129",
  muted: "#7A6A58",
  line: "#EBDFCC",
  accent: "#B4553C",
  onAccent: "#FFFFFF",
  selected: "#F5E7D3",
  error: "#A03C36",
  glass: "#FFFFFF",
  glassLine: "#EBDFCC",
  accentGlass: "#B4553C",
  selectedGlass: "#F5E7D3",
  scrim: "rgba(59,49,41,0.32)",
  accentSoft: "rgba(180,85,60,0.28)",
  glow1: "#F3D9B8",
  glow2: "#EFC5B0",
  glow3: "#E8DCC4",
  // 功能入口的图标砖：彩色浅底圆角方块 + 实色图标，一个功能一个颜色锚点。
  // 前景色一律压到与砖底对比 ≥3:1；强调色不提亮——它在纸面上要保住 4.5:1 的文字对比。
  tiles: {
    accent: { bg: "rgba(180,85,60,0.12)", fg: "#B4553C" },
    apricot: { bg: "rgba(196,142,42,0.14)", fg: "#9C6E1E" },
    indigo: { bg: "rgba(80,104,140,0.12)", fg: "#50688C" },
    pine: { bg: "rgba(85,118,92,0.13)", fg: "#55765C" },
  },
};
const dark: typeof light = {
  paper: "#221C16",
  card: "#2C241C",
  ink: "#F2E9DC",
  muted: "#B8A88F",
  line: "#453A2E",
  accent: "#E09B76",
  onAccent: "#2A1A12",
  selected: "#3A2D20",
  error: "#F0A59D",
  glass: "#2E251D",
  glassLine: "#453A2E",
  accentGlass: "#E09B76",
  selectedGlass: "#3A2D20",
  scrim: "rgba(0,0,0,0.45)",
  accentSoft: "rgba(224,155,118,0.32)",
  glow1: "#3A2A1C",
  glow2: "#40241C",
  glow3: "#2E2A1E",
  tiles: {
    accent: { bg: "rgba(224,155,118,0.16)", fg: "#E09B76" },
    apricot: { bg: "rgba(217,169,92,0.16)", fg: "#D9A95C" },
    indigo: { bg: "rgba(163,184,217,0.16)", fg: "#A3B8D9" },
    pine: { bg: "rgba(159,190,165,0.16)", fg: "#9FBEA5" },
  },
};
// 全屏剧场（重放）固定为暖黑语义，不随浅色/深色切换；页面不得另写 hex。
// 剧场里的强调色固定取浅色色板的赤陶，避免同一剧场深浅色下两种主按钮色。
export const overlay = {
  bg: "#14100C",
  bgSoft: "rgba(20,16,12,0.95)",
  ink: "#F2E9DC",
  muted: "#B8A88F",
  line: "rgba(255,255,255,0.12)",
  card: "rgba(255,255,255,0.08)",
  textScrim: "rgba(20,16,12,0.72)",
  accent: light.accent,
  onAccent: light.onAccent,
};
// 导出图片（纪念卡/年册）固定纸面浅色，与浅色色板单源。
export const paperPalette = {
  ink: light.ink,
  muted: light.muted,
  accent: light.accent,
  line: light.line,
  paper: light.paper,
  emptyCell: "#F5EDE1",
};
export const serif = Platform.select({ ios: "Georgia", android: "serif" });
/** 书册与悬浮钮的统一按压弹簧。 */
export const PRESS_SPRING = { damping: 14, stiffness: 220 };
// 启动/错误页在 LocalTheme 之外渲染，只能按系统深浅色取色板。
export const paletteOf = (isDark: boolean) => (isDark ? dark : light);
const ThemeContext = createContext({
  colors: light,
  large: false,
  dark: false,
  liquid: false,
});
function useReduceTransparency() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    if (Platform.OS !== "ios") return;
    let alive = true;
    void AccessibilityInfo.isReduceTransparencyEnabled().then((v) => {
      if (alive) setReduce(v);
    });
    const sub = AccessibilityInfo.addEventListener(
      "reduceTransparencyChanged",
      (v: boolean) => setReduce(v),
    );
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return reduce;
}
export function LocalTheme({ children }: { children: ReactNode }) {
  const s = useLibrary(),
    system = useColorScheme();
  const isDark =
    s.settings.theme === "dark" ||
    (s.settings.theme === "auto" && system === "dark");
  const reduceTransparency = useReduceTransparency();
  const liquid =
    Platform.OS === "ios" && isLiquidGlassAvailable() && !reduceTransparency;
  const value = useMemo(
    () => ({
      colors: isDark ? dark : light,
      large: s.settings.largeText,
      dark: isDark,
      liquid,
    }),
    [isDark, s.settings.largeText, liquid],
  );
  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}
export const useTheme = () => useContext(ThemeContext);
export function Text({ style, ...props }: TextProps) {
  const { colors, large } = useTheme();
  return (
    <NativeText
      maxFontSizeMultiplier={1.6}
      {...props}
      style={[
        {
          color: colors.ink,
          fontSize: large ? 19 : 16,
          lineHeight: large ? 29 : 25,
        },
        style,
      ]}
    />
  );
}
export const GlassBackdrop = memo(function GlassBackdrop() {
  const { colors, dark } = useTheme();
  const { width, height } = useWindowDimensions();
  const glowOpacity = dark ? 0.5 : 0.55;
  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { backgroundColor: colors.paper }]}
    >
      <Svg width={width} height={height}>
        <Defs>
          <RadialGradient
            id="glow1"
            cx={width * 0.12}
            cy={height * 0.08}
            r={width * 0.95}
            gradientUnits="userSpaceOnUse"
          >
            <Stop
              offset="0"
              stopColor={colors.glow1}
              stopOpacity={glowOpacity}
            />
            <Stop offset="1" stopColor={colors.glow1} stopOpacity="0" />
          </RadialGradient>
          <RadialGradient
            id="glow2"
            cx={width * 0.95}
            cy={height * 0.3}
            r={width * 0.85}
            gradientUnits="userSpaceOnUse"
          >
            <Stop
              offset="0"
              stopColor={colors.glow2}
              stopOpacity={glowOpacity}
            />
            <Stop offset="1" stopColor={colors.glow2} stopOpacity="0" />
          </RadialGradient>
          <RadialGradient
            id="glow3"
            cx={width * 0.3}
            cy={height * 1.0}
            r={width * 1.05}
            gradientUnits="userSpaceOnUse"
          >
            <Stop
              offset="0"
              stopColor={colors.glow3}
              stopOpacity={glowOpacity}
            />
            <Stop offset="1" stopColor={colors.glow3} stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Rect width={width} height={height} fill="url(#glow1)" />
        <Rect width={width} height={height} fill="url(#glow2)" />
        <Rect width={width} height={height} fill="url(#glow3)" />
      </Svg>
    </View>
  );
});
/** 玻璃层级：Card 内部深度 +1，深度 ≥ 1 的 Glass 退回实色纸面，玻璃不套玻璃、卡不套卡。 */
export const GlassDepth = createContext(0);
export function Glass({
  children,
  style,
  radius = 16,
  tint,
  accessibilityViewIsModal,
  interactive = false,
  testID,
}: {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  radius?: number;
  tint?: string;
  accessibilityViewIsModal?: boolean;
  /** iOS 液态玻璃下启用系统按压微光反馈。 */
  interactive?: boolean;
  testID?: string;
}) {
  const { colors, dark, liquid } = useTheme();
  const depth = useContext(GlassDepth);
  if (depth > 0)
    return (
      <View
        accessibilityViewIsModal={accessibilityViewIsModal}
        testID={testID}
        style={[
          {
            borderRadius: radius,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: colors.glassLine,
            backgroundColor: tint ?? colors.paper,
          },
          style,
        ]}
      >
        {children}
      </View>
    );
  if (liquid) {
    const tintColor =
      tint === colors.accentGlass
        ? colors.accent
        : tint === colors.selectedGlass
          ? colors.accentSoft
          : undefined;
    return (
      <GlassView
        glassEffectStyle="regular"
        colorScheme={dark ? "dark" : "light"}
        tintColor={tintColor}
        isInteractive={interactive}
        accessibilityViewIsModal={accessibilityViewIsModal}
        testID={testID}
        style={[{ borderRadius: radius }, style]}
      >
        {children}
      </GlassView>
    );
  }
  return (
    <View
      accessibilityViewIsModal={accessibilityViewIsModal}
      testID={testID}
      style={[
        {
          borderRadius: radius,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: colors.glassLine,
          backgroundColor: tint ?? colors.glass,
          shadowColor: dark ? "#000000" : "#7A5C3E",
          shadowOffset: { width: 0, height: 5 },
          shadowOpacity: dark ? 0.35 : 0.09,
          shadowRadius: 18,
          elevation: 3,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}
/** 功能入口的图标砖：彩色浅底圆角方块承着实色图标，给每个功能一个颜色锚点。 */
export function IconTile({
  icon,
  tone = "accent",
  size = 36,
}: {
  icon: JournalIconName;
  tone?: keyof typeof light.tiles;
  size?: number;
}) {
  const { colors } = useTheme();
  const tile = colors.tiles[tone];
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.3),
        backgroundColor: tile.bg,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <JournalIcon name={icon} color={tile.fg} size={Math.round(size * 0.56)} />
    </View>
  );
}
/** 内容卡片：iOS 液态玻璃 / Android 与降级实色纸面，compact 为紧凑面板。 */
export function Card({
  children,
  compact = false,
  style,
  testID,
}: {
  children?: ReactNode;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const depth = useContext(GlassDepth);
  return (
    <Glass
      radius={compact ? 12 : 16}
      testID={testID}
      style={[
        compact
          ? { paddingHorizontal: 12, paddingVertical: 8, gap: 8 }
          : { padding: 16, gap: 12 },
        style,
      ]}
    >
      <GlassDepth.Provider value={depth + 1}>{children}</GlassDepth.Provider>
    </Glass>
  );
}
/** 区标题：无衬线辅助色小标题 + 右侧文字级动作（书架各区、设置分组）。 */
export function SectionHeader({
  title,
  action,
}: {
  title: string;
  action?: { label: string; onPress: () => void; testID?: string };
}) {
  const s = useStyles();
  return (
    <View style={[s.between, { minHeight: 32 }]}>
      <Text accessibilityRole="header" style={s.sectionTitle}>
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
  );
}
/** 设置分组：可选区标题 + 一张不留行间距的纸卡，里面放 SettingsRow。 */
export function SettingsGroup({
  title,
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  return (
    <View style={{ gap: 4 }}>
      {title !== undefined && <SectionHeader title={title} />}
      <Card style={{ gap: 0, paddingVertical: 4 }}>{children}</Card>
    </View>
  );
}
/**
 * 设置行：图标砖（或自定义前导）+ 标签 + 副题（读屏作为值朗读）+ 右箭头，放在 SettingsGroup 里成组。
 * 书架的书册行也用它：`leading` 换成小封面，`serifLabel` 让标签走衬线（书名）。
 */
export function SettingsRow({
  icon,
  tone = "accent",
  leading,
  serifLabel = false,
  label,
  subtitle,
  onPress,
  testID,
  last = false,
}: {
  icon?: JournalIconName;
  /** 图标砖的色调：一个功能一个颜色锚点。 */
  tone?: keyof typeof light.tiles;
  /** 代替图标的前导视图（书册行的小封面）。 */
  leading?: ReactNode;
  /** 标签走衬线：这一行是一本书。 */
  serifLabel?: boolean;
  label: string;
  subtitle?: string;
  onPress: () => void;
  testID?: string;
  last?: boolean;
}) {
  const { colors } = useTheme();
  const s = useStyles();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityValue={subtitle ? { text: subtitle } : undefined}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        minHeight: 56,
        paddingVertical: 8,
        borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth,
        borderBottomColor: colors.line,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      {leading ?? (icon && <IconTile icon={icon} tone={tone} />)}
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text
          numberOfLines={serifLabel ? 2 : undefined}
          style={
            serifLabel
              ? { fontFamily: serif, fontWeight: "600", letterSpacing: 0.3 }
              : undefined
          }
        >
          {label}
        </Text>
        {!!subtitle && (
          <Text numberOfLines={serifLabel ? 1 : undefined} style={s.muted}>
            {subtitle}
          </Text>
        )}
      </View>
      <JournalIcon name="chevron-right" color={colors.muted} size={18} />
    </Pressable>
  );
}
export function Ornament() {
  const { colors } = useTheme();
  return (
    <View
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no"
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        paddingVertical: 4,
      }}
    >
      <View
        style={{
          width: 28,
          height: StyleSheet.hairlineWidth,
          backgroundColor: colors.accent,
          opacity: 0.4,
        }}
      />
      <View
        style={{
          width: 5,
          height: 5,
          borderRadius: 2.5,
          backgroundColor: colors.accent,
          opacity: 0.55,
          transform: [{ rotate: "45deg" }],
        }}
      />
      <View
        style={{
          width: 28,
          height: StyleSheet.hairlineWidth,
          backgroundColor: colors.accent,
          opacity: 0.4,
        }}
      />
    </View>
  );
}
/** 日期行的强调色小竖条：阅读页日期与月册分区标题共用，内容由调用方给出。 */
export function DateStrip({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <View
        style={{
          width: 4,
          height: 16,
          borderRadius: 2,
          backgroundColor: colors.accent,
        }}
      />
      {children}
    </View>
  );
}
export function useStyles() {
  const { colors: c, dark, large } = useTheme();
  return useMemo(() => {
    const cardShadow: ViewStyle = {
      shadowColor: dark ? "#000000" : "#7A5C3E",
      shadowOffset: { width: 0, height: 5 },
      shadowOpacity: dark ? 0.35 : 0.09,
      shadowRadius: 18,
      elevation: 3,
    };
    return StyleSheet.create({
      page: { flex: 1, backgroundColor: c.paper },
      content: { padding: 20, gap: 20, paddingBottom: 32 },
      // 页内顶栏：返回钮 44 居中于 8 内边距，图标左沿恰与 20 的页边对齐。
      topBar: {
        minHeight: TOP_BAR_HEIGHT,
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 8,
        gap: 4,
      },
      topTitleBox: { flex: 1, paddingVertical: 8 },
      topTitleFlush: { paddingLeft: 12 },
      topTitle: {
        fontFamily: serif,
        fontSize: large ? 26 : 22,
        lineHeight: large ? 32 : 28,
        fontWeight: "600",
        letterSpacing: 0.3,
        color: c.ink,
      },
      topRight: { flexDirection: "row", alignItems: "center", gap: 4 },
      sectionTitle: {
        fontSize: 13,
        lineHeight: 20,
        fontWeight: "600",
        letterSpacing: 0.4,
        color: c.muted,
      },
      row: {
        flexDirection: "row",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 8,
      },
      between: {
        flexDirection: "row",
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
      },
      title: {
        fontSize: large ? 28 : 24,
        lineHeight: large ? 38 : 34,
        fontWeight: "600",
        fontFamily: serif,
        letterSpacing: 0.3,
        color: c.ink,
      },
      heading: {
        fontSize: large ? 21 : 18,
        lineHeight: large ? 31 : 27,
        fontWeight: "600",
        fontFamily: serif,
        letterSpacing: 0.3,
      },
      muted: {
        fontSize: large ? 15 : 13,
        lineHeight: large ? 24 : 21,
        color: c.muted,
      },
      /** 脚注：术语与格式说明只准出现在这一级。 */
      footnote: {
        fontSize: large ? 14 : 12,
        lineHeight: large ? 20 : 17,
        color: c.muted,
      },
      input: {
        backgroundColor: c.glass,
        color: c.ink,
        minHeight: 48,
        borderRadius: 12,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: c.glassLine,
        padding: 12,
        fontSize: 16,
      },
      section: {
        backgroundColor: c.glass,
        borderRadius: 16,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: c.glassLine,
        padding: 16,
        gap: 12,
        ...cardShadow,
      },
      line: {
        height: StyleSheet.hairlineWidth,
        backgroundColor: c.glassLine,
      },
      image: {
        width: "100%",
        aspectRatio: 4 / 3,
        borderRadius: 12,
        backgroundColor: c.selected,
      },
      empty: { paddingVertical: 32, gap: 12 },
      galleryRow: {
        flexDirection: "row",
        gap: 12,
        marginBottom: 16,
        alignItems: "flex-start",
      },
      galleryCaption: { gap: 2, paddingTop: 8, minHeight: 44 },
      galleryTitle: {
        fontSize: 14,
        lineHeight: 21,
        fontWeight: "600",
        fontFamily: serif,
      },
      recordRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        padding: 12,
        borderRadius: 16,
        backgroundColor: c.glass,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: c.glassLine,
        marginBottom: 12,
        ...cardShadow,
      },
      fabShadow: {
        shadowColor: dark ? "#000000" : "#7A5C3E",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.25,
        shadowRadius: 10,
        elevation: 4,
      },
      recordRowInner: {
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        padding: 12,
      },
      dateHeading: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingTop: 8,
        paddingBottom: 12,
        gap: 8,
      },
    });
  }, [c, dark, large]);
}
/** 书架与年度册的册宽：大字单列、页边 20、列间距 16，按安全区取可用宽。 */
export function useVolumeWidth() {
  const { large } = useTheme();
  const { width, fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const columns = large || fontScale >= 1.3 ? 1 : 2;
  return (
    (width - insets.left - insets.right - 40 - 16 * (columns - 1)) / columns
  );
}
/** 页内顶栏高度；键盘避让偏移 = 顶部安全区 + 这一行（原生页头下线后 useHeaderHeight 恒为 0）。 */
export const TOP_BAR_HEIGHT = 52;
export function useTopBarOffset() {
  const insets = useSafeAreaInsets();
  return insets.top + TOP_BAR_HEIGHT;
}
/**
 * 订阅导航栈的「能否返回」。不能只读一次 `canGoBack()`：返回途中页面会因其他状态
 * （如草稿清理）在栈弹出前重渲染而拿到 true，弹出完成后无人再触发渲染，箭头就残留。
 */
function useCanGoBack() {
  const navigation = useContext(NavigationContext);
  const [canGoBack, setCanGoBack] = useState(
    () => navigation?.canGoBack() ?? false,
  );
  useEffect(() => {
    if (!navigation) return;
    const update = () => setCanGoBack(navigation.canGoBack());
    update();
    return navigation.addListener("state", update);
  }, [navigation]);
  return canGoBack;
}

/**
 * 页面容器：安全区 + 氛围底 + 可选滚动。原生页头已下线，返回与标题由这里的顶栏绘制：
 * 表单与设置类页面传 `title`（标题在顶栏），内容类页面不传（顶栏只有返回，标题随内容）；
 * `back` 缺省时看导航栈能否返回，首页自然没有返回钮；弹层（Modal）请显式传 `back={false}`
 * 或用 `onBack` 关闭自己。顶栏在滚动区之外，`scroll={false}` 的页面同样可用。
 */
export function Page({
  children,
  scroll = true,
  top = true,
  title,
  back,
  onBack,
  right,
  testID,
}: {
  children: ReactNode;
  scroll?: boolean;
  top?: boolean;
  title?: string;
  back?: boolean;
  onBack?: () => void;
  right?: ReactNode;
  testID?: string;
}) {
  const s = useStyles();
  const navigation = useContext(NavigationContext);
  const canGoBack = useCanGoBack();
  const showBack = back ?? (onBack !== undefined || canGoBack);
  const hasBar = showBack || title !== undefined || right !== undefined;
  return (
    <SafeAreaView
      edges={top ? ["top", "left", "right"] : ["left", "right"]}
      style={s.page}
      testID={testID}
    >
      <GlassBackdrop />
      {hasBar && (
        <View style={s.topBar}>
          {showBack && (
            <IconButton
              label="返回"
              icon="arrow-left"
              testID="page-back"
              onPress={onBack ?? (() => navigation?.goBack())}
            />
          )}
          <View style={[s.topTitleBox, !showBack && s.topTitleFlush]}>
            {title !== undefined && (
              <Text accessibilityRole="header" style={s.topTitle}>
                {title}
              </Text>
            )}
          </View>
          {right !== undefined && <View style={s.topRight}>{right}</View>}
        </View>
      )}
      {scroll ? (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={s.content}
        >
          {children}
        </ScrollView>
      ) : (
        children
      )}
    </SafeAreaView>
  );
}
/**
 * 按钮四级：主（primary，实底，每页至多一个）／次（默认纸面胶囊）／文字（kind="text"，
 * 辅助动作：新建、更多、另存、停止）／危险文字（kind="text" + danger：删除、放弃、关闭）。
 * 开关类按钮传 selected，选中时前置勾；禁用态统一 40% 透明。
 */
export function Button({
  title,
  onPress,
  primary = false,
  kind = "pill",
  danger = false,
  disabled = false,
  icon,
  testID,
  selected,
  compact = false,
}: {
  title: string;
  onPress: () => void;
  primary?: boolean;
  kind?: "pill" | "text";
  danger?: boolean;
  disabled?: boolean;
  icon?: JournalIconName;
  testID?: string;
  selected?: boolean;
  compact?: boolean;
}) {
  const { colors: c } = useTheme();
  const color = primary ? c.onAccent : danger ? c.error : c.accent;
  const glyph = selected ? "check" : icon;
  const inner = (
    <>
      {glyph && <JournalIcon name={glyph} color={color} size={20} />}
      <Text
        style={{
          color,
          fontWeight: "600",
          flexShrink: 1,
          textAlign: "center",
          ...(compact ? { fontSize: 14, lineHeight: 21 } : {}),
        }}
      >
        {title}
      </Text>
    </>
  );
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{
        disabled,
        ...(selected === undefined ? {} : { selected }),
      }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={kind === "text" ? 6 : undefined}
      style={({ pressed }) => ({
        flexShrink: 1,
        opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
      })}
    >
      {kind === "text" ? (
        <View
          style={{
            minHeight: 44,
            paddingHorizontal: compact ? 8 : 12,
            paddingVertical: 6,
            flexDirection: "row",
            gap: 6,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {inner}
        </View>
      ) : (
        <Glass
          radius={14}
          tint={
            primary ? c.accentGlass : selected ? c.selectedGlass : undefined
          }
          style={{
            minHeight: compact ? 44 : 48,
            paddingHorizontal: compact ? 12 : 16,
            paddingVertical: compact ? 6 : 10,
            flexDirection: "row",
            gap: 8,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {inner}
        </Glass>
      )}
    </Pressable>
  );
}
/** 人物 chips：按名字 zh 排序统一在内部做；可选「全部」首 chip 表示未选任何人。 */
export function PersonChips({
  persons,
  selected,
  onToggle,
  allLabel,
  onAll,
  compact = false,
  chipTestID,
}: {
  persons: { id: string; name: string }[];
  selected: readonly string[];
  onToggle: (id: string) => void;
  /** 提供时先渲染「全部」chip，点击回调 onAll 清空选择。 */
  allLabel?: string;
  onAll?: () => void;
  compact?: boolean;
  chipTestID?: (id: string) => string;
}) {
  const s = useStyles();
  const sorted = [...persons].sort((a, b) =>
    a.name.localeCompare(b.name, "zh"),
  );
  return (
    <View style={s.row}>
      {allLabel && (
        <Button
          title={allLabel}
          compact={compact}
          selected={!selected.length}
          onPress={() => onAll?.()}
        />
      )}
      {sorted.map((p) => (
        <Button
          key={p.id}
          compact={compact}
          title={p.name}
          selected={selected.includes(p.id)}
          testID={chipTestID?.(p.id)}
          onPress={() => onToggle(p.id)}
        />
      ))}
    </View>
  );
}
/**
 * 落款行：一行辅助色文字「—— 爸爸」（没落款时「谁写的？」），点开在下面铺一排称呼 chips
 * （用过的在前、六个常用称呼兜底、末尾「其他…」可以自己写）。再点选中的那个就取消落款。
 */
export function SignatureButton({
  value,
  options,
  onChange,
  disabled = false,
  testID = "editor-by",
  initiallyOpen = false,
}: {
  value: string | undefined;
  options: readonly string[];
  onChange: (by: string | undefined) => void;
  disabled?: boolean;
  testID?: string;
  /** 「我的落款」页一进来就把 chips 铺开。 */
  initiallyOpen?: boolean;
}) {
  const s = useStyles();
  const { colors: c } = useTheme();
  const [open, setOpen] = useState(initiallyOpen);
  const [custom, setCustom] = useState<string | null>(null);
  const shown = [...new Set([...(value ? [value] : []), ...options])];
  const pick = (by: string | undefined) => {
    onChange(by);
    setCustom(null);
    setOpen(false);
  };
  return (
    <View style={{ gap: 8 }}>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={value ? `落款：${value}` : "谁写的？"}
        accessibilityState={{ disabled, expanded: open }}
        disabled={disabled}
        hitSlop={6}
        onPress={() => setOpen(!open)}
        style={({ pressed }) => ({
          alignSelf: "flex-end",
          minHeight: 44,
          justifyContent: "center",
          paddingHorizontal: 4,
          opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
        })}
      >
        <Text style={[s.muted, { color: value ? c.ink : c.muted }]}>
          {value ? `—— ${value}` : "谁写的？"}
        </Text>
      </Pressable>
      {open && (
        <View style={{ gap: 8 }}>
          <View style={s.row}>
            {shown.map((by) => (
              <Button
                key={by}
                compact
                title={by}
                selected={by === value}
                testID={`${testID}-${by}`}
                onPress={() => pick(by === value ? undefined : by)}
              />
            ))}
            <Button
              compact
              title="其他…"
              selected={custom !== null}
              testID={`${testID}-other`}
              onPress={() => setCustom(custom === null ? "" : null)}
            />
          </View>
          {custom !== null && (
            <View style={s.row}>
              <View style={{ flex: 1, minWidth: 160 }}>
                <Field
                  label="落款"
                  hideLabel
                  testID={`${testID}-custom`}
                  placeholder="例如：小姨、干妈"
                  value={custom}
                  maxLength={BY_LIMIT}
                  onChangeText={setCustom}
                  onSubmitEditing={() => custom.trim() && pick(custom.trim())}
                />
              </View>
              <Button
                compact
                title="好"
                testID={`${testID}-custom-ok`}
                disabled={!custom.trim()}
                onPress={() => pick(custom.trim())}
              />
            </View>
          )}
        </View>
      )}
    </View>
  );
}
export function BottomBar({
  children,
  gap = 8,
}: {
  children: ReactNode;
  gap?: number;
}) {
  const { colors, dark, liquid } = useTheme();
  const insets = useSafeAreaInsets();
  const depth = useContext(GlassDepth);
  // 底栏里的按钮走纸面平胶囊，不在玻璃上再叠玻璃。
  const inner = (
    <GlassDepth.Provider value={depth + 1}>{children}</GlassDepth.Provider>
  );
  if (liquid)
    return (
      <GlassView
        glassEffectStyle="regular"
        colorScheme={dark ? "dark" : "light"}
        style={{
          padding: 16,
          paddingBottom: 16 + insets.bottom,
          gap,
        }}
      >
        {inner}
      </GlassView>
    );
  return (
    <View
      style={{
        padding: 16,
        paddingBottom: 16 + insets.bottom,
        gap,
        backgroundColor: colors.glass,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: colors.glassLine,
      }}
    >
      {inner}
    </View>
  );
}
export function IconButton({
  label,
  icon,
  onPress,
  selected = false,
  testID,
}: {
  label: string;
  icon: JournalIconName;
  onPress: () => void;
  selected?: boolean;
  testID?: string;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 22,
        backgroundColor: selected ? colors.selectedGlass : "transparent",
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <JournalIcon name={icon} color={colors.accent} size={22} />
    </Pressable>
  );
}
/**
 * 工具栏按钮：图标 + 11 号小标签，透明无框，最低 44 触控。
 * 编辑页的媒体/AI 工具用它排成一行，贴在底栏上方——不跟胶囊按钮抢层级。
 */
export function ToolButton({
  icon,
  label,
  onPress,
  disabled = false,
  testID,
}: {
  icon: JournalIconName;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        minHeight: 52,
        alignItems: "center",
        justifyContent: "center",
        gap: 2,
        opacity: disabled ? 0.4 : pressed ? 0.6 : 1,
      })}
    >
      <JournalIcon name={icon} color={colors.accent} size={22} />
      <NativeText
        maxFontSizeMultiplier={1.4}
        style={{ fontSize: 11, lineHeight: 15, color: colors.muted }}
      >
        {label}
      </NativeText>
    </Pressable>
  );
}
export function Field({
  label,
  hideLabel = false,
  ...props
}: TextInputProps & { label: string; hideLabel?: boolean }) {
  const s = useStyles();
  const { colors, large } = useTheme();
  return (
    <View style={{ gap: 8 }}>
      {!hideLabel && <Text style={s.muted}>{label}</Text>}
      <TextInput
        {...props}
        accessibilityLabel={label}
        placeholderTextColor={colors.muted}
        style={[s.input, large && { fontSize: 19 }, props.style]}
      />
    </View>
  );
}
export function ErrorText({ message }: { message: string }) {
  const { colors } = useTheme();
  return message ? (
    <Text accessibilityRole="alert" style={{ color: colors.error }}>
      {message}
    </Text>
  ) : null;
}
export { messageOf } from "./errors";
export { dateLabel } from "./dates";
export function monthLabel(key: string) {
  const [y, m] = key.split("-");
  return `${y}年${Number(m)}月`;
}

export function Photo({
  media,
  contain = false,
  size,
  ratio,
  preview = false,
  label,
  radius = 12,
}: {
  media: LocalMedia | undefined;
  contain?: boolean;
  size?: number;
  /** 固定裁切比例（书架封面 4:3）；缺省按素材真实宽高比。 */
  ratio?: number;
  /** 列表/封面等小图场景：优先渲染持久缩略图。 */
  preview?: boolean;
  /** 读屏标签；缺省读作「照片」，不读原始文件名。 */
  label?: string;
  /** 圆角；书册行里 60 宽的小封面用 8。 */
  radius?: number;
}) {
  const s = useStyles();
  const [error, setError] = useState(false);
  const [thumbFailed, setThumbFailed] = useState(false);
  if (!media || error)
    return (
      <View style={[s.section, { minHeight: size ?? 120, width: size }]}>
        <Text>照片暂时无法读取</Text>
        <Text style={s.muted}>这段时光还在，缺的照片可以从备份恢复。</Text>
      </View>
    );
  // 不在渲染期同步查盘：先乐观渲染，加载失败再逐级回退（缩略图→原图→占位）。
  const thumb =
    !contain && (preview || size !== undefined) && media.thumb && !thumbFailed
      ? new File(mediaDirectory, media.thumb)
      : null;
  return (
    <Image
      accessibilityLabel={label ?? "照片"}
      source={{ uri: thumb ? thumb.uri : mediaUri(media) }}
      resizeMode={contain ? "contain" : "cover"}
      onError={() => {
        if (thumb) setThumbFailed(true);
        else setError(true);
      }}
      style={[
        {
          width: "100%",
          borderRadius: radius,
          aspectRatio: size
            ? 1
            : (ratio ??
              (media.width && media.height
                ? media.width / media.height
                : 4 / 3)),
        },
        size ? { width: size, height: size } : undefined,
      ]}
    />
  );
}
