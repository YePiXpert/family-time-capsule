import { Pressable, StyleSheet, Text, View } from "react-native";
import { useApp } from "../state/AppContext";
import { colors, sharedStyles } from "../theme";

/**
 * 标准显示 / 大字简洁显示的设备级切换（NAV-11）。
 * 只影响这一台设备的界面大小与入口数量，不改变任何权限。
 */
export function DisplayModeCard() {
  const { displayMode, setDisplayMode } = useApp();
  if (!displayMode) return null;
  return (
    <View style={sharedStyles.card}>
      <Text style={sharedStyles.cardTitle}>显示方式</Text>
      <Text style={sharedStyles.body}>只影响这一台设备；想用完整功能时，随时切回标准显示。</Text>
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: displayMode === "standard" }}
          testID="display-standard"
          onPress={() => void setDisplayMode("standard")}
          style={({ pressed }) => [
            styles.option,
            displayMode === "standard" && styles.optionActive,
            pressed && sharedStyles.pressed,
          ]}
        >
          <Text style={[styles.optionText, displayMode === "standard" && styles.optionTextActive]}>标准显示</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: displayMode === "simple" }}
          testID="display-simple"
          onPress={() => void setDisplayMode("simple")}
          style={({ pressed }) => [
            styles.option,
            displayMode === "simple" && styles.optionActive,
            pressed && sharedStyles.pressed,
          ]}
        >
          <Text style={[styles.optionText, displayMode === "simple" && styles.optionTextActive]}>大字简洁显示</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 10 },
  option: {
    flex: 1,
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 13,
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: colors.paper,
  },
  optionActive: { borderColor: colors.coral, backgroundColor: colors.softCoral },
  optionText: { color: colors.ink, fontSize: 16, fontWeight: "800" },
  optionTextActive: { color: colors.coralDark },
});
