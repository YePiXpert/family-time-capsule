import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { CollapsingHero } from "./CollapsingHero";
import { Text } from "./typography";
import { useColorTheme } from "../theme";
import { journalSpace, journalType } from "../design/tokens";

/** One reading layout for an owned local record and a permitted family memory. */
export function MemoryReading({ title, date, visibility, body, media, status, children }: {
  title: string;
  date?: string;
  visibility?: string;
  body?: string | null;
  media?: ReactNode;
  status?: string;
  children?: ReactNode;
}) {
  const { colors } = useColorTheme();
  return <View style={styles.reading}>
    {media}
    <CollapsingHero compact variant="record" title={title} eyebrow={date} subtitle={visibility} />
    {body && body !== title ? <Text selectable style={[styles.story, { color: colors.ink }]}>{body}</Text> : null}
    {children}
    {status ? <Text accessibilityLiveRegion="polite" style={[styles.status, { color: colors.muted }]}>{status}</Text> : null}
  </View>;
}

const styles = StyleSheet.create({
  reading: { gap: journalSpace.medium },
  story: { fontSize: journalType.body, lineHeight: 28 },
  status: { fontSize: journalType.caption, lineHeight: 20 },
});
