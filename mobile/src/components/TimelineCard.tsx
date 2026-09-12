import { memo, useState } from "react";
import { Text } from "./typography";
import { Image, Platform, Pressable, StyleSheet, View } from "react-native";
import { journalFont, journalRadius } from "../design/tokens";
import { useColorTheme } from "../theme";
import { JournalIcon } from "./JournalIcon";
import type { LocalTimelineEvent } from "../types";
import { dateLabel } from "../utils/format";

export const TimelineCard = memo(function TimelineCard({
  item,
  onPress,
  onLongPress,
  timeZone,
  selected,
}: {
  item: LocalTimelineEvent;
  onPress: () => void;
  onLongPress?: (event: { nativeEvent: { pageX: number; pageY: number } }) => void;
  timeZone?: string;
  selected?: boolean;
}) {
  const { colors } = useColorTheme();
  const [failedCover, setFailedCover] = useState<string | null>(null);
  const hasCover = Boolean(item.cover || item.localCoverUri);
  const age = item.ageLabel;
  const milestone = item.milestoneType ? (item.milestoneType === "first_time" ? "第一次" : "值得记住") : null;
  return (
    <Pressable
      testID={`timeline-card-${item.id}`}
      accessibilityHint={item.source === "server" ? "打开记忆详情" : "查看本机同步状态"}
      accessibilityRole="button"
      accessibilityState={selected === undefined ? undefined : { selected }}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: colors.card, borderColor: colors.line },
        pressed && styles.pressed,
      ]}
    >
      {selected ? (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.selectedRing, { borderColor: colors.coral }]} />
      ) : null}
      {hasCover ? (
        <View testID={`timeline-card-media-${item.id}`} style={[styles.cover, { backgroundColor: colors.softCoral }]}>
          {item.localCoverUri && failedCover !== item.localCoverUri ? (
            <Image fadeDuration={0} source={{ uri: item.localCoverUri }} style={StyleSheet.absoluteFill} onError={() => setFailedCover(item.localCoverUri)} />
          ) : (
            <View style={styles.coverStatus}>
              <JournalIcon name="image" color={colors.coral} size={22} />
              <Text style={[styles.placeholderText, { color: colors.coralDark }]}>{failedCover ? "封面暂时无法显示" : "封面待加载"}</Text>
            </View>
          )}
        </View>
      ) : item.assetCount > 0 ? (
        <View style={[styles.placeholder, { backgroundColor: colors.apricot }]}>
          <JournalIcon name="image" color={colors.coral} size={18} />
          <Text style={[styles.placeholderText, { color: colors.coralDark }]}>
            {item.assetCount} 份素材
          </Text>
        </View>
      ) : null}
      {selected ? (
        <View style={[styles.selectedBadge, { backgroundColor: colors.coral }]}>
          <JournalIcon name="check" color={colors.onCoral} size={14} />
        </View>
      ) : null}
      <View style={styles.body}>
        <Text style={[styles.date, { color: colors.muted }]}>{dateLabel(item.occurredAt, timeZone, item.occurredAtPrecision)}</Text>
        <Text numberOfLines={2} style={[styles.title, { color: colors.ink }]}>{item.title}</Text>
        {item.bodyText && item.bodyText !== item.title ? <Text numberOfLines={3} style={[styles.story, { color: colors.ink }]}>{item.bodyText}</Text> : null}
        {milestone ? (
          <View style={styles.milestoneRow}>
            <JournalIcon name="star" color={colors.coral} size={14} />
            <Text style={[styles.date, { color: colors.coral }]}>{milestone}</Text>
          </View>
        ) : null}
        {age || item.participantNames.length > 0 ? <View style={styles.meta}>
          {age ? <Text style={[styles.age, { color: colors.sage, backgroundColor: colors.softSage }]}>{age}</Text> : null}
          {item.participantNames.length > 0 ? (
            <Text numberOfLines={1} style={[styles.people, { color: colors.muted }]}>
              {item.participantNames.join(" · ")}
            </Text>
          ) : null}
        </View> : null}
        {item.locationText ? <Text style={[styles.location, { color: colors.muted }]}>{item.locationText}</Text> : null}
        {item.source === "local" ? (
          <View style={[styles.localStatus, { borderTopColor: colors.line }]}>
            <JournalIcon name="check" color={colors.sage} size={14} />
            <Text style={[styles.localBadge, { color: colors.sage }]}>
              {item.localDraftId ? item.syncState === null ? "已保存" : "已保存在本机" : item.syncState === "inbox" ? "原件在本机 · 已送达收件箱" : "原件在本机 · 等待同步"}
            </Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  card: {
    overflow: "hidden",
    borderRadius: journalRadius.card,
    borderWidth: 1,
  },
  pressed: { opacity: 0.72 },
  selectedRing: { borderWidth: 2, borderRadius: journalRadius.card, zIndex: 1 },
  coverStatus: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8 },
  cover: { width: "100%", aspectRatio: 4 / 3 },
  placeholder: {
    minHeight: 52,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
    gap: 8,
  },
  placeholderText: { fontSize: 13, fontWeight: "700" },
  selectedBadge: {
    position: "absolute",
    top: 12,
    right: 12,
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  body: { padding: 20, gap: 10 },
  localStatus: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
  localBadge: { fontSize: 12, flexShrink: 1 },
  date: { fontSize: 12, fontWeight: "500", letterSpacing: 0.3 },
  story: { fontSize: 16, lineHeight: 26 },
  title: { fontSize: 22, fontFamily: Platform.OS === "ios" ? journalFont.editorialIOS : journalFont.editorialAndroid, fontWeight: "400" },
  milestoneRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  meta: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 2 },
  age: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4, fontSize: 13, fontWeight: "600" },
  people: { flex: 1, fontSize: 13 },
  location: { fontSize: 13 },
});
