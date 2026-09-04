import { useNavigation } from "@react-navigation/native";
import { Alert, FlatList, RefreshControl, Text, View } from "react-native";
import { useApp } from "../state/AppContext";
import { TimelineCard } from "../components/TimelineCard";
import type { AppNavigation } from "../navigation/types";
import { colors, sharedStyles } from "../theme";

export function TimelineScreen() {
  const navigation = useNavigation<AppNavigation>();
  const { credentials, events, family, outbox, syncing, runSync, reloadLocal } = useApp();
  return (
    <FlatList
      contentContainerStyle={events.length === 0 ? { flexGrow: 1 } : { padding: 15, paddingBottom: 36, gap: 13 }}
      data={events}
      keyExtractor={(item) => item.id}
      ListEmptyComponent={<View style={sharedStyles.empty}><Text style={sharedStyles.emptyTitle}>本机还没有回忆</Text><Text style={sharedStyles.emptyText}>先去“记录”写下一刻；连接服务器后，这里也会保留可离线浏览的家庭时间轴。</Text></View>}
      ListHeaderComponent={outbox.length > 0 ? <View style={sharedStyles.warning}><Text style={sharedStyles.warningText}>{outbox.length} 份记录安全留在本机，{credentials ? "联网后会继续补传" : "连接服务器后再补传"}。</Text></View> : null}
      refreshControl={<RefreshControl refreshing={syncing} tintColor={colors.coral} onRefresh={() => void (credentials ? runSync() : reloadLocal())} />}
      renderItem={({ item }) => <TimelineCard item={item} timeZone={item.source === "server" ? family?.timezone : undefined} onPress={() => item.source === "server" ? navigation.navigate("Memory", { id: item.id }) : Alert.alert("本机记录", item.syncState === "inbox" ? "这份原件已送达收件箱，整理确认后会成为正式记忆。" : "这份原件仍在本机，联网后会继续补传。") } />}
      style={sharedStyles.screen}
    />
  );
}
