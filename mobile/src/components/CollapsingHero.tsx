import { useMemo, useState, type ReactNode } from "react";
import { Animated, Platform, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { journalFont, journalSpace, journalType } from "../design/tokens";
import { useColorTheme } from "../theme";
import { GlassSurface } from "./GlassSurface";
import { Text } from "./typography";

/**
 * 大标题折叠头部（M2）：标签页隐藏原生导航栏，自己画大标题；
 * 滚动超过阈值后淡入一条紧凑的玻璃顶栏。参考实现见 TimelineScreen。
 */

export const HERO_COLLAPSE_THRESHOLD = 64;

/** Native events must be bound to Animated.FlatList / Animated.ScrollView. */
export function useCollapsingHeroScroll(threshold = HERO_COLLAPSE_THRESHOLD) {
  const [scrollY] = useState(() => new Animated.Value(0));
  const onScroll = useMemo(
    () => Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true }),
    [scrollY],
  );
  return { scrollY, onScroll, threshold };
}

export type CollapsingHeroProps = {
  title: string;
  eyebrow?: string;
  subtitle?: string;
  /** 标题下方的小胶囊（如月龄 Pill）。 */
  pill?: ReactNode;
  /** 标题右侧的装饰（如插画），随标题一起淡出。 */
  accessory?: ReactNode;
  scrollY: Animated.Value;
  threshold?: number;
  style?: StyleProp<ViewStyle>;
};

/** 放进 ListHeaderComponent 顶部的大标题区：滚动时向上淡出。 */
export function CollapsingHero({ title, eyebrow, subtitle, pill, accessory, scrollY, threshold = HERO_COLLAPSE_THRESHOLD, style }: CollapsingHeroProps) {
  const { colors } = useColorTheme();
  const fade = scrollY.interpolate({ inputRange: [0, threshold], outputRange: [1, 0], extrapolate: "clamp" });
  const lift = scrollY.interpolate({ inputRange: [0, threshold], outputRange: [0, -14], extrapolate: "clamp" });
  return (
    <Animated.View style={[styles.hero, { borderBottomColor: colors.line }, style, { opacity: fade, transform: [{ translateY: lift }] }]}>
      <View style={styles.heroText}>
        {eyebrow ? <Text style={[styles.eyebrow, { color: colors.coral }]}>{eyebrow}</Text> : null}
        <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>{title}</Text>
        {subtitle ? <Text style={[styles.subtitle, { color: colors.muted }]}>{subtitle}</Text> : null}
        {pill ? <View style={styles.pillSlot}>{pill}</View> : null}
      </View>
      {accessory}
    </Animated.View>
  );
}

export type CollapsingHeroBarProps = {
  title: string;
  scrollY: Animated.Value;
  topInset: number;
  threshold?: number;
  /** 顶栏右侧动作（左侧留给返回按钮时自行传入）。 */
  right?: ReactNode;
  style?: StyleProp<ViewStyle>;
};

/**
 * 紧凑玻璃顶栏：作为列表兄弟节点绝对定位在屏幕顶部，
 * 滚动超过阈值后淡入。容器不拦截触摸，只有 right 等子节点可点。
 */
export function CollapsingHeroBar({ title, scrollY, topInset, threshold = HERO_COLLAPSE_THRESHOLD, right, style }: CollapsingHeroBarProps) {
  const { colors } = useColorTheme();
  const opacity = scrollY.interpolate({ inputRange: [0, threshold, threshold * 1.6], outputRange: [0, 0, 1], extrapolate: "clamp" });
  const settle = scrollY.interpolate({ inputRange: [0, threshold], outputRange: [-8, 0], extrapolate: "clamp" });
  return (
    <Animated.View pointerEvents="none" style={[styles.barWrap, { paddingTop: topInset, opacity, transform: [{ translateY: settle }] }, style]}>
      <GlassSurface tier="dock" radius={0} />
      <View style={styles.barContent}>
        <Text numberOfLines={1} style={[styles.barTitle, { color: colors.ink }]}>{title}</Text>
        {right ? <View pointerEvents="box-none" style={styles.barRight}>{right}</View> : null}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  hero: { flexDirection: "row", alignItems: "center", gap: 16, paddingTop: 8, paddingBottom: 24, borderBottomWidth: StyleSheet.hairlineWidth },
  heroText: { flex: 1, gap: 10 },
  eyebrow: { fontSize: 12, fontWeight: "500", letterSpacing: 1.6 },
  title: { fontSize: journalType.largeTitle, fontFamily: Platform.OS === "ios" ? journalFont.editorialIOS : journalFont.editorialAndroid, fontWeight: "400" },
  subtitle: { fontSize: 15 },
  pillSlot: { marginTop: 10 },
  barWrap: { position: "absolute", top: 0, left: 0, right: 0, overflow: "hidden" },
  barContent: { height: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", paddingHorizontal: journalSpace.page },
  barTitle: { fontSize: journalType.label + 3, fontWeight: "700" },
  barRight: { position: "absolute", right: journalSpace.page, top: 0, bottom: 0, justifyContent: "center" },
});
