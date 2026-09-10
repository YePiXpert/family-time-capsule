import type { RefObject } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { BlurView } from "expo-blur";
import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from "expo-glass-effect";
import { LinearGradient } from "expo-linear-gradient";
import { useAccessibleEffects } from "../design/use-effects";
import { colors } from "../theme";

/** Decoration only: screen content is the Android blur target, never this overlay. */
export function GlassSurface({ target }: { target?: RefObject<View | null> }) {
  const { reducedTransparency } = useAccessibleEffects();
  const supported = Platform.OS === "ios" || (Platform.OS === "android" && Number(Platform.Version) >= 31 && target);
  if (reducedTransparency || !supported) return <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: colors.card }]} />;
  if (Platform.OS === "ios" && isGlassEffectAPIAvailable() && isLiquidGlassAvailable()) {
    return <GlassView pointerEvents="none" glassEffectStyle="regular" colorScheme="light" style={[StyleSheet.absoluteFill, styles.rounded]} />;
  }
  return <View pointerEvents="none" style={StyleSheet.absoluteFill}>
    <BlurView tint="light" intensity={55} blurMethod="dimezisBlurViewSdk31Plus" blurTarget={target} style={StyleSheet.absoluteFill} />
    <LinearGradient colors={["rgba(255,255,255,0.64)", "rgba(255,253,249,0.30)", "rgba(239,185,168,0.22)"]} locations={[0, 0.48, 1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
    <View style={[StyleSheet.absoluteFill, styles.rim]} />
  </View>;
}

const styles = StyleSheet.create({
  rounded: { borderRadius: 26 },
  rim: { borderRadius: 26, borderWidth: 1, borderTopColor: "rgba(255,255,255,0.95)", borderLeftColor: "rgba(255,255,255,0.8)", borderRightColor: "rgba(173,81,69,0.12)", borderBottomColor: "rgba(173,81,69,0.18)" },
});
