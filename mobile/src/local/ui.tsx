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
import Svg, { Defs, RadialGradient, Rect, Stop } from "react-native-svg";
import { JournalIcon, type JournalIconName } from "../components/JournalIcon";
import { useLibrary } from "./context";
const light = {
  paper: "#FAF5EC",
  card: "#FFFFFF",
  ink: "#3B3129",
  muted: "#8C7C6A",
  line: "#EBDFCC",
  accent: "#B4553C",
  onAccent: "#FFFFFF",
  selected: "#F5E7D3",
  error: "#A03C36",
  glass: "#FFFDF8",
  glassLine: "#EBDFCC",
  accentGlass: "#B4553C",
  selectedGlass: "#F5E7D3",
  glow1: "#F3D9B8",
  glow2: "#EFC5B0",
  glow3: "#E8DCC4",
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
  glass: "#2C241C",
  glassLine: "#453A2E",
  accentGlass: "#E09B76",
  selectedGlass: "#3A2D20",
  glow1: "#3A2A1C",
  glow2: "#40241C",
  glow3: "#2E2A1E",
};
export const serif = Platform.select({ ios: "Georgia", android: "serif" });
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
}
export function Glass({
  children,
  style,
  radius = 16,
  tint,
  accessibilityViewIsModal,
}: {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  radius?: number;
  tint?: string;
  intensity?: number;
  accessibilityViewIsModal?: boolean;
}) {
  const { colors, dark } = useTheme();
  return (
    <View
      accessibilityViewIsModal={accessibilityViewIsModal}
      style={[
        {
          borderRadius: radius,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: colors.glassLine,
          backgroundColor: tint ?? colors.glass,
          shadowColor: dark ? "#000000" : "#7A5C3E",
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: dark ? 0.3 : 0.08,
          shadowRadius: 10,
          elevation: 2,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}
export function useStyles() {
  const { colors: c, dark } = useTheme();
  return useMemo(
    () => {
      const cardShadow: ViewStyle = {
        shadowColor: dark ? "#000000" : "#7A5C3E",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: dark ? 0.3 : 0.07,
        shadowRadius: 8,
        elevation: 1,
      };
      return StyleSheet.create({
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
          fontFamily: serif,
          color: c.ink,
        },
        heading: { fontSize: 18, lineHeight: 27, fontWeight: "600", fontFamily: serif },
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
        compactPanel: {
          paddingHorizontal: 12,
          paddingVertical: 8,
          borderRadius: 12,
          gap: 8,
          backgroundColor: c.glass,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: c.glassLine,
          ...cardShadow,
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
    },
    [c, dark],
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
  compact = false,
}: {
  title: string;
  onPress: () => void;
  primary?: boolean;
  disabled?: boolean;
  icon?: JournalIconName;
  testID?: string;
  selected?: boolean;
  compact?: boolean;
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
        radius={14}
        tint={primary ? c.accentGlass : selected ? c.selectedGlass : undefined}
        intensity={primary ? 55 : 40}
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
        {icon && <JournalIcon name={icon} color={color} size={20} />}
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
      </Glass>
    </Pressable>
  );
}
export function IconButton({
  label,
  icon,
  onPress,
  selected = false,
}: {
  label: string;
  icon: JournalIconName;
  onPress: () => void;
  selected?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
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
