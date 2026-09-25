import { BY_LIMIT, type LocalMedia } from "./model";
import {
  createContext,
  memo,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Ref,
  type RefObject,
} from "react";
import {
  AccessibilityInfo,
  Image,
  Keyboard,
  Modal,
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
import {
  GlassView,
  isGlassEffectAPIAvailable,
  isLiquidGlassAvailable,
} from "expo-glass-effect";
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from "react-native-gesture-handler";
import Animated, {
  Easing,
  cancelAnimation,
  ReduceMotion,
  ReducedMotionConfig,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import * as Haptics from "expo-haptics";
import { JournalIcon, type JournalIconName } from "../components/JournalIcon";
import { useLibrary } from "./context";
import { File } from "expo-file-system";
import { mediaDirectory, mediaUri } from "./files";
import { useCovered, useLocked } from "./lock";

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
  accent: "#B2543B",
  onAccent: "#FFFFFF",
  selected: "#F5E7D3",
  error: "#A03C36",
  glass: "#FFFFFF",
  glassLine: "#EBDFCC",
  accentGlass: "#B2543B",
  selectedGlass: "#F5E7D3",
  scrim: "rgba(59,49,41,0.32)",
  accentSoft: "rgba(178,84,59,0.28)",
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
};
// 导出纸面（纪念卡/纸书）固定纸面浅色，与浅色色板单源。
export const paperPalette = {
  ink: light.ink,
  muted: light.muted,
  accent: light.accent,
  line: light.line,
  paper: light.paper,
  emptyCell: "#F5EDE1",
};
export const serif = Platform.select({ ios: "Georgia", android: "serif" });
/**
 * 动效起点（项目自定，不是 Apple 规格；见 docs/history/plans/PLAN-IOS-MOTION.md）。
 * 页面转场用平台默认，时长不可配也不在这里配；减少动态时这里的动画全部不播。
 */
export const MOTION = {
  /** 纸面卡片（书册封面、纸面记一刻）按下缩到多少。 */
  pressScale: 0.95,
  /** 玻璃圆钮（记一刻）按下缩到多少，叠在系统 isInteractive 的微光上：只靠微光太不明显（主人 1.1.3 真机）。 */
  glassPressScale: 0.93,
  /** 面板下拉超过自身高度的这一比例、或松手时向下速度超过 dragVelocity（点／秒）就收起，否则弹回。 */
  dragClose: 0.25,
  dragVelocity: 800,
  /** 按压回位的轻弹簧，阻尼比约 0.6：几乎不过冲。 */
  pressSpring: { damping: 22, stiffness: 320 },
  /** 自绘底部面板打开、收起（毫秒）；收放可被反向打断。 */
  panelIn: 240,
  panelOut: 200,
  /** 封信后印章落定，单次。 */
  seal: 440,
};
// 启动/错误页在 LocalTheme 之外渲染，只能按系统深浅色取色板。
export const paletteOf = (isDark: boolean) => (isDark ? dark : light);
const ThemeContext = createContext({
  colors: light,
  large: false,
  dark: false,
  liquid: false,
  reduceMotion: false,
});
/** 订阅一项系统辅助设置：先读一次，之后随系统事件更新，切到设置里改完回来即生效。 */
function useAccessibilitySetting(
  read: () => Promise<boolean>,
  event: "reduceTransparencyChanged" | "reduceMotionChanged",
  platforms: readonly string[],
  initial = false,
) {
  const [on, setOn] = useState(initial);
  const enabled = platforms.includes(Platform.OS);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void read()
      .then((v) => {
        if (alive) setOn(v);
      })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener(event, (v: boolean) =>
      setOn(v),
    );
    return () => {
      alive = false;
      sub.remove();
    };
  }, [read, event, enabled]);
  return on;
}
const readReduceTransparency = () =>
  AccessibilityInfo.isReduceTransparencyEnabled();
const readReduceMotion = () => AccessibilityInfo.isReduceMotionEnabled();
const IOS = ["ios"] as const,
  MOBILE = ["ios", "android"] as const;
