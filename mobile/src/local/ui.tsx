import { createContext, useContext, useMemo, type ReactNode } from "react";
import {
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
import { SafeAreaView } from "react-native-safe-area-context";
import { BlurView } from "expo-blur";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import Svg, { Defs, RadialGradient, Rect, Stop } from "react-native-svg";
import { JournalIcon, type JournalIconName } from "../components/JournalIcon";
import { useLibrary } from "./context";
const light = {
  paper: "#F7F8F5",
  card: "#FFFFFF",
  ink: "#202923",
  muted: "#616B64",
  line: "#E1E6DF",
  accent: "#426A58",
  onAccent: "#FFFFFF",
  selected: "#E8F0E9",
  error: "#A03C36",
  glass: "rgba(255,255,255,0.55)",
  glassLine: "rgba(255,255,255,0.75)",
  accentGlass: "rgba(66,106,88,0.88)",
  selectedGlass: "rgba(232,240,233,0.72)",
  glow1: "#B9D9C4",
  glow2: "#F0DEC4",
  glow3: "#C4D8E4",
};
const dark: typeof light = {
  paper: "#171C19",
  card: "#202722",
  ink: "#F0F4EF",
  muted: "#B7C2B8",
  line: "#3A463D",
  accent: "#A6CCB5",
  onAccent: "#173224",
  selected: "#2B4033",
  error: "#F0A59D",
  glass: "rgba(32,39,34,0.52)",
  glassLine: "rgba(255,255,255,0.14)",
  accentGlass: "rgba(166,204,181,0.85)",
  selectedGlass: "rgba(43,64,51,0.66)",
  glow1: "#24402F",
  glow2: "#3D3423",
  glow3: "#22343F",
};
const ThemeContext = createContext({
  colors: light,
  large: false,
  dark: false,
});
export function LocalTheme({ children }: { children: ReactNode }) {
  const s = useLibrary(),
    system = useColorScheme();
  const isDark =
    s.settings.theme === "dark" ||
    (s.settings.theme === "auto" && system === "dark");
  return (
    <ThemeContext.Provider
      value={{
        colors: isDark ? dark : light,
        large: s.settings.largeText,
        dark: isDark,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}
export const useTheme = () => useContext(ThemeContext);
export function Text({ style, ...props }: TextProps) {
  const { colors, large } = useTheme();
  return (
    <NativeText
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
export function GlassBackdrop() {
  const { colors, dark } = useTheme();
  const { width, height } = useWindowDimensions();
  const glowOpacity = dark ? 0.55 : 0.8;
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
            <Stop offset="0" stopColor={colors.glow1} stopOpacity={glowOpacity} />
            <Stop offset="1" stopColor={colors.glow1} stopOpacity="0" />
          </RadialGradient>
          <RadialGradient
            id="glow2"
            cx={width * 0.95}
            cy={height * 0.3}
            r={width * 0.85}
            gradientUnits="userSpaceOnUse"
          >
            <Stop offset="0" stopColor={colors.glow2} stopOpacity={glowOpacity} />
            <Stop offset="1" stopColor={colors.glow2} stopOpacity="0" />
          </RadialGradient>
          <RadialGradient
            id="glow3"
            cx={width * 0.3}
            cy={height * 1.0}
            r={width * 1.05}
            gradientUnits="userSpaceOnUse"
          >
            <Stop offset="0" stopColor={colors.glow3} stopOpacity={glowOpacity} />
            <Stop offset="1" stopColor={colors.glow3} stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Rect width={width} height={height} fill="url(#glow1)" />
        <Rect width={width} height={height} fill="url(#glow2)" />
        <Rect width={width} height={height} fill="url(#glow3)" />
      </Svg>
    </View>
  );
}
export function Glass({
  children,
  style,
  radius = 16,
  tint,
  intensity = 45,
}: {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  radius?: number;
  tint?: string;
  intensity?: number;
}) {
  const { colors, dark } = useTheme();
  const base: ViewStyle = {
    borderRadius: radius,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassLine,
    overflow: "hidden",
  };
  if (Platform.OS === "ios" && isLiquidGlassAvailable())
    return (
      <GlassView
        glassEffectStyle="regular"
        colorScheme={dark ? "dark" : "light"}
        tintColor={tint}
        style={[base, style]}
      >
        {children}
      </GlassView>
    );
  return (
    <BlurView
      intensity={intensity}
      tint={dark ? "dark" : "light"}
      blurMethod="dimezisBlurViewSdk31Plus"
      style={[base, { backgroundColor: tint ?? colors.glass }, style]}
    >
      {children}
    </BlurView>
  );
}
export function useStyles() {
  const { colors: c } = useTheme();
  return useMemo(
    () =>
      StyleSheet.create({
        page: { flex: 1, backgroundColor: c.paper },
        content: { padding: 20, gap: 20, paddingBottom: 32 },
        tabContent: { paddingBottom: 112 },
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
          fontSize: 24,
          lineHeight: 33,
          fontWeight: "600",
          color: c.ink,
        },
        heading: { fontSize: 18, lineHeight: 27, fontWeight: "600" },
        muted: { fontSize: 13, lineHeight: 21, color: c.muted },
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
        line: { height: StyleSheet.hairlineWidth, backgroundColor: c.glassLine },
        image: {
          width: "100%",
          aspectRatio: 4 / 3,
          borderRadius: 16,
          backgroundColor: c.selected,
        },
        empty: { paddingVertical: 32, gap: 12 },
      }),
    [c],
  );
}
export function Page({
  children,
  scroll = true,
  top = false,
  tab = false,
}: {
  children: ReactNode;
  scroll?: boolean;
  top?: boolean;
  tab?: boolean;
}) {
  const s = useStyles();
  return (
    <SafeAreaView
      edges={top ? ["top", "left", "right"] : ["left", "right"]}
      style={s.page}
    >
      <GlassBackdrop />
      {scroll ? (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={[s.content, tab && s.tabContent]}
        >
          {children}
        </ScrollView>
      ) : (
        children
      )}
    </SafeAreaView>
  );
}
export function Button({
  title,
  onPress,
  primary = false,
  disabled = false,
  icon,
  testID,
  selected,
}: {
  title: string;
  onPress: () => void;
  primary?: boolean;
  disabled?: boolean;
  icon?: JournalIconName;
  testID?: string;
  selected?: boolean;
}) {
  const { colors: c } = useTheme();
  const color = primary ? c.onAccent : c.accent;
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
      style={({ pressed }) => ({
        flexShrink: 1,
        opacity: disabled ? 0.5 : pressed ? 0.7 : 1,
      })}
    >
      <Glass
        radius={24}
        tint={primary ? c.accentGlass : selected ? c.selectedGlass : undefined}
        intensity={primary ? 55 : 40}
        style={{
          minHeight: 48,
          paddingHorizontal: 16,
          paddingVertical: 10,
          flexDirection: "row",
          gap: 8,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {icon && <JournalIcon name={icon} color={color} size={20} />}
        <Text
          style={{ color, fontWeight: "600", flexShrink: 1, textAlign: "center" }}
        >
          {title}
        </Text>
      </Glass>
    </Pressable>
  );
}
export function Field({ label, ...props }: TextInputProps & { label: string }) {
  const s = useStyles(),
    { colors, large } = useTheme();
  return (
    <View style={{ gap: 8 }}>
      <Text style={s.muted}>{label}</Text>
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
export const messageOf = (e: unknown) => {
  if (!(e instanceof Error)) return "操作未完成，请重试。";
  if (/ENOSPC|SQLITE_FULL|disk.*full|not enough space/i.test(e.message))
    return "本机空间不足，请释放一些空间后重试。当前输入仍保留。";
  if (/JSON|parse|malformed|corrupt/i.test(e.message))
    return "本机资料暂时无法完整读取，原有文件已保留。请重试，或选择完整备份恢复。";
  if (/[一-鿿]/.test(e.message)) return e.message;
  return "操作未完成，现有资料和输入已保留，请重试。";
};
export function dateLabel(date: string) {
  const d = new Date(date);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}
