import type { RefObject } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { BlurView } from "expo-blur";
import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from "expo-glass-effect";
import { LinearGradient } from "expo-linear-gradient";
import { journalGlass, journalRadius, type JournalGlassTier } from "../design/tokens";
import { useAccessibleEffects } from "../design/use-effects";
import { useColorTheme } from "../theme";

const tierRadius: Record<JournalGlassTier, number> = {
  dock: 28,
  card: journalRadius.card,
  sheet: journalRadius.sheet,
  overlay: 26,
};

/** Android tint intensity per tier: sheets sit above scrims and blur harder. */
const tierIntensity: Record<JournalGlassTier, number> = {
  dock: 55,
  card: 42,
  sheet: 68,
  overlay: 62,
};

/**
 * Liquid-glass surface. Decoration-only by default (pointerEvents="none");
 * pass `interactive` when children inside must receive presses.
 * On Android the blurred target stays the screen content behind (`target`).
 */
export function GlassSurface({
  target,
  tier = "card",
  radius,
  interactive = false,
}: {
  target?: RefObject<View | null>;
  tier?: JournalGlassTier;
  radius?: number;
  interactive?: boolean;
}) {
  const { reducedTransparency } = useAccessibleEffects();
  const { colors, scheme } = useColorTheme();
  const corner = radius ?? tierRadius[tier];
  const pointerEvents = interactive ? undefined : "none";
  const supported = Platform.OS === "ios" || (Platform.OS === "android" && Number(Platform.Version) >= 31 && target);
  if (reducedTransparency || !supported) {
    const solid = tier === "sheet" || tier === "overlay" ? colors.elevated : colors.card;
    return <View pointerEvents={pointerEvents} style={[StyleSheet.absoluteFill, { backgroundColor: solid, borderRadius: corner }]} />;
  }
  if (Platform.OS === "ios" && isGlassEffectAPIAvailable() && isLiquidGlassAvailable()) {
    return <GlassView pointerEvents={pointerEvents} glassEffectStyle={tier === "overlay" ? "clear" : "regular"} colorScheme={scheme} style={[StyleSheet.absoluteFill, { borderRadius: corner }]} />;
  }
  const rim = journalGlass.rim[scheme];
  return <View pointerEvents={pointerEvents} style={StyleSheet.absoluteFill}>
    <BlurView tint={scheme === "dark" ? "dark" : "light"} intensity={tierIntensity[tier]} blurMethod="dimezisBlurViewSdk31Plus" blurTarget={target} style={StyleSheet.absoluteFill} />
    <LinearGradient
      colors={journalGlass.tint[scheme][tier]}
      locations={[0, 0.48, 1]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={StyleSheet.absoluteFill}
    />
    <View style={[StyleSheet.absoluteFill, styles.rim, { borderRadius: corner, borderTopColor: rim.top, borderLeftColor: rim.left, borderRightColor: rim.right, borderBottomColor: rim.bottom }]} />
  </View>;
}

const styles = StyleSheet.create({
  rim: { borderWidth: 1 },
});
