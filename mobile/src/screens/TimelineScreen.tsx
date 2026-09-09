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
  } = useApp();
  // 收件箱不再是主导航(M1):「记忆」页头部保留整理入口,数量来自最近一次同步。
  const imports = usePendingImports();
  const inboxCount = (viewer?.canReviewInbox ? home?.inbox.count ?? 0 : 0) + imports.length;
  return (
    <FlatList
      contentContainerStyle={
        events.length === 0
          ? { flexGrow: 1 }
          : { padding: 15, paddingBottom: 36, gap: 13 }
      }
      data={events}
      keyExtractor={(item) => item.id}
      ListEmptyComponent={
        <View style={sharedStyles.empty}>
          <Text style={sharedStyles.emptyTitle}>本机还没有回忆</Text>
          <Text style={sharedStyles.emptyText}>
            先去“记录”写下一刻；连接服务器后，这里也会保留可离线浏览的家庭时间轴。
          </Text>
        </View>
      }
      ListHeaderComponent={
        <View style={{ gap: 12, padding: 8 }}>
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
                  : navigation.navigate("LocalCapture", { captureId: item.id })
            }
          />
        </View>
      )}
      style={sharedStyles.screen}
    />
  );
}
