import { growthHeading } from "../design/growth";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePendingImports } from "./PendingScreen";
import { Text } from "../components/typography";
import { useState } from "react";
import { useNavigation } from "@react-navigation/native";
import { FlatList, Pressable, RefreshControl, View } from "react-native";
import { useApp } from "../state/AppContext";
import { Disclosure } from "../components/Disclosure";
import { TimelineCard } from "../components/TimelineCard";
import type { AppNavigation } from "../navigation/types";
import { colors, sharedStyles } from "../theme";

export function TimelineScreen() {
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const navigation = useNavigation<AppNavigation>();
  const {
    credentials,
    events,
    family,
    home,
    outbox,
    syncing,
    runSync,
    reloadLocal,
    viewer,
    people,
  } = useApp();
  // 收件箱不再是主导航(M1):「记忆」页头部保留整理入口,数量来自最近一次同步。
  const imports = usePendingImports();
  const insets = useSafeAreaInsets();
  const growth = growthHeading(people ?? [], new Date(), family?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
  const inboxCount = (viewer?.canReviewInbox ? home?.inbox.count ?? 0 : 0) + imports.length;
  return (
    <FlatList
      contentContainerStyle={{ padding: 20, paddingTop: insets.top + 24, paddingBottom: 180, gap: 18, ...(events.length === 0 ? { flexGrow: 1 } : {}) }}
      data={events}
      keyExtractor={(item) => item.id}
      ListEmptyComponent={
        <View style={sharedStyles.empty}>
          <Text style={sharedStyles.emptyTitle}>第一篇成长记，从今天开始</Text>
          <Text style={sharedStyles.emptyText}>
            选一张照片，留下一句想对宝宝说的话。
          </Text>
        </View>
      }
      ListHeaderComponent={
        <View style={{ gap: 18 }}>
          <View style={{ paddingTop: 12, paddingBottom: 24, gap: 8 }}>
            <Text style={sharedStyles.eyebrow}>一点一滴，慢慢长大</Text>
            <Text accessibilityRole="header" style={[sharedStyles.title, { fontSize: 32 }]}>{growth.title}</Text>
            <Text style={sharedStyles.body}>留下今天，送给长大的你。</Text>
            {growth.age ? <Text style={{ color: colors.coralDark, backgroundColor: colors.softCoral, alignSelf: "flex-start", borderRadius: 16, paddingHorizontal: 14, paddingVertical: 7, fontSize: 14, marginTop: 8 }}>{growth.age}</Text> : null}
          </View>
          <Text accessibilityRole="header" style={sharedStyles.cardTitle}>成长点滴</Text>
          {inboxCount > 0 ? (
            <Pressable accessibilityRole="button"
              onPress={() => navigation.navigate("Pending")}
              style={sharedStyles.secondaryButton}
            >
              <Text style={sharedStyles.secondaryText}>
                待处理 {inboxCount > 99 ? "99+" : inboxCount} 条
              </Text>
            </Pressable>
          ) : null}
          <View style={{ flexDirection: "row", gap: 12 }}>
            <Pressable accessibilityRole="button" onPress={() => navigation.navigate("Search")} style={[sharedStyles.secondaryButton, { flex: 1 }]}><Text style={sharedStyles.secondaryText}>搜索</Text></Pressable>
            <View style={{ flex: 1 }}><Disclosure title="筛选"><Pressable accessibilityRole="button" onPress={() => navigation.navigate("Calendar")} style={sharedStyles.secondaryButton}><Text style={sharedStyles.secondaryText}>日期与人物</Text></Pressable>          {viewer?.canEditEvents ? (
            <Pressable accessibilityRole="button"
              onPress={() => setSelecting(!selecting)}
              style={sharedStyles.secondaryButton}
            >
              <Text style={sharedStyles.secondaryText}>
                {selecting ? "取消选择" : "选择"}
              </Text>
            </Pressable>
          ) : null}
</Disclosure></View>
          </View>
          {selecting ? (
            <Pressable accessibilityRole="button"
              disabled={!selected.length}
              onPress={() =>
                navigation.navigate("Collections", { eventIds: selected })
              }
              style={sharedStyles.secondaryButton}
            >
              <Text style={sharedStyles.secondaryText}>
                将所选 {selected.length} 条加入相册
              </Text>
            </Pressable>
          ) : null}
          {outbox.length > 0 ? (
            <View>
              <Text style={sharedStyles.warningText}>
                {outbox.length} 份已保存在本机，
                {credentials ? "联网后会继续补传" : "连接服务器后再补传"}。
              </Text>
            </View>
          ) : null}
        </View>
      }
      refreshControl={
        <RefreshControl
          refreshing={syncing}
          tintColor={colors.coral}
          onRefresh={() => void (credentials ? runSync() : reloadLocal())}
        />
      }
      renderItem={({ item }) => (
        <View>
          {selecting && item.source === "server" ? (
            <Text>{selected.includes(item.id) ? "已选择" : "点按选择"}</Text>
          ) : null}
          <TimelineCard
            item={item}
            timeZone={item.source === "server" ? family?.timezone : undefined}
            onPress={() =>
              selecting && item.source === "server"
                ? setSelected((ids) =>
                    ids.includes(item.id)
                      ? ids.filter((id) => id !== item.id)
                      : [...ids, item.id],
                  )
                : item.source === "server"
                  ? navigation.navigate("Memory", { id: item.id })
                  : item.localDraftId ? navigation.navigate("Capture", { localDraftId: item.localDraftId })
                  : navigation.navigate("LocalCapture", { captureId: item.id })
            }
          />
        </View>
      )}
      style={sharedStyles.screen}
    />
  );
}
