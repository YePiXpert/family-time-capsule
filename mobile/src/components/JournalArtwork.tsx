import { Image, StyleSheet } from "react-native";
import keepsake from "../../assets/illustrations/keepsake-box.png";
import album from "../../assets/illustrations/growing-album.png";

/** Bundled decoration stays available offline and never represents a family photo. */
export function JournalArtwork({ kind, compact = false }: { kind: "keepsake" | "album"; compact?: boolean }) {
  return <Image source={kind === "keepsake" ? keepsake : album} accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" resizeMode="contain" style={compact ? styles.compact : styles.feature} />;
}

const styles = StyleSheet.create({
  compact: { width: 108, height: 100, alignSelf: "center", borderRadius: 18 },
  feature: { width: 216, height: 144, maxWidth: "100%", alignSelf: "center", borderRadius: 18 },
});
