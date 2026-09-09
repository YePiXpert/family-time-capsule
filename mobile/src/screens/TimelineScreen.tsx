import { growthStages, eventGrowthStage } from "../design/growth-stages";
import { calendarDate } from "../utils/calendar";
import { growthHeading } from "../design/growth";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePendingImports } from "./PendingScreen";
import { Text } from "../components/typography";
import { useState } from "react";
import { useNavigation } from "@react-navigation/native";
import { FlatList, Pressable, RefreshControl, ScrollView, View } from "react-native";
import { useApp } from "../state/AppContext";
import { Disclosure } from "../components/Disclosure";
import { TimelineCard } from "../components/TimelineCard";
import type { AppNavigation } from "../navigation/types";
import { colors, sharedStyles } from "../theme";

export function TimelineScreen() {
  const [stageKey, setStageKey] = useState("");
  const [important, setImportant] = useState(false);
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
  const child = people?.find(p => p.id === growth.childId);
  const timezone = family?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const stages = growthStages(child?.birthDate ?? null, new Date(), timezone);
  const stage = stages.find(s => s.key === stageKey);
  const belongsToChild = (event: typeof events[number]) => event.childPersonId ? event.childPersonId === growth.childId : event.participantIds?.length ? event.participantIds.includes(growth.childId ?? "") : (people ?? []).filter(p => p.isChild).length === 1 && event.participantNames.length === 0;
  const visibleEvents = events.filter(event => {
    if (important && !event.milestoneType) return false;
    if (!stage) return true;
    if (!belongsToChild(event)) return false;
    if (!["exact", "approximate", "date_only"].includes(event.occurredAtPrecision)) return false;
    try { const day = calendarDate(new Date(event.occurredAt), timezone); return day >= stage.from && day < stage.before; } catch { return false; }
  });
  const groupLabel = (event: typeof events[number]) => stage?.label ?? (child?.birthDate && belongsToChild(event) ? eventGrowthStage(child.birthDate, event.occurredAt, event.occurredAtPrecision, timezone)?.label : null) ?? (event.occurredAtPrecision === "unknown" ? "时间待补充" : "成长点滴");
  const inboxCount = (viewer?.canReviewInbox ? home?.inbox.count ?? 0 : 0) + imports.length;
  return (
    <FlatList
      contentContainerStyle={{ padding: 20, paddingTop: insets.top + 24, paddingBottom: 180, gap: 18, ...(events.length === 0 ? { flexGrow: 1 } : {}) }}
      data={visibleEvents}
      keyExtractor={(item) => item.id}
      ListEmptyComponent={
        <View style={sharedStyles.empty}>
          <Text style={sharedStyles.emptyTitle}>{stage || important ? "这里还没有记录" : "第一篇成长记，从今天开始"}</Text>
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
          {stages.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} accessibilityLabel="按月龄回看">
            {[{ key: "", label: "全部" }, ...stages].map(item => <Pressable key={item.key} accessibilityRole="tab" accessibilityState={{ selected: (stage?.key ?? "") === item.key }} onPress={() => { setStageKey(item.key); setSelected([]); }} style={(stage?.key ?? "") === item.key ? sharedStyles.primaryButton : sharedStyles.secondaryButton}><Text style={(stage?.key ?? "") === item.key ? sharedStyles.primaryText : sharedStyles.secondaryText}>{item.label}</Text></Pressable>)}
          </ScrollView> : <Pressable accessibilityRole="button" onPress={() => navigation.navigate("People")} style={sharedStyles.secondaryButton}><Text style={sharedStyles.secondaryText}>填写宝宝生日，按月龄回看</Text></Pressable>}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            <Pressable accessibilityRole="button" accessibilityState={{ selected: important }} onPress={() => setImportant(v => !v)} style={sharedStyles.secondaryButton}><Text style={sharedStyles.secondaryText}>{important ? "查看所有时刻" : "第一次与值得记住"}</Text></Pressable>
            <Pressable accessibilityRole="button" onPress={() => navigation.navigate("Works")} style={sharedStyles.secondaryButton}><Text style={sharedStyles.secondaryText}>看看成长册</Text></Pressable>
          </View>
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
      renderItem={({ item, index }) => (
        <View>
          {index === 0 || groupLabel(visibleEvents[index - 1]!) !== groupLabel(item) ? <Text accessibilityRole="header" style={[sharedStyles.cardTitle, { marginBottom: 12 }]}>{groupLabel(item)}</Text> : null}
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