export function LocalTheme({ children }: { children: ReactNode }) {
  const s = useLibrary(),
    system = useColorScheme();
  const isDark =
    s.settings.theme === "dark" ||
    (s.settings.theme === "auto" && system === "dark");
  const reduceTransparency = useAccessibilitySetting(
    readReduceTransparency,
    "reduceTransparencyChanged",
    IOS,
  );
  // Reanimated 的 useReducedMotion 只是启动那一刻的值：拿它当首帧，之后跟着系统事件走。
  const reduceMotion = useAccessibilitySetting(
    readReduceMotion,
    "reduceMotionChanged",
    MOBILE,
    useReducedMotion(),
  );
  // 编译期可用之外还要运行时真有这套 API：部分 iOS 26 beta 缺它，一画玻璃就崩。
  const liquid =
    Platform.OS === "ios" &&
    isLiquidGlassAvailable() &&
    isGlassEffectAPIAvailable() &&
    !reduceTransparency;
  const value = useMemo(
    () => ({
      colors: isDark ? dark : light,
      large: s.settings.largeText,
      dark: isDark,
      liquid,
      reduceMotion,
    }),
    [isDark, s.settings.largeText, liquid, reduceMotion],
  );
  return (
    <ThemeContext.Provider value={value}>
      {/* Reanimated 自己的全局开关也只认启动时的设置：同步成实时值，进场、弹簧、缩放复位一起跟着改。 */}
      <ReducedMotionConfig
        mode={reduceMotion ? ReduceMotion.Always : ReduceMotion.Never}
      />
      {children}
    </ThemeContext.Provider>
  );
}
export const useTheme = () => useContext(ThemeContext);
/**
 * 按压：按下缩到 `pressed`（默认纸面的 MOTION.pressScale）、松手弹回，点击本身不等回弹。减少动态时不缩。
 * `style` 放在 Animated.View 上（缩放不是透明度，玻璃祖先可以用）。
 */
export function usePressScale(pressed: number = MOTION.pressScale) {
  const { reduceMotion } = useTheme();
  const scale = useSharedValue(1);
  const style = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));
  const to = (value: number) => {
    // 减少动态中途打开时，也要把缩了一半的卡片放回原位。
    // eslint-disable-next-line react-hooks/immutability -- reanimated 共享值的就地修改是其既定用法
    scale.value = reduceMotion ? 1 : withSpring(value, MOTION.pressSpring);
  };
  return {
    style,
    onPressIn: () => to(pressed),
    onPressOut: () => to(1),
  };
}
/** 印章里的字：圆环不跟系统字号变大，字也不跟——Text 在印章里取 1 倍，免得撑出圆环。 */
const InStamp = createContext(false);
/** 双线印章圆环：扉页名字首字与年度册封面共用。里面的字是装饰，不跟系统字号放大。 */
export function Stamp({
  size,
  inset = 5,
  children,
}: {
  size: number;
  /** 内圈细线与外缘的留白；里程碑小印 44 用 3。 */
  inset?: number;
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
          top: inset,
          left: inset,
          right: inset,
          bottom: inset,
          borderRadius: size / 2 - inset,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: colors.accent,
          opacity: 0.5,
        }}
      />
      <InStamp.Provider value={true}>{children}</InStamp.Provider>
    </View>
  );
}

/** 系统字号最多把字放大到几倍（Text 的 maxFontSizeMultiplier）。 */
export const TEXT_MAX_SCALE = 1.6;
/**
 * 系统字号实际把 Text 的字号与行高放大几倍：封顶 TEXT_MAX_SCALE；小于 1 按 1 算，
 * 按它排版宁可多留一点地方。
 */
export function useTextScale() {
  const { fontScale } = useWindowDimensions();
  return Math.min(Math.max(fontScale, 1), TEXT_MAX_SCALE);
}
/** 按大字排版：应用的「更大文字」，或系统字号放大到 1.3 倍以上。 */
export function useLargeLayout() {
  const { large } = useTheme();
  const { fontScale } = useWindowDimensions();
  return large || fontScale >= 1.3;
}

