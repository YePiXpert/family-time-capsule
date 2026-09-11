import type { ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { journalRadius } from "../design/tokens";
import { useColorTheme } from "../theme";
import { GlassSurface } from "./GlassSurface";

/**
 * 玻璃卡片容器：共享的 liquid-glass 卡片材质（tier="card"）。
 * 内容仍是主角，玻璃只提供材质；减少透明时 GlassSurface 自动退回纯色。
 */
export function GlassCard({
  children,
  style,
  radius = journalRadius.card,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  radius?: number;
}) {
  const { colors } = useColorTheme();
  return (
    <View style={[styles.card, { borderColor: colors.line }, style]}>
      <GlassSurface tier="card" radius={radius} />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: journalRadius.card,
    borderWidth: 1,
    overflow: "hidden",
    padding: 16,
    gap: 9,
  },
});
