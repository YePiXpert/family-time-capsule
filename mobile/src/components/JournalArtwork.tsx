import { Image, StyleSheet, View } from "react-native";
import keepsake from "../../assets/illustrations/keepsake-box.webp";
import album from "../../assets/illustrations/growing-album.webp";
import { useColorTheme } from "../theme";

/** Bundled decoration stays available offline and never represents a family photo. */
export function JournalArtwork({ kind, compact = false }: { kind: "keepsake" | "album"; compact?: boolean }) {
  const { colors } = useColorTheme();
  return (
    <View style={[compact ? styles.compactFrame : styles.featureFrame, { borderColor: colors.line, backgroundColor: colors.card }]}>
      <Image source={kind === "keepsake" ? keepsake : album} accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" resizeMode="cover" style={compact ? styles.compact : styles.feature} />
    </View>
  );
}

const styles = StyleSheet.create({
  compactFrame: { alignSelf: "center", borderRadius: 20, borderWidth: 1, overflow: "hidden" },
  featureFrame: { alignSelf: "center", maxWidth: "100%", borderRadius: 22, borderWidth: 1, overflow: "hidden" },
  compact: { width: 112, height: 102 },
  feature: { width: 216, height: 144 },
});