export function Text({ style, ...props }: TextProps) {
  const { colors, large } = useTheme();
  const inStamp = useContext(InStamp);
  return (
    <NativeText
      maxFontSizeMultiplier={inStamp ? 1 : TEXT_MAX_SCALE}
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
/** 页底：纯暖米纸色，不加光斑。卡片与玻璃控件都画在它上面。 */
export const GlassBackdrop = memo(function GlassBackdrop() {
  const { colors } = useTheme();
  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { backgroundColor: colors.paper }]}
    />
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
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}
/**
 * 内容卡片：所有平台都是实色纸卡——内容色底、暖色细描边，没有投影、没有玻璃高光。
 * 读的地方都是纸；液态玻璃只留给卡外的操作控件。卡里深度 +1，按钮退回实色。compact 为紧凑面板。
 */
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
  const { colors } = useTheme();
  return (
    <View
      testID={testID}
      style={[
        {
          borderRadius: compact ? 12 : 16,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: colors.line,
          backgroundColor: colors.card,
        },
        compact
          ? { paddingHorizontal: 12, paddingVertical: 8, gap: 8 }
          : { padding: 16, gap: 12 },
        style,
      ]}
    >
      <GlassDepth.Provider value={depth + 1}>{children}</GlassDepth.Provider>
    </View>
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
 * 设置行：线性图标（或自定义前导）+ 标签 + 副题（读屏作为值朗读）+ 右箭头，放在 SettingsGroup 里成组。
 * 书架的书册行也用它：`leading` 换成小封面，`serifLabel` 让标签走衬线（书名）。
 * 不给 onPress 就是只读行：不能按、没有右箭头（家人看家人名单）。
 */
export function SettingsRow({
  icon,
  leading,
  serifLabel = false,
  label,
  subtitle,
  onPress,
  testID,
  last = false,
}: {
  /** 行首线性图标：统一辅助色，不按功能分色、不垫色块。 */
  icon?: JournalIconName;
  /** 代替图标的前导视图（书册行的小封面）。 */
  leading?: ReactNode;
  /** 标签走衬线：这一行是一本书。 */
  serifLabel?: boolean;
  label: string;
  subtitle?: string;
  onPress?: () => void;
  testID?: string;
  last?: boolean;
}) {
  const { colors } = useTheme();
  const s = useStyles();
  return (
    <Pressable
      testID={testID}
      disabled={!onPress}
      accessibilityRole={onPress ? "button" : "text"}
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
      {leading ??
        (icon && (
          <View style={{ width: 28, alignItems: "center" }}>
            <JournalIcon name={icon} color={colors.muted} size={22} />
          </View>
        ))}
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
      {onPress && <JournalIcon name="chevron-right" color={colors.muted} size={18} />}
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
      },
      fabShadow: {
        shadowColor: dark ? "#000000" : "#7A5C3E",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.25,
        shadowRadius: 10,
        elevation: 4,
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
  const largeLayout = useLargeLayout();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const columns = largeLayout ? 1 : 2;
  return (
    (width - insets.left - insets.right - 40 - 16 * (columns - 1)) / columns
  );
}
/** 页内顶栏高度。键盘避让不用再加它：KeyboardAvoidingView 的布局帧相对整屏 SafeAreaView，已含顶栏。 */
export const TOP_BAR_HEIGHT = 52;
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
              // 顶栏一行 52：标题跟系统字号最多放大 1.3 倍，不然窄屏上五个字就折成两行。
              <Text
                accessibilityRole="header"
                maxFontSizeMultiplier={1.3}
                style={s.topTitle}
              >
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
          // iOS 纵向滚动区默认内容再短也回弹：放得下就不动，真长才滑。所有纵向列表同理。
          alwaysBounceVertical={false}
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
 * iOS 液态玻璃胶囊的按压与禁用透明度落在玻璃里面的内容上：玻璃或它的祖先一旦不透明度小于 1，
 * 系统就不画玻璃，恢复到 1 也不一定画回来。
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
  const { colors: c, liquid } = useTheme();
  const depth = useContext(GlassDepth);
  // 只有页面上直接摆的胶囊是系统玻璃；卡片与底栏里的已退回实色纸面，透明度照旧。
  const glassPill = liquid && depth === 0 && kind === "pill";
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
        opacity: glassPill ? 1 : disabled ? 0.4 : pressed ? 0.7 : 1,
      })}
    >
      {({ pressed }) =>
        kind === "text" ? (
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
            {glassPill ? (
              <View
                style={{
                  flexShrink: 1,
                  flexDirection: "row",
                  gap: 8,
                  alignItems: "center",
                  justifyContent: "center",
                  opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
                }}
              >
                {inner}
              </View>
            ) : (
              inner
            )}
          </Glass>
        )
      }
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
  leading,
}: {
  value: string | undefined;
  options: readonly string[];
  onChange: (by: string | undefined) => void;
  disabled?: boolean;
  testID?: string;
  /** 给了就与落款排成一行、落款靠右：编辑页纸上页脚左边的「草稿会自动保留」（null 只占位）；chips 照样铺满整行。 */
  leading?: ReactNode;
}) {
  const s = useStyles();
  const { colors: c } = useTheme();
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState<string | null>(null);
  const shown = [...new Set([...(value ? [value] : []), ...options])];
  const pick = (by: string | undefined) => {
    onChange(by);
    setCustom(null);
    setOpen(false);
  };
  const trigger = (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={value ? `落款：${value}` : "谁写的？"}
      accessibilityState={{ disabled, expanded: open }}
      disabled={disabled}
      hitSlop={6}
      onPress={() => setOpen(!open)}
      style={({ pressed }) => ({
        alignSelf: leading === undefined ? "flex-end" : "center",
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
  );
  return (
    <View style={{ gap: 8 }}>
      {leading === undefined ? (
        trigger
      ) : (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View style={{ flex: 1, minWidth: 0 }}>{leading}</View>
          {trigger}
        </View>
      )}
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
/**
 * 编辑页（记一刻、写信）的 KeyboardAvoidingView 拿它当 keyboardVerticalOffset：键盘弹起时 Home 指示条
 * 已被盖住，底栏的底部安全区留白就藏到键盘后面，保存按钮离键盘上沿 16，而不是再多出一条约 34 的空纸。
 * 布局帧相对整屏 SafeAreaView、已含页内顶栏，除此之外不要再加偏移。
 */
export function useKeyboardBarOffset() {
  return -useSafeAreaInsets().bottom;
}
/**
 * 一屏一张纸的页面（编辑、写信）：纸的高度跟着「键盘收着时」滚动区最新量到的高度走；键盘弹起期间只记当前高度，纸不缩。
 * 用法：滚动区 onLayout 调 measure，纸 minHeight = viewport − 上下内边距，内容高过 height 才 scrollEnabled。
 * 不能取历来最高：安卓的底部安全区晚一拍才到，首帧量到的高了 24，纸就永远多出一截、整页能滑（1.0.5 出包截图）。
 * 安卓的 keyboardDidShow 可能晚于滚动区变矮的那次布局：弹起前 500ms 内矮了一大截的那次「收着」高度不算数，退回它之前那个。
 */
export function useSheetViewport() {
  const [viewport, setViewport] = useState(0);
  const [height, setHeight] = useState(0);
  const open = useRef(false);
  const current = useRef(0);
  const closed = useRef({ height: 0, before: 0, at: 0 });
  useEffect(() => {
    const ios = Platform.OS === "ios";
    const show = Keyboard.addListener(
      ios ? "keyboardWillShow" : "keyboardDidShow",
      () => {
        open.current = true;
        const c = closed.current;
        // 只认键盘那么大的一跳（>100）：安全区晚到只差几十，不能被当成键盘退回去。
        if (!ios && c.before - c.height > 100 && Date.now() - c.at < 500) {
          c.height = c.before;
          setViewport(c.before);
        }
      },
    );
    const hide = Keyboard.addListener(
      ios ? "keyboardWillHide" : "keyboardDidHide",
      () => {
        open.current = false;
        // 滚动区已经长回来（安卓先布局后发事件）就用它；还没长回来，下一次布局会接上。
        setViewport((v) => Math.max(v, current.current));
      },
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  const measure = (h: number) => {
    current.current = h;
    setHeight(h);
    if (open.current) return;
    const c = closed.current;
    closed.current = { height: h, before: c.height, at: Date.now() };
    setViewport(h);
  };
  return { viewport, height, measure };
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
/**
 * Modal 里的纸面遮罩：iOS 开着应用锁、应用在多任务界面或后台时盖住面板内容。
 * 主窗口那层遮罩盖不到 Modal 自己的窗口，所以每个 Modal 的最后一个子元素放一个它。
 */
export function PrivacyCover() {
  const covered = useCovered();
  const { colors } = useTheme();
  return covered ? (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[StyleSheet.absoluteFill, { backgroundColor: colors.paper }]}
    />
  ) : null;
}
/**
 * 底部面板（AI）：受控的 RN Modal。蒙层淡入、面板从下沿推上来，两者跟着同一个进度走；
 * 收起途中再打开就从当前位置折回，收完才卸下 Modal。锁上时立即收起（Modal 画在锁之上），
 * 减少动态时直接出现、直接消失。关掉之后读屏焦点回到打开它的按钮。
 * 顶上的小横条和 `header` 一起是拖拽区：往下拉，面板和蒙层跟着手走，拉够了或甩下去就收起，
 * 不够就弹回。下面的 `children` 自己滚动，不接这个手势，免得和滚动抢。
 * 只管呈现：开没开由调用方决定，收起面板（点蒙层、按钮、下拉、读屏擦除手势）不取消面板里的任务。
 */
export function SheetModal({
  visible,
  onClose,
  closeLabel,
  closeTestID,
  returnFocus,
  header,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  /** 点蒙层收起的读屏标签。 */
  closeLabel: string;
  closeTestID?: string;
  /** 打开面板的那个按钮：面板收完，读屏焦点回到它。 */
  returnFocus?: RefObject<View | null>;
  /** 面板标题行：和小横条一起可以按住往下拉。 */
  header?: ReactNode;
  children: ReactNode;
}) {
  const { colors, reduceMotion } = useTheme();
  const locked = useLocked();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const show = visible && !locked;
  const instant = reduceMotion || locked;
  const [mounted, setMounted] = useState(show);
  // 打开当场挂上 Modal；收起要等动画走完，不播动画的收起当场卸下。
  if (show && !mounted) setMounted(true);
  if (!show && mounted && instant) setMounted(false);
  const showing = useRef(show);
  const progress = useSharedValue(show ? 1 : 0);
  const panelHeight = useSharedValue(windowHeight);
  useEffect(() => {
    showing.current = show;
    // 收完这一刻又被要求打开（进度折回时回调带 finished=false，不会走到这里）也不卸。
    const unmount = () => {
      if (!showing.current) setMounted(false);
    };
    if (show)
      progress.value = instant
        ? 1
        : withTiming(1, {
            duration: MOTION.panelIn,
            easing: Easing.out(Easing.cubic),
          });
    else if (instant) progress.value = 0;
    else
      progress.value = withTiming(
        0,
        { duration: MOTION.panelOut, easing: Easing.in(Easing.cubic) },
        (finished) => {
          "worklet";
          if (finished) scheduleOnRN(unmount);
        },
      );
  }, [show, instant, progress]);
  const focusBack = () => {
    const target = returnFocus?.current;
    // 因为上锁才收起的不还：按钮在锁下面，读屏够不着。
    if (target && !showing.current && !locked)
      AccessibilityInfo.sendAccessibilityEvent(target, "focus");
  };
  // iOS 等 Modal 真正退场（onDismiss）再还焦点；安卓没有 onDismiss，卸下后还。
  const wasMounted = useRef(mounted);
  useEffect(() => {
    if (Platform.OS !== "ios" && wasMounted.current && !mounted) focusBack();
    wasMounted.current = mounted;
  });
  // 下拉：进度跟着手指走（蒙层也随之变淡），松手按距离或速度决定收起还是弹回。
  // 手势真正认定是拖拽（纵向移动 8 以上）才接管进度：只是点一下「收起」不会把正在打开的面板停在半路。
  const dragFrom = useSharedValue(1);
  const drag = Gesture.Pan()
    .activeOffsetY(8)
    .failOffsetX([-24, 24])
    .onStart(() => {
      cancelAnimation(progress);
      dragFrom.value = progress.value;
    })
    .onUpdate((e) => {
      const h = Math.max(panelHeight.value, 1);
      // eslint-disable-next-line react-hooks/immutability -- reanimated 共享值的就地修改是其既定用法
      progress.value = Math.min(
        1,
        Math.max(0, dragFrom.value - Math.max(0, e.translationY) / h),
      );
    })
    .onEnd((e) => {
      if (
        1 - progress.value > MOTION.dragClose ||
        e.velocityY > MOTION.dragVelocity
      )
        scheduleOnRN(onClose);
      else
        // eslint-disable-next-line react-hooks/immutability -- reanimated 共享值的就地修改是其既定用法
        progress.value = reduceMotion
          ? 1
          : withTiming(1, {
              duration: MOTION.panelIn,
              easing: Easing.out(Easing.cubic),
            });
    });
  const scrimStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  const panelStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - progress.value) * panelHeight.value }],
  }));
  return (
    <Modal
      visible={mounted}
      animationType="none"
      transparent
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
      onDismiss={focusBack}
    >
      {/* Modal 自成原生窗口：手势要在它里面另起一个根，安卓上下拉才收得到。 */}
      <GestureHandlerRootView style={{ flex: 1 }}>
      {/* Modal 独立成层，不继承打开它的工具栏的嵌套纸面深度。 */}
      <GlassDepth.Provider value={0}>
        <View style={{ flex: 1, justifyContent: "flex-end" }}>
          {/* 蒙层不是玻璃，也不是面板的祖先：淡入用透明度没问题。 */}
          <Animated.View
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: colors.scrim },
              scrimStyle,
            ]}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={closeLabel}
              testID={closeTestID}
              style={StyleSheet.absoluteFill}
              onPress={onClose}
            />
          </Animated.View>
          {/* 面板只做位移：里面有玻璃胶囊，祖先不能改透明度。 */}
          <Animated.View
            accessibilityViewIsModal
            // 读屏的两指擦除（Z 字）等同于收起。
            onAccessibilityEscape={onClose}
            onLayout={(e) => {
              panelHeight.value = e.nativeEvent.layout.height;
            }}
            style={[
              {
                // 实色纸面：半透明玻璃会把编辑页底栏透出来。
                backgroundColor: colors.paper,
                borderTopLeftRadius: 24,
                borderTopRightRadius: 24,
                maxHeight: "82%",
                paddingTop: 8,
                paddingHorizontal: 20,
                paddingBottom: insets.bottom + 12,
              },
              panelStyle,
            ]}
          >
            <GestureDetector gesture={drag}>
              <View testID="sheet-drag">
                {/* 小横条只是「可以往下拉」的提示，读屏不读；收起走标题行的按钮或擦除手势。 */}
                <View
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                  style={{
                    alignSelf: "center",
                    width: 36,
                    height: 5,
                    borderRadius: 2.5,
                    backgroundColor: colors.line,
                    marginBottom: 8,
                  }}
                />
                {header}
              </View>
            </GestureDetector>
            {children}
          </Animated.View>
        </View>
        <PrivacyCover />
      </GlassDepth.Provider>
      </GestureHandlerRootView>
    </Modal>
  );
}
export function IconButton({
  label,
  icon,
  onPress,
  selected = false,
  disabled = false,
  testID,
}: {
  label: string;
  icon: JournalIconName;
  onPress: () => void;
  selected?: boolean;
  disabled?: boolean;
  testID?: string;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 22,
        backgroundColor: selected ? colors.selectedGlass : "transparent",
        opacity: disabled ? 0.4 : pressed ? 0.6 : 1,
      })}
    >
      <JournalIcon name={icon} color={colors.accent} size={22} />
    </Pressable>
  );
}
/**
 * 工具栏按钮：图标 + 11 号小标签（大字 13），透明无框，最低 44 触控。
 * 编辑页的媒体/AI 工具用它排成一行，贴在底栏上方——不跟胶囊按钮抢层级。
 */
