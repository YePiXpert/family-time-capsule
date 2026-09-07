import { useState } from "react";
import { useNavigation } from "@react-navigation/native";
import {
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  View,
} from "react-native";
import { useApp } from "../state/AppContext";
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
  const inboxCount = home?.inbox.count ?? 0;
  const canReviewInbox = viewer?.canReviewInbox ?? false;
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
          {canReviewInbox && credentials ? (
            <Pressable
              onPress={() => navigation.navigate("Inbox")}
              style={sharedStyles.secondaryButton}
            >
              <Text style={sharedStyles.secondaryText}>
                待整理{inboxCount > 0 ? ` · ${inboxCount > 99 ? "99+" : inboxCount} 条素材等确认` : " · 收件箱已经整理完"}
              </Text>
            </Pressable>
          ) : null}
          <Pressable accessibilityRole="button" onPress={() => navigation.navigate("AssetLibrary")} style={sharedStyles.secondaryButton}><Text style={sharedStyles.secondaryText}>资料 · 所有照片、声音与文档</Text></Pressable>
          <Pressable
            onPress={() => navigation.navigate("Collections")}
            style={sharedStyles.secondaryButton}
          >
            <Text style={sharedStyles.secondaryText}>相册与章节</Text>
          </Pressable>
          {viewer?.canEditEvents ? (
            <Pressable
              onPress={() => setSelecting(!selecting)}
              style={sharedStyles.secondaryButton}
            >
              <Text style={sharedStyles.secondaryText}>
                {selecting ? "退出多选" : "多选记忆加入相册"}
              </Text>
            </Pressable>
          ) : null}
          {selecting ? (
            <Pressable
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
          <Pressable
            onPress={() => navigation.navigate("Calendar")}
            style={sharedStyles.secondaryButton}
          >
            <Text style={sharedStyles.secondaryText}>日历 · 按年龄找记忆</Text>
          </Pressable>
          {outbox.length > 0 ? (
            <View style={sharedStyles.warning}>
              <Text style={sharedStyles.warningText}>
                {outbox.length} 份记录安全留在本机，
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
