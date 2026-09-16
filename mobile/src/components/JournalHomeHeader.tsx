import { Platform, StyleSheet, View, Pressable } from "react-native";
import { Text } from "./typography";
import { IconButton } from "./ui";
import { JournalIcon } from "./JournalIcon";
import { journalFont, journalType } from "../design/tokens";
import { useColorTheme } from "../theme";

/** Everyday navigation leaves the first screen to the family's own content. */
export function JournalHomeHeader({ title, summary, filtered, expanded, onFilter, onSearch }: {
  title: string; summary: string; filtered: boolean; expanded: boolean;
  onFilter: () => void; onSearch: () => void;
}) {
  const { colors } = useColorTheme();
  return <View testID="timeline-heading" style={styles.header}>
    <View style={styles.row}>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>{title}</Text>
      <IconButton icon="search" label="搜索" onPress={onSearch} />
    </View>
    <View style={styles.row}>
      <Text style={[styles.summary, { color: colors.muted }]}>{summary}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="回看与筛选" accessibilityState={{ expanded }} onPress={onFilter} style={styles.filter}>
        <JournalIcon name="calendar" color={colors.coralDark} size={16} />
        <Text style={{ color: colors.coralDark, fontSize: journalType.caption }}>{filtered ? "筛选中" : "筛选"}</Text>
      </Pressable>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  header: { gap: 0 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  title: { flex: 1, fontSize: journalType.pageTitle, fontFamily: Platform.OS === "ios" ? journalFont.editorialIOS : journalFont.editorialAndroid, fontWeight: "400" },
  summary: { flex: 1, fontSize: journalType.caption, lineHeight: 20 },
  filter: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 5 },
});
