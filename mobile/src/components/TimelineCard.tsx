import { Text } from "./typography";
import { Image, Pressable, StyleSheet, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useColorTheme } from "../theme";
import { JournalIcon } from "./JournalIcon";
import type { LocalTimelineEvent } from "../types";
import { dateLabel } from "../utils/format";

export function TimelineCard({
  item,
  onPress,
  timeZone,
  selected,
}: {
  item: LocalTimelineEvent;
  onPress: () => void;
  timeZone?: string;
  selected?: boolean;
}) {
  const { colors } = useColorTheme();
  const age = item.ageLabel;
  const milestone = item.milestoneType ? (item.milestoneType === "first_time" ? "第一次" : "值得记住") : null;
  return (
    <Pressable
      accessibilityHint={item.source === "server" ? "打开记忆详情" : "查看本机同步状态"}
      accessibilityRole="button"
      accessibilityState={selected === undefined ? undefined : { selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: colors.card, borderColor: selected ? colors.coral : colors.line },
        selected && { borderWidth: 2 },
        pressed && styles.pressed,
      ]}
    >
      {item.localCoverUri ? (
        <Image fadeDuration={0} source={{ uri: item.localCoverUri }} style={[styles.cover, { backgroundColor: colors.softCoral }]} />
      ) : (
        <LinearGradient
          colors={[colors.apricot, colors.softCoral]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.placeholder}
        >
          <JournalIcon name={item.assetCount > 0 ? "image" : milestone ? "star" : "heart"} color={colors.coral} size={22} />
          <Text style={[styles.placeholderText, { color: colors.coralDark }]}>
            {item.assetCount > 0 ? `${item.assetCount} 份素材` : "一段回忆"}
          </Text>
        </LinearGradient>
      )}
      {selected ? (
        <View style={[styles.selectedBadge, { backgroundColor: colors.coral }]}>
          <JournalIcon name="check" color={colors.onCoral} size={14} />
        </View>
      ) : null}
      <View style={styles.body}>
        {item.source === "local" ? (
          <Text style={[styles.localBadge, { color: colors.sage }]}>
            {item.localDraftId ? item.syncState === null ? "已保存" : "已保存在本机" : item.syncState === "inbox" ? "原件在本机 · 已送达收件箱" : "原件在本机 · 等待同步"}
          </Text>
        ) : null}
        <Text style={[styles.date, { color: colors.coral }]}>{dateLabel(item.occurredAt, timeZone, item.occurredAtPrecision)}</Text>
        <Text numberOfLines={2} style={[styles.title, { color: colors.ink }]}>{item.title}</Text>
        {item.bodyText && item.bodyText !== item.title ? <Text numberOfLines={3} style={[styles.story, { color: colors.ink }]}>{item.bodyText}</Text> : null}
        {milestone ? (
          <View style={styles.milestoneRow}>
            <JournalIcon name="star" color={colors.coral} size={14} />
            <Text style={[styles.date, { color: colors.coral }]}>{milestone}</Text>
          </View>
        ) : null}
        <View style={styles.meta}>
          {age ? <Text style={[styles.age, { color: colors.sage, backgroundColor: colors.softSage }]}>{age}</Text> : null}
          {item.participantNames.length > 0 ? (
            <Text numberOfLines={1} style={[styles.people, { color: colors.muted }]}>
              {item.participantNames.join(" · ")}
            </Text>
          ) : null}
        </View>
        {item.locationText ? <Text style={[styles.location, { color: colors.muted }]}>{item.locationText}</Text> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    overflow: "hidden",
    borderRadius: 22,
    borderWidth: 1,
  },
  pressed: { opacity: 0.72 },
  cover: { width: "100%", aspectRatio: 4 / 3 },
  placeholder: {
    height: 76,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
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
  body: { padding: 18, gap: 8 },
  localBadge: { fontSize: 13, fontWeight: "600" },
  date: { fontSize: 13, fontWeight: "600" },
  story: { fontSize: 16, lineHeight: 26 },
  title: { fontSize: 20, fontWeight: "600" },
  milestoneRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  meta: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 2 },
  age: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4, fontSize: 13, fontWeight: "600" },
  people: { flex: 1, fontSize: 13 },
  location: { fontSize: 13 },
});