export function ToolButton({
  icon,
  label,
  onPress,
  disabled = false,
  selected,
  badge,
  accessibilityLabel,
  testID,
  ref,
}: {
  icon: JournalIconName;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  selected?: boolean;
  badge?: ReactNode;
  accessibilityLabel?: string;
  testID?: string;
  /** 打开面板的按钮交给 SheetModal，面板收起后读屏焦点回到这里。 */
  ref?: Ref<View>;
}) {
  const { colors, large } = useTheme();
  return (
    <Pressable
      ref={ref}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled, selected }}
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
      <View>
        <JournalIcon name={icon} color={colors.accent} size={22} />
        {badge}
      </View>
      <NativeText
        maxFontSizeMultiplier={1.4}
        style={{
          fontSize: large ? 13 : 11,
          lineHeight: large ? 18 : 15,
          color: colors.muted,
        }}
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
        maxFontSizeMultiplier={TEXT_MAX_SCALE}
        {...props}
        accessibilityLabel={label}
        placeholderTextColor={colors.muted}
        style={[s.input, large && { fontSize: 19 }, props.style]}
      />
    </View>
  );
}
/**
 * 纸卡里的一行短输入：左侧辅助色小标签、右侧无框输入，行间一条细线（编辑页的标题、地点）。
 * 卡里不再套一层白框（卡不套卡），也不是标签悬在白框上面的网页表单；标签列最少 40，几行对齐。
 */
