import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "../theme";
import type { LocalTimelineEvent } from "../types";
import { dateLabel } from "../utils/format";

export function TimelineCard({
  item,
  onPress,
  timeZone,
}: {
  item: LocalTimelineEvent;
  onPress: () => void;
  timeZone?: string;
}) {
  const age = item.ageLabel;
  return (
    <Pressable
      accessibilityHint={item.source === "server" ? "打开记忆详情" : "查看本机同步状态"}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      {item.localCoverUri ? (
        <Image source={{ uri: item.localCoverUri }} style={styles.cover} />
      ) : (
        <View style={styles.placeholder}>
          <Text style={styles.placeholderText}>
            {item.assetCount > 0 ? `${item.assetCount} 份素材` : "一段回忆"}
          </Text>
        </View>
      )}
      <View style={styles.body}>
        {item.source === "local" ? (
          <Text style={styles.localBadge}>
            {item.syncState === "synced" ? "原件在本机 · 已送达收件箱" : "原件在本机 · 等待同步"}
          </Text>
        ) : null}
        <Text style={styles.date}>{dateLabel(item.occurredAt, timeZone)}</Text>
        <Text numberOfLines={2} style={styles.title}>{item.title}</Text>
        <View style={styles.meta}>
          {age ? <Text style={styles.age}>{age}</Text> : null}
          {item.participantNames.length > 0 ? (
            <Text numberOfLines={1} style={styles.people}>
              {item.participantNames.join(" · ")}
            </Text>
          ) : null}
        </View>
        {item.locationText ? <Text style={styles.location}>{item.locationText}</Text> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    overflow: "hidden",
    backgroundColor: colors.card,
    borderColor: colors.line,
    borderRadius: 19,
    borderWidth: 1,
  },
  pressed: { opacity: 0.72 },
  cover: { width: "100%", height: 210, backgroundColor: colors.softCoral },
  placeholder: { height: 92, alignItems: "center", justifyContent: "center", backgroundColor: colors.softCoral },
  placeholderText: { color: colors.coralDark, fontSize: 13, fontWeight: "700" },
  body: { padding: 15, gap: 6 },
  localBadge: { color: colors.sage, fontSize: 11, fontWeight: "800" },
  date: { color: colors.coral, fontSize: 12, fontWeight: "800" },
  title: { color: colors.ink, fontSize: 20, lineHeight: 27, fontWeight: "800" },
  meta: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 2 },
  age: { color: colors.sage, backgroundColor: colors.softSage, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4, fontSize: 11, fontWeight: "800" },
  people: { flex: 1, color: colors.muted, fontSize: 12 },
  location: { color: colors.muted, fontSize: 12 },
});
