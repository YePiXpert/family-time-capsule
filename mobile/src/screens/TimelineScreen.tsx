import { useState } from "react";
import { useNavigation } from "@react-navigation/native";
import {
  Alert,
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
    outbox,
    syncing,
    runSync,
    reloadLocal,
    viewer,
  } = useApp();
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
                  : Alert.alert(
                      "本机记录",
                      item.syncState === "inbox"
                        ? "这份原件已送达收件箱，整理确认后会成为正式记忆。"
                        : "这份原件仍在本机，联网后会继续补传。",
                    )
            }
          />
        </View>
      )}
      style={sharedStyles.screen}
    />
  );
}