export function FieldRow({
  label,
  last = false,
  ...props
}: TextInputProps & { label: string; last?: boolean }) {
  const s = useStyles();
  const { colors, large } = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        minHeight: 48,
        borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth,
        borderBottomColor: colors.line,
      }}
    >
      <Text style={[s.muted, { minWidth: 40 }]}>{label}</Text>
      <TextInput
        maxFontSizeMultiplier={TEXT_MAX_SCALE}
        accessibilityLabel={label}
        {...props}
        placeholderTextColor={colors.muted}
        style={[
          {
            flex: 1,
            minWidth: 0,
            color: colors.ink,
            fontSize: large ? 19 : 16,
            paddingVertical: 12,
          },
          props.style,
        ]}
      />
    </View>
  );
}
/**
 * 页尾的危险动作（阅读页的删除记录）：单独一张纸卡，居中一行错误色字，
 * 与上面的卡同一套语汇——不再是飘在纸面上、左右都不挨着的一行红字。确认仍走系统弹窗。
 * 按压与禁用的透明度落在字上：卡在 iOS 是液态玻璃，祖先一透明系统就不画。
 */
export function DangerCard({
  title,
  onPress,
  disabled = false,
  testID,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
}) {
  const { colors } = useTheme();
  return (
    <Card style={{ padding: 0, gap: 0 }}>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onPress}
        style={{
          minHeight: 48,
          paddingHorizontal: 16,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {({ pressed }) => (
          <Text
            style={{
              color: colors.error,
              fontWeight: "600",
              textAlign: "center",
              opacity: disabled ? 0.4 : pressed ? 0.6 : 1,
            }}
          >
            {title}
          </Text>
        )}
      </Pressable>
    </Card>
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
  fill = false,
}: {
  media: LocalMedia | undefined;
  contain?: boolean;
  size?: number;
  /** 固定裁切比例（书架小封面与月册网格 1:1）；缺省按素材真实宽高比。 */
  ratio?: number;
  /** 列表/封面等小图场景：优先渲染持久缩略图。 */
  preview?: boolean;
  /** 读屏标签；缺省读作「照片」，不读原始文件名。 */
  label?: string;
  /** 圆角；首页「最近」卡顶的照片由外层裁圆角，传 0。 */
  radius?: number;
  /** 撑满父容器、不按比例：首页「最近」卡的照片高度随首屏剩下的空间走。 */
  fill?: boolean;
}) {
  const s = useStyles();
  const { colors } = useTheme();
  const [error, setError] = useState(false);
  const [thumbFailed, setThumbFailed] = useState(false);
  // 小格子（编辑页 96 的附件格、书架封面、月册网格）放不下两句话：只画同尺寸的占位与图标，
  // 不然两行说明在窄格里折成十来行，把格子和整页撑高。读屏照样读出缺图。
  if ((!media || error) && (size !== undefined || ratio !== undefined))
    return (
      <View
        accessible
        accessibilityLabel="照片暂时无法读取"
        style={[
          {
            alignItems: "center",
            justifyContent: "center",
            borderRadius: radius,
            backgroundColor: colors.selected,
          },
          size !== undefined
            ? { width: size, height: size }
            : { width: "100%", aspectRatio: ratio },
        ]}
      >
        <JournalIcon name="image" color={colors.muted} size={22} />
      </View>
    );
  if (!media || error)
    return (
      <View
        style={[
          s.section,
          fill ? { flex: 1, overflow: "hidden" } : { minHeight: size ?? 120, width: size },
        ]}
      >
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
        fill
          ? { flex: 1, width: "100%", borderRadius: radius }
          : {
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
