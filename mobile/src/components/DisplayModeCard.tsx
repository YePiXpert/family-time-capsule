import { Text } from "./typography";
import { Pressable, StyleSheet, View } from "react-native";
import { useApp } from "../state/AppContext";
import { useSharedStyles } from "../theme";

/**
 * 标准显示 / 大字显示的设备级切换（NAV-11）。
 * 只影响这一台设备的界面大小，不改变任何权限。
 */
export function DisplayModeCard() {
  const { displayMode, setDisplayMode } = useApp();
  const s = useSharedStyles();
  if (!displayMode) return null;
  return (
    <View style={s.card}>
      <Text style={s.cardTitle}>显示方式</Text>
      <Text style={s.body}>只影响这一台设备；只调整文字和按钮大小，所有功能保持一致。</Text>
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: displayMode === "standard" }}
          testID="display-standard"
          onPress={() => void setDisplayMode("standard")}
          style={({ pressed }) => [
            styles.option,
            { borderColor: s.colors.line, backgroundColor: s.colors.paper },
            displayMode === "standard" && { borderColor: s.colors.coral, backgroundColor: s.colors.softCoral },
            pressed && s.pressed,
          ]}
        >
          <Text style={[styles.optionText, { color: s.colors.ink }, displayMode === "standard" && { color: s.colors.coralDark }]}>标准显示</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: displayMode === "simple" }}
          testID="display-simple"
          onPress={() => void setDisplayMode("simple")}
          style={({ pressed }) => [
            styles.option,
            { borderColor: s.colors.line, backgroundColor: s.colors.paper },
            displayMode === "simple" && { borderColor: s.colors.coral, backgroundColor: s.colors.softCoral },
            pressed && s.pressed,
          ]}
        >
          <Text style={[styles.optionText, { color: s.colors.ink }, displayMode === "simple" && { color: s.colors.coralDark }]}>大字显示</Text>
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
  },
  optionText: { fontSize: 16, fontWeight: "800" },
});
