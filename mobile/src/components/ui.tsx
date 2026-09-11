import type { ReactNode } from "react";
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { journalRadius, journalSpace } from "../design/tokens";
import { useColorTheme } from "../theme";
import { JournalIcon, type JournalIconName } from "./JournalIcon";
import { Text } from "./typography";

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

export function Button({
  title,
  onPress,
  variant = "secondary",
  icon,
  disabled,
  full = true,
  accessibilityLabel,
  testID,
}: {
  title: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  icon?: JournalIconName;
  disabled?: boolean;
  full?: boolean;
  accessibilityLabel?: string;
  testID?: string;
}) {
  const { colors } = useColorTheme();
  const tone = {
    primary: { bg: colors.coral, border: colors.coral, text: colors.onCoral, icon: colors.onCoral },
    secondary: { bg: colors.card, border: colors.line, text: colors.coralDark, icon: colors.coralDark },
    danger: { bg: colors.errorSoft, border: colors.dangerLine, text: colors.error, icon: colors.error },
    ghost: { bg: "transparent", border: "transparent", text: colors.coralDark, icon: colors.coralDark },
  }[variant];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled }}
      testID={testID}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        full && styles.full,
        { backgroundColor: tone.bg, borderColor: tone.border },
        variant === "ghost" && styles.ghost,
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      {icon ? <JournalIcon name={icon} color={tone.icon} size={19} /> : null}
      <Text style={[styles.buttonText, { color: tone.text }]}>{title}</Text>
    </Pressable>
  );
}

/** 轻量筛选胶囊：未选中弱化为描边，选中柔和填充，不再使用实心重按钮。 */
export function Chip({
  label,
  selected,
  onPress,
  icon,
  accessibilityRole = "tab",
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: JournalIconName;
  accessibilityRole?: "tab" | "button";
}) {
  const { colors } = useColorTheme();
  return (
    <Pressable
      accessibilityRole={accessibilityRole}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: selected ? colors.softCoral : colors.card,
          borderColor: selected ? colors.peach : colors.line,
        },
        pressed && styles.pressed,
      ]}
    >
      {icon ? <JournalIcon name={icon} color={selected ? colors.coralDark : colors.muted} size={16} /> : null}
      <Text style={[styles.chipText, { color: selected ? colors.coralDark : colors.muted }]}>{label}</Text>
    </Pressable>
  );
}

/** 圆形图标按钮：工具行与头部动作使用，44px 触控。 */
export function IconButton({
  icon,
  label,
  onPress,
  tone = "plain",
}: {
  icon: JournalIconName;
  label: string;
  onPress?: () => void;
  tone?: "plain" | "accent";
}) {
  const { colors } = useColorTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.iconButton,
        {
          backgroundColor: tone === "accent" ? colors.softCoral : colors.card,
          borderColor: tone === "accent" ? colors.peach : colors.line,
        },
        pressed && styles.pressed,
      ]}
    >
      <JournalIcon name={icon} color={tone === "accent" ? colors.coralDark : colors.ink} size={20} />
    </Pressable>
  );
}

/** 状态/事实小胶囊：月龄、数量、可见范围。 */
export function Pill({ label, icon, tone = "accent" }: { label: string; icon?: JournalIconName; tone?: "accent" | "sage" | "plain" }) {
  const { colors } = useColorTheme();
  const palette = {
    accent: { bg: colors.softCoral, text: colors.coralDark },
    sage: { bg: colors.softSage, text: colors.sage },
    plain: { bg: colors.card, text: colors.muted },
  }[tone];
  return (
    <View style={[styles.pill, { backgroundColor: palette.bg }]}>
      {icon ? <JournalIcon name={icon} color={palette.text} size={14} /> : null}
      <Text style={[styles.pillText, { color: palette.text }]}>{label}</Text>
    </View>
  );
}

