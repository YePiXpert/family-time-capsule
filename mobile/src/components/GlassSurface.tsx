import type { RefObject } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { BlurView } from "expo-blur";
import { useAccessibleEffects } from "../design/use-effects";
import { colors } from "../theme";

/** Decoration only: screen content is the Android blur target, never this overlay. */
export function GlassSurface({ target }: { target?: RefObject<View | null> }) {
  const { reducedTransparency } = useAccessibleEffects();
  const supported = Platform.OS === "ios" || (Platform.OS === "android" && Number(Platform.Version) >= 31 && target);
  if (reducedTransparency || !supported) return <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: colors.card }]} />;
  return <View pointerEvents="none" style={StyleSheet.absoluteFill}>
    <BlurView tint="light" intensity={45} blurMethod="dimezisBlurViewSdk31Plus" blurTarget={target} style={StyleSheet.absoluteFill} />
    <View style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(255,253,249,0.82)" }]} />
  </View>;
}
