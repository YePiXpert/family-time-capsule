import { StyleSheet, View, Pressable } from "react-native";
import { Text } from "./typography";
import { IconButton } from "./ui";
import { journalType } from "../design/tokens";
import { useColorTheme } from "../theme";

/** Identity and everyday actions remain visible above the family's own content. */
export function JournalHomeHeader({ title, summary, selecting, onSelect, onSearch }: {
  title: string; summary: string; selecting: boolean;
  onSelect: () => void; onSearch: () => void;
}) {
  const { colors } = useColorTheme();
  return <View testID="timeline-heading" style={styles.header}>
    <View style={styles.row}>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>{title}</Text>
      <IconButton icon="search" label="搜索" onPress={onSearch} />
      <Pressable accessibilityRole="button" accessibilityLabel={selecting ? "取消选择" : "选择"} accessibilityState={{ selected: selecting }} onPress={onSelect} style={styles.select}>
        <Text style={{ color: colors.coralDark, fontSize: journalType.label, fontWeight: "600" }}>{selecting ? "取消" : "选择"}</Text>
      </Pressable>
    </View>
    <Text style={[styles.summary, { color: colors.muted }]}>{summary}</Text>
  </View>;
}
const styles = StyleSheet.create({
  header: { gap: 4 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  title: { flex: 1, fontSize: journalType.pageTitle, fontWeight: "600" },
  summary: { fontSize: journalType.caption, lineHeight: 20 },
  select: { minHeight: 44, minWidth: 44, alignItems: "center", justifyContent: "center" },
});
