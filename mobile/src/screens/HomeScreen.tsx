import { useNavigation } from "@react-navigation/native";
import { Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useApp } from "../state/AppContext";
import type { AppNavigation } from "../navigation/types";
import { colors, sharedStyles } from "../theme";
import { dateLabel } from "../utils/format";
import { HOME_CAPTURE_ACTIONS } from "../navigation/intents";

export function HomeScreen() {
  const navigation = useNavigation<AppNavigation>();
  const { credentials, family, home, events, outbox, syncing, runSync } = useApp();
  const recent = home?.recentMemories ?? events.filter((event) => event.source === "server").slice(0, 4).map((event) => ({
    id: event.id,
    title: event.title,
    occurredAt: event.occurredAt,
    ageLabel: null,
    coverPath: null,
  }));
  const mediaSource = (path: string | null) =>
    path && credentials
      ? { uri: `${credentials.serverUrl}${path}`, headers: { authorization: `Bearer ${credentials.token}` } }
      : null;

  return (
    <ScrollView
      contentContainerStyle={sharedStyles.content}
      refreshControl={<RefreshControl refreshing={syncing} onRefresh={() => void runSync()} tintColor={colors.coral} />}
      style={sharedStyles.screen}
    >
      <View style={styles.hero}>
        {home?.child ? (
          mediaSource(home.child.avatarPath) ? <Image source={mediaSource(home.child.avatarPath)!} style={styles.avatar} /> : <View style={styles.avatarPlaceholder}><Text style={styles.avatarText}>{home.child.displayName.slice(0, 1)}</Text></View>
        ) : null}
        <View style={styles.heroCopy}>
          <Text style={sharedStyles.eyebrow}>今天的家庭档案</Text>
          <Text style={sharedStyles.title}>{home?.family.name ?? family?.name ?? "家庭时间胶囊"}</Text>
          <Text style={sharedStyles.intro}>{home?.child ? `${home.child.displayName}${home.child.currentAgeLabel ? ` · ${home.child.currentAgeLabel}` : ""}` : "每一份原件先安全留在本机"}</Text>
        </View>
      </View>

      <View style={styles.quickRow}>
        {HOME_CAPTURE_ACTIONS.map(({ label, hint, intent }) => (
          <Pressable accessibilityRole="button" testID={`home-capture-${intent}`} key={intent} onPress={() => navigation.navigate("Capture", { intent, requestKey: Date.now() })} style={({ pressed }) => [styles.quick, pressed && sharedStyles.pressed]}>
            <Text style={styles.quickLabel}>{label}</Text><Text style={styles.quickHint}>{hint}</Text>
          </Pressable>
        ))}
      </View>

      {!credentials ? (
        <Pressable testID="home-settings" onPress={() => navigation.navigate("Settings")} style={sharedStyles.notice}>
          <Text style={sharedStyles.noticeText}>当前仅保存在本机。点此连接自己的家庭服务器；已有本机记录不会被清空。</Text>
        </Pressable>
      ) : null}

      <Pressable testID="home-weekly-review" onPress={() => navigation.navigate("WeeklyReview")} style={({ pressed }) => [styles.reviewCard, pressed && sharedStyles.pressed]}>
        <Text style={sharedStyles.eyebrow}>每周回顾</Text>
        <Text style={sharedStyles.cardTitle}>本周已留下 {home?.weeklyReview.confirmedCount ?? 0} 段</Text>
        <Text style={sharedStyles.body}>还有 {home?.weeklyReview.pendingInboxCount ?? (home?.inbox.count ?? outbox.length)} 条待整理{home?.weeklyReview.storyId ? " · 周记草稿已生成" : ""}</Text>
        <Text style={styles.link}>{home?.weeklyReview.status === "open" ? "开始" : "继续"}每周回顾 →</Text>
      </Pressable>

      <Pressable onPress={() => navigation.navigate("Inbox")} style={({ pressed }) => [sharedStyles.card, pressed && sharedStyles.pressed]}>
        <View style={styles.sectionRow}><Text style={sharedStyles.cardTitle}>待整理收件箱</Text><Text style={styles.count}>{home?.inbox.count ?? outbox.length}</Text></View>
        {(home?.inbox.previews ?? []).slice(0, 3).map((item) => (
          <View key={item.id} style={styles.previewRow}>
            {mediaSource(item.mediaPath) ? <Image source={mediaSource(item.mediaPath)!} style={styles.preview} /> : <View style={styles.previewPlaceholder} />}
            <View style={styles.grow}><Text numberOfLines={1} style={styles.itemTitle}>{item.title}</Text><Text style={styles.meta}>{item.status === "needs_review" ? "待校时" : "待确认"}</Text></View>
          </View>
        ))}
        {(home?.inbox.count ?? outbox.length) === 0 ? <Text style={sharedStyles.body}>这里已经整理完了。记录的新素材会先来到这里。</Text> : <Text style={styles.link}>去修改、合并或确认 →</Text>}
      </Pressable>

      <Pressable accessibilityRole="button" style={sharedStyles.card} onPress={()=>navigation.navigate("BookReview")}><Text style={sharedStyles.cardTitle}>本月回顾</Text><Text style={sharedStyles.body}>{home?.monthlyReview ? `${home.monthlyReview.count} 段记忆，挑出想装进年册的时刻` : "查看月度与年度作品素材"}</Text></Pressable>
      {(home?.activeBooks??[]).length ? <View style={sharedStyles.card}><Text style={sharedStyles.cardTitle}>正在制作的作品</Text>{home!.activeBooks!.map(book=><Pressable key={book.id} accessibilityRole="button" style={sharedStyles.secondaryButton} onPress={()=>navigation.navigate("BookDetail",{id:book.id})}><Text style={sharedStyles.secondaryText}>{book.title}</Text></Pressable>)}</View> : null}
      <View style={styles.sectionRow}><Text style={sharedStyles.cardTitle}>最近记忆</Text><Pressable onPress={() => navigation.navigate("Timeline")}><Text style={styles.link}>查看时间轴</Text></Pressable></View>
      {recent.length === 0 ? (
        <Pressable onPress={() => navigation.navigate("Capture", { intent: "text", requestKey: Date.now() })} style={sharedStyles.card}><Text style={sharedStyles.cardTitle}>从第一条记忆开始</Text><Text style={sharedStyles.body}>写一句话、拍一张照片或录下一段声音。</Text></Pressable>
      ) : recent.slice(0, 4).map((memory) => (
        <Pressable key={memory.id} onPress={() => navigation.navigate("Memory", { id: memory.id })} style={({ pressed }) => [styles.memoryRow, pressed && sharedStyles.pressed]}>
          {mediaSource(memory.coverPath) ? <Image source={mediaSource(memory.coverPath)!} style={styles.memoryCover} /> : <View style={styles.memoryCoverPlaceholder} />}
          <View style={styles.grow}><Text style={styles.itemTitle}>{memory.title}</Text><Text style={styles.meta}>{dateLabel(memory.occurredAt, home?.family.timezone ?? family?.timezone)}{memory.ageLabel ? ` · ${memory.ageLabel}` : ""}</Text></View>
        </Pressable>
      ))}

      <Pressable onPress={() => home?.onThisDay[0] ? navigation.navigate("Memory", { id: home.onThisDay[0].id }) : navigation.navigate("Timeline")} style={sharedStyles.card}>
        <Text style={sharedStyles.cardTitle}>这一天</Text>
        <Text style={sharedStyles.body}>{home?.onThisDay[0]?.title ?? "还没有往年同日记忆，去时间轴看看已经保存的日子。"}</Text>
      </Pressable>

      <Pressable onPress={() => home?.story ? navigation.navigate("StoryDetail", { id: home.story.id }) : navigation.navigate("Stories")} style={sharedStyles.card}>
        <Text style={sharedStyles.cardTitle}>最近故事</Text><Text style={sharedStyles.body}>{home?.story?.title ?? "把一段时间里的记忆串成故事。"}</Text><Text style={styles.link}>原生打开 →</Text>
      </Pressable>
      <Pressable onPress={() => home?.capsule ? navigation.navigate("CapsuleDetail", { id: home.capsule.id }) : navigation.navigate("Capsules")} style={sharedStyles.card}>
        <Text style={sharedStyles.cardTitle}>时间胶囊</Text><Text style={sharedStyles.body}>{home?.capsule?.title ?? "没有即将开启的胶囊，随时可以封存一段心意。"}</Text><Text style={styles.link}>原生打开 →</Text>
      </Pressable>
      <Pressable onPress={() => navigation.navigate("Requests")} style={sharedStyles.card}>
        <Text style={sharedStyles.cardTitle}>问问家人</Text><Text style={sharedStyles.body}>{home?.prompt.text ?? "今天最想替孩子记住什么？"}</Text><Text style={styles.link}>原生打开 →</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  hero: { flexDirection: "row", alignItems: "center", gap: 13 },
  heroCopy: { flex: 1, gap: 3 },
  avatar: { width: 62, height: 62, borderRadius: 31, backgroundColor: colors.softCoral },
  avatarPlaceholder: { width: 62, height: 62, borderRadius: 31, alignItems: "center", justifyContent: "center", backgroundColor: colors.softCoral },
  avatarText: { color: colors.coralDark, fontSize: 24, fontWeight: "800" },
  quickRow: { flexDirection: "row", gap: 8 },
  quick: { flex: 1, minHeight: 64, borderRadius: 14, backgroundColor: colors.card, borderColor: colors.line, borderWidth: 1, alignItems: "center", justifyContent: "center", gap: 3 },
  quickLabel: { color: colors.coralDark, fontSize: 14, fontWeight: "800" },
  quickHint: { color: colors.muted, fontSize: 10 },
  reviewCard: { backgroundColor: colors.softSage, borderColor: "#BED3C6", borderWidth: 1, borderRadius: 18, padding: 16, gap: 7 },
  sectionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  count: { overflow: "hidden", minWidth: 28, textAlign: "center", color: "#FFFFFF", backgroundColor: colors.coral, borderRadius: 14, paddingHorizontal: 8, paddingVertical: 4, fontWeight: "800" },
  previewRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  preview: { width: 48, height: 48, borderRadius: 10, backgroundColor: colors.softCoral },
  previewPlaceholder: { width: 48, height: 48, borderRadius: 10, backgroundColor: colors.softCoral },
  memoryRow: { minHeight: 72, flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.card, borderColor: colors.line, borderWidth: 1, borderRadius: 15, padding: 10 },
  memoryCover: { width: 64, height: 64, borderRadius: 10, backgroundColor: colors.softCoral },
  memoryCoverPlaceholder: { width: 64, height: 64, borderRadius: 10, backgroundColor: colors.softCoral },
  grow: { flex: 1, gap: 4 },
  itemTitle: { color: colors.ink, fontSize: 15, lineHeight: 20, fontWeight: "700" },
  meta: { color: colors.muted, fontSize: 12 },
  link: { color: colors.coralDark, fontSize: 13, fontWeight: "700" },
});
