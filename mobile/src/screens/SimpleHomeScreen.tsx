import { useNavigation } from "@react-navigation/native";
import { Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useApp } from "../state/AppContext";
import type { AppNavigation } from "../navigation/types";
import { colors } from "../theme";
import { dateLabel } from "../utils/format";

/**
 * 大字简洁显示（长辈阅读）首页：只保留日常四件事——
 * 最近的照片、最近的故事、听听家人的声音、我也说几句。
 * 数据全部来自真实缓存/同步；空状态如实说明，不造示例内容。
 * 复杂入口（收件箱、导入会话、投递箱、诊断术语）不在简洁视图露出。
 */
export function SimpleHomeScreen() {
  const navigation = useNavigation<AppNavigation>();
  const { credentials, family, home, events, syncing, runSync } = useApp();
  const canCapture = home?.capabilities.canCapture ?? true;
  const recent = home?.recentMemories ?? events.filter((event) => event.source === "server").slice(0, 6).map((event) => ({
    id: event.id,
    title: event.title,
    occurredAt: event.occurredAt,
    ageLabel: null,
    coverPath: event.localCoverUri ?? null,
  }));
  const photos = recent.filter((memory) => memory.coverPath);
  const voices = home?.voices ?? [];
  const mediaSource = (path: string | null) =>
    path && credentials
      ? { uri: `${credentials.serverUrl}${path}`, headers: { authorization: `Bearer ${credentials.token}` } }
      : null;

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={syncing} onRefresh={() => void runSync()} tintColor={colors.coral} />}
      style={styles.screen}
    >
      <View>
        <Text style={styles.eyebrow}>家庭时间胶囊</Text>
        <Text style={styles.title}>{home?.family.name ?? family?.name ?? "我们一家"}</Text>
        <Text style={styles.date}>{dateLabel(new Date().toISOString(), home?.family.timezone ?? family?.timezone ?? "Asia/Shanghai")}</Text>
      </View>

      {canCapture ? (
        <View style={styles.bigRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="说一段话"
            testID="simple-speak"
            onPress={() => navigation.navigate("Capture", { intent: "audio", requestKey: Date.now() })}
            style={({ pressed }) => [styles.bigPrimary, pressed && { opacity: 0.75 }]}
          >
            <Text style={styles.bigPrimaryText}>说一段话</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="拍张照片"
            testID="simple-photo"
            onPress={() => navigation.navigate("Capture", { intent: "photo", requestKey: Date.now() })}
            style={({ pressed }) => [styles.bigSecondary, pressed && { opacity: 0.75 }]}
          >
            <Text style={styles.bigSecondaryText}>拍张照片</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>你现在以只读方式查看家庭档案；想补充内容时，请联系家里帮你调整。</Text>
        </View>
      )}

      <Text style={styles.sectionTitle}>最近的照片</Text>
      {photos.length === 0 ? (
        <View style={styles.card}><Text style={styles.emptyText}>这里还没有最近的照片。</Text></View>
      ) : (
        <View style={styles.photoGrid}>
          {photos.slice(0, 6).map((memory) => (
            <Pressable
              key={memory.id}
              accessibilityRole="button"
              accessibilityLabel={`打开照片：${memory.title}`}
              onPress={() => navigation.navigate("Memory", { id: memory.id })}
              style={({ pressed }) => [styles.photoCard, pressed && { opacity: 0.75 }]}
            >
              <Image source={mediaSource(memory.coverPath)!} style={styles.photoCover} />
              <Text numberOfLines={1} style={styles.photoTitle}>{memory.title}</Text>
              <Text style={styles.photoDate}>{dateLabel(memory.occurredAt, home?.family.timezone ?? family?.timezone)}</Text>
            </Pressable>
          ))}
        </View>
      )}
      <Pressable accessibilityRole="button" onPress={() => navigation.navigate("Timeline")} style={styles.moreLink}>
        <Text style={styles.moreLinkText}>看更多照片和回忆 →</Text>
      </Pressable>

      <Text style={styles.sectionTitle}>听听家人的声音</Text>
      {voices.length === 0 ? (
        <View style={styles.card}><Text style={styles.emptyText}>还没有家人的录音；说一段话，以后就能在这里听到。</Text></View>
      ) : voices.map((voice) => (
        <Pressable
          key={voice.id}
          accessibilityRole="button"
          accessibilityLabel={`听${voice.authorName}在「${voice.eventTitle}」里的讲述`}
          onPress={() => navigation.navigate("Memory", { id: voice.memoryEventId })}
          style={({ pressed }) => [styles.card, pressed && { opacity: 0.75 }]}
        >
          <Text style={styles.voiceAuthor}>{voice.authorName} 说了段话</Text>
          <Text numberOfLines={1} style={styles.voiceEvent}>{voice.eventTitle}</Text>
          <Text style={styles.voiceOpen}>点开听一听 →</Text>
        </Pressable>
      ))}

      <Text style={styles.sectionTitle}>最近的故事</Text>
      <Pressable
        accessibilityRole="button"
        onPress={() => home?.story ? navigation.navigate("StoryDetail", { id: home.story.id }) : navigation.navigate("Stories")}
        style={({ pressed }) => [styles.card, pressed && { opacity: 0.75 }]}
      >
        <Text style={styles.cardTitle}>{home?.story?.title ?? "还没有整理好的家庭故事。"}</Text>
        {home?.story ? <Text style={styles.voiceOpen}>打开读一读 →</Text> : null}
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  content: { padding: 20, paddingBottom: 48, gap: 16 },
  eyebrow: { color: colors.coral, fontSize: 15, fontWeight: "800", letterSpacing: 1.2 },
  title: { color: colors.ink, fontSize: 32, lineHeight: 40, fontWeight: "800" },
  date: { color: colors.muted, fontSize: 18, lineHeight: 26 },
  bigRow: { flexDirection: "row", gap: 12 },
  bigPrimary: {
    flex: 1,
    minHeight: 72,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.coral,
    borderRadius: 18,
  },
  bigPrimaryText: { color: "#FFFFFF", fontSize: 21, fontWeight: "800" },
  bigSecondary: {
    flex: 1,
    minHeight: 72,
    alignItems: "center",
    justifyContent: "center",
    borderColor: colors.coral,
    borderWidth: 2,
    borderRadius: 18,
  },
  bigSecondaryText: { color: colors.coralDark, fontSize: 21, fontWeight: "800" },
  sectionTitle: { color: colors.ink, fontSize: 23, lineHeight: 30, fontWeight: "800", marginTop: 8 },
  card: { backgroundColor: colors.card, borderColor: colors.line, borderWidth: 1, borderRadius: 18, padding: 18, gap: 8 },
  cardTitle: { color: colors.ink, fontSize: 20, lineHeight: 28, fontWeight: "800" },
  emptyText: { color: colors.muted, fontSize: 18, lineHeight: 28 },
  photoGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  photoCard: { width: "47%", flexGrow: 1, backgroundColor: colors.card, borderColor: colors.line, borderWidth: 1, borderRadius: 16, padding: 10, gap: 5 },
  photoCover: { width: "100%", height: 120, borderRadius: 12, backgroundColor: colors.softCoral },
  photoTitle: { color: colors.ink, fontSize: 17, fontWeight: "800" },
  photoDate: { color: colors.muted, fontSize: 14 },
  moreLink: { minHeight: 48, justifyContent: "center" },
  moreLinkText: { color: colors.coralDark, fontSize: 17, fontWeight: "800" },
  voiceAuthor: { color: colors.ink, fontSize: 19, fontWeight: "800" },
  voiceEvent: { color: colors.muted, fontSize: 16, lineHeight: 23 },
  voiceOpen: { color: colors.coralDark, fontSize: 16, fontWeight: "800" },
});
