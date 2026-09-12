import type { ReactNode } from "react";
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { journalFont, journalType } from "../design/tokens";
import { useColorTheme } from "../theme";
import { Text } from "./typography";

/** A static reading title: scroll position never changes its size or opacity. */
export function CollapsingHero({ title, eyebrow, subtitle, pill, accessory, style, testID }: {
  title: string;
  eyebrow?: string;
  subtitle?: string;
  pill?: ReactNode;
  accessory?: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const { colors } = useColorTheme();
  return (
    <View style={[styles.hero, { borderBottomColor: colors.line }, style]} testID={testID}>
      <View style={styles.heroText}>
        {eyebrow ? <Text style={[styles.eyebrow, { color: colors.coral }]}>{eyebrow}</Text> : null}
        <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>{title}</Text>
        {subtitle ? <Text style={[styles.subtitle, { color: colors.muted }]}>{subtitle}</Text> : null}
        {pill ? <View style={styles.pillSlot}>{pill}</View> : null}
      </View>
      {accessory}
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { flexDirection: "row", alignItems: "center", gap: 16, paddingTop: 8, paddingBottom: 24, borderBottomWidth: StyleSheet.hairlineWidth },
  heroText: { flex: 1, gap: 10 },
  eyebrow: { fontSize: 12, fontWeight: "500", letterSpacing: 1.6 },
  title: { fontSize: journalType.largeTitle, fontFamily: Platform.OS === "ios" ? journalFont.editorialIOS : journalFont.editorialAndroid, fontWeight: "400" },
  subtitle: { fontSize: 15 },
  pillSlot: { marginTop: 10 },
});
