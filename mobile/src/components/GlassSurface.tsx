import type { RefObject } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { BlurView } from "expo-blur";
import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from "expo-glass-effect";
import { LinearGradient } from "expo-linear-gradient";
import { useAccessibleEffects } from "../design/use-effects";
import { useColorTheme } from "../theme";

/** Decoration only: screen content is the Android blur target, never this overlay. */
export function GlassSurface({ target, radius = 26, tone = "warm" }: { target?: RefObject<View | null>; radius?: number; tone?: "warm" | "cool" }) {
  const { reducedTransparency } = useAccessibleEffects();
  const { colors, dark } = useColorTheme();
  const supported = Platform.OS === "ios" || (Platform.OS === "android" && Number(Platform.Version) >= 31 && target);
  if (reducedTransparency || !supported) {
    return <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: tone === "cool" ? dark ? "#30384A" : "#F1F4FB" : colors.card, borderRadius: radius }]} />;
  }
  if (Platform.OS === "ios" && isGlassEffectAPIAvailable() && isLiquidGlassAvailable()) {
    return <GlassView pointerEvents="none" glassEffectStyle="regular" colorScheme={dark ? "dark" : "light"} style={[StyleSheet.absoluteFill, { borderRadius: radius }]} />;
  }
  return <View pointerEvents="none" style={StyleSheet.absoluteFill}>
    <BlurView tint={dark ? "dark" : "light"} intensity={55} blurMethod="dimezisBlurViewSdk31Plus" blurTarget={target} style={StyleSheet.absoluteFill} />
    <LinearGradient
      colors={tone === "cool" ? dark ? ["#38445BD9", "#30384A85", "#54446B55"] : ["#FFFFFFB8", "#FFFFFF70", "#DCE5FA55"] : dark
        ? ["rgba(53,43,37,0.72)", "rgba(43,35,31,0.38)", "rgba(224,135,118,0.10)"]
        : ["rgba(255,255,255,0.64)", "rgba(255,253,249,0.30)", "rgba(239,185,168,0.22)"]}
      locations={[0, 0.48, 1]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={StyleSheet.absoluteFill}
    />
    <View style={[StyleSheet.absoluteFill, styles.rim, { borderRadius: radius }, dark ? styles.rimDark : styles.rimLight]} />
  </View>;
}

const styles = StyleSheet.create({
  rim: { borderWidth: 1 },
  rimLight: { borderTopColor: "rgba(255,255,255,0.95)", borderLeftColor: "rgba(255,255,255,0.8)", borderRightColor: "rgba(173,81,69,0.12)", borderBottomColor: "rgba(173,81,69,0.18)" },
  rimDark: { borderTopColor: "rgba(255,255,255,0.16)", borderLeftColor: "rgba(255,255,255,0.10)", borderRightColor: "rgba(224,135,118,0.10)", borderBottomColor: "rgba(0,0,0,0.35)" },
});