export function SectionHeader({ title, action, style }: { title: string; action?: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { colors } = useColorTheme();
  return (
    <View style={[styles.sectionHeader, style]}>
      <Text accessibilityRole="header" style={[styles.sectionTitle, { color: colors.muted }]}>{title}</Text>
      {action}
    </View>
  );
}

/** 分组列表容器：iOS inset-grouped 语言，卡片底 + 细分隔线。 */
export function ListGroup({ children }: { children: ReactNode }) {
  const { colors } = useColorTheme();
  return (
    <View style={[styles.listGroup, { backgroundColor: colors.card, borderColor: colors.line }]}>
      {children}
    </View>
  );
}

export function ListRow({
  icon,
  title,
  detail,
  value,
  onPress,
  destructive,
  last,
}: {
  icon?: JournalIconName;
  title: string;
  detail?: string;
  value?: string;
  onPress?: () => void;
  destructive?: boolean;
  last?: boolean;
}) {
  const { colors } = useColorTheme();
  const titleColor = destructive ? colors.error : colors.ink;
  const body = (
    <View style={[styles.listRow, !last && { borderBottomColor: colors.line, borderBottomWidth: StyleSheet.hairlineWidth }]}>
      {icon ? (
        <View style={[styles.listIcon, { backgroundColor: destructive ? colors.errorSoft : colors.softCoral }]}>
          <JournalIcon name={icon} color={destructive ? colors.error : colors.coralDark} size={17} />
        </View>
      ) : null}
      <View style={styles.listBody}>
        <Text style={[styles.listTitle, { color: titleColor }]}>{title}</Text>
        {detail ? <Text style={[styles.listDetail, { color: colors.muted }]}>{detail}</Text> : null}
      </View>
      {value ? <Text style={[styles.listValue, { color: colors.muted }]}>{value}</Text> : null}
      {onPress ? <JournalIcon name="chevron-right" color={colors.faint} size={16} /> : null}
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress} style={({ pressed }) => pressed && styles.pressed}>
      {body}
    </Pressable>
  );
}

/** 空状态：装饰插画 + 短句 + 可选动作。插画不进导出与备份。 */
export function EmptyState({
  title,
  body,
  action,
  art,
}: {
  title: string;
  body?: string;
  action?: ReactNode;
  art?: ReactNode;
}) {
  const { colors } = useColorTheme();
  return (
    <View style={styles.empty}>
      {art}
      <Text accessibilityRole="header" style={[styles.emptyTitle, { color: colors.ink }]}>{title}</Text>
      {body ? <Text style={[styles.emptyBody, { color: colors.muted }]}>{body}</Text> : null}
      {action ? <View style={styles.emptyAction}>{action}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: journalRadius.control,
    borderWidth: 1,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  full: { alignSelf: "stretch" },
  ghost: { minHeight: 44, paddingHorizontal: 8 },
  buttonText: { fontSize: 15, fontWeight: "600", flexShrink: 1, textAlign: "center" },
  chip: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: journalRadius.chip,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  chipText: { fontSize: 14, fontWeight: "500", flexShrink: 1 },
  iconButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: journalRadius.pill,
    borderWidth: 1,
  },
  pill: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: journalRadius.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  pillText: { fontSize: 13, fontWeight: "700" },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: journalSpace.hair,
    marginBottom: journalSpace.small,
  },
  sectionTitle: { fontSize: 13, fontWeight: "700", letterSpacing: 0.6 },
  listGroup: {
    borderRadius: journalRadius.card,
    borderWidth: 1,
    overflow: "hidden",
  },
  listRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 56,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  listIcon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  listBody: { flex: 1, gap: 2 },
  listTitle: { fontSize: 16, fontWeight: "600" },
  listDetail: { fontSize: 13, lineHeight: 18 },
  listValue: { fontSize: 14 },
  empty: { alignItems: "center", justifyContent: "center", padding: 32, gap: 10 },
  emptyTitle: { fontSize: 20, fontWeight: "700", textAlign: "center" },
  emptyBody: { fontSize: 14, lineHeight: 21, textAlign: "center" },
  emptyAction: { marginTop: 6 },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.45 },
});
