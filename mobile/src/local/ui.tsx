import { createContext, useContext, useMemo, type ReactNode } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text as NativeText,
  TextInput,
  View,
  useColorScheme,
  type TextProps,
  type TextInputProps,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
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
export function useStyles() {
  const { colors: c } = useTheme();
  return useMemo(
    () =>
      StyleSheet.create({
        page: { flex: 1, backgroundColor: c.paper },
        content: { padding: 20, gap: 20, paddingBottom: 32 },
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
          backgroundColor: c.card,
          color: c.ink,
          minHeight: 48,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: c.line,
          padding: 12,
          fontSize: 16,
        },
        section: {
          backgroundColor: c.card,
          borderRadius: 16,
          padding: 16,
          gap: 12,
        },
        line: { height: 1, backgroundColor: c.line },
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
}: {
  children: ReactNode;
  scroll?: boolean;
  top?: boolean;
}) {
  const s = useStyles();
  return (
    <SafeAreaView
      edges={top ? ["top", "left", "right"] : ["left", "right"]}
      style={s.page}
    >
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
        minHeight: 48,
        borderRadius: 12,
        paddingHorizontal: 14,
        paddingVertical: 10,
        flexDirection: "row",
        gap: 8,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: primary
          ? c.accent
          : selected
            ? c.selected
            : "transparent",
        opacity: disabled ? 0.5 : pressed ? 0.7 : 1,
        flexShrink: 1,
      })}
    >
      {icon && <JournalIcon name={icon} color={color} size={20} />}
      <Text
        style={{ color, fontWeight: "600", flexShrink: 1, textAlign: "center" }}
      >
        {title}
      </Text>
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
  if (/[\u4e00-\u9fff]/.test(e.message)) return e.message;
  return "操作未完成，现有资料和输入已保留，请重试。";
};
export function dateLabel(date: string) {
  const d = new Date(date);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}
