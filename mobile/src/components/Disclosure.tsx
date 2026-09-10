import { Text } from "./typography";
import { JournalIcon } from "./JournalIcon";
import { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useColorTheme } from "../theme";
import { journalRadius, journalSpace } from "../design/tokens";

/** Mount tools only when requested; screen readers see the same expanded state. */
export function Disclosure({ title, children, open, onToggle }: { title: string; children: ReactNode; open?: boolean; onToggle?: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const visible = open ?? expanded;
  const { colors } = useColorTheme();
  return <View style={{ gap: journalSpace.small }}>
    <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ expanded: visible }} onPress={onToggle ?? (() => setExpanded(value => !value))} style={({ pressed }) => [styles.trigger, { backgroundColor: colors.card, borderColor: colors.line }, pressed && { opacity: 0.72 }]}>
      <Text style={[styles.triggerTitle, { color: colors.ink }]}>{title}</Text>
      <JournalIcon name={visible ? "chevron-down" : "chevron-right"} size={18} color={colors.faint} />
    </Pressable>
    {visible ? children : null}
  </View>;
}

const styles = StyleSheet.create({
  trigger: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: journalSpace.small,
    paddingHorizontal: journalSpace.medium,
    borderRadius: journalRadius.control,
    borderWidth: 1,
  },
  triggerTitle: { fontSize: 15, fontWeight: "600" },
});
