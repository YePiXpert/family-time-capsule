import { growthStages, eventGrowthStage } from "../design/growth-stages";
import { calendarDate } from "../utils/calendar";
import { growthHeading } from "../design/growth";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePendingImports } from "./PendingScreen";
import { Text } from "../components/typography";
import { useState } from "react";
import { useNavigation } from "@react-navigation/native";
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { useApp } from "../state/AppContext";
import { CollapsingHero, CollapsingHeroBar, useCollapsingHeroScroll } from "../components/CollapsingHero";
import { useContextMenu } from "../components/ContextMenu";
import { SwipeActions } from "../components/SwipeActions";
import { TimelineCard } from "../components/TimelineCard";
import { JournalArtwork } from "../components/JournalArtwork";
import { Button, Chip, EmptyState, IconButton, Pill } from "../components/ui";
import { useColorTheme } from "../theme";
import { journalRadius, journalSpace } from "../design/tokens";
import type { AppNavigation } from "../navigation/types";

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
  const { colors } = useColorTheme();
  const { scrollY, onScroll } = useCollapsingHeroScroll();
  const { openMenu, menuElement } = useContextMenu();
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
    <View style={{ flex: 1, backgroundColor: colors.paper }}>
      <FlatList
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={{
          padding: journalSpace.page,
          paddingTop: insets.top + 20,
          paddingBottom: 210,
          gap: 18,
          ...(events.length === 0 ? { flexGrow: 1 } : {}),
        }}
      data={visibleEvents}
      keyExtractor={(item) => item.id}
      ListEmptyComponent={
        <EmptyState
          art={<JournalArtwork kind="keepsake" />}
          title={stage || important ? "这里还没有记录" : "第一篇成长记，从今天开始"}
          body="选一张照片，留下一句想对宝宝说的话。"
          action={<Button title="记录一刻" variant="primary" icon="plus" onPress={() => navigation.navigate("Capture")} full={false} />}
        />
      }
      ListHeaderComponent={
        <View style={{ gap: 20 }}>
          {/* Hero：宝宝是主角——名字、真实月龄、一句话寄语，插画融入右侧 */}
          <CollapsingHero
            eyebrow="一点一滴，慢慢长大"
            title={growth.title}
            subtitle="留下今天，送给长大的你。"
            pill={growth.age ? <Pill label={growth.age} icon="growth" /> : null}
            accessory={<JournalArtwork kind="keepsake" compact />}
            scrollY={scrollY}
          />

          {/* 月龄轨迹：轻量胶囊，内容为主角 */}
          {stages.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 8 }} accessibilityLabel="按月龄回看">
            {[{ key: "", label: "全部" }, ...stages].map(item => <Chip key={item.key} label={item.label} selected={(stage?.key ?? "") === item.key} onPress={() => { setStageKey(item.key); setSelected([]); }} />)}
          </ScrollView> : <Button title="填写宝宝生日，按月龄回看" icon="calendar" onPress={() => navigation.navigate("People")} />}

          {/* 次级工具行：筛选与管理退到一行小控件 */}
          <View style={styles.toolRow}>
            <Chip accessibilityRole="button" icon="star" label={important ? "查看所有时刻" : "第一次与值得记住"} selected={important} onPress={() => setImportant(v => !v)} />
            <View style={{ flex: 1 }} />
            <IconButton icon="search" label="搜索" onPress={() => navigation.navigate("Search")} />
            <IconButton icon="calendar" label="日期与人物" onPress={() => navigation.navigate("Calendar")} />
            {viewer?.canEditEvents ? (
              <IconButton icon="check" label={selecting ? "取消选择" : "选择"} tone={selecting ? "accent" : "plain"} onPress={() => { setSelecting(!selecting); setSelected([]); }} />
            ) : null}
          </View>

          {selecting ? (
            <View style={[styles.selectionCard, { backgroundColor: colors.softCoral, borderColor: colors.peach }]}>
              <Text style={[styles.selectionText, { color: colors.coralDark }]}>已选 {selected.length} 条</Text>
              <View style={styles.selectionActions}>
                <Button title={`将所选 ${selected.length} 条加入相册`} variant="primary" disabled={!selected.length} onPress={() => navigation.navigate("Collections", { eventIds: selected })} full={false} />
              </View>
            </View>
          ) : null}

          {inboxCount > 0 ? (
            <Pressable accessibilityRole="button" onPress={() => navigation.navigate("Pending")} style={[styles.inboxCard, { backgroundColor: colors.card, borderColor: colors.line }]}>
              <Text style={[styles.inboxText, { color: colors.ink }]}>待处理 {inboxCount > 99 ? "99+" : inboxCount} 条</Text>
            </Pressable>
          ) : null}

          {outbox.length > 0 ? (
            <View style={[styles.outboxCard, { backgroundColor: colors.warningSoft }]}>
              <Text style={[styles.outboxText, { color: colors.warning }]}>
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
      renderItem={({ item, index }) => {
        const canOrganize = item.source === "server" && Boolean(viewer?.canEditEvents);
        const enterSelection = () => { setSelecting(true); setSelected([item.id]); };
        const openCardMenu = (event: { nativeEvent: { pageX: number; pageY: number } }) => {
          if (canOrganize) enterSelection();
          openMenu([
            ...(canOrganize ? [
              { key: "collect", label: "加入合集", icon: "image" as const, onPress: () => navigation.navigate("Collections", { eventIds: [item.id] }) },
              { key: "select", label: "选择", icon: "check" as const, onPress: enterSelection },
            ] : []),
            { key: "detail", label: "查看详情", icon: "chevron-right" as const, onPress: () => item.source === "server" ? navigation.navigate("Memory", { id: item.id }) : item.localDraftId ? navigation.navigate("Capture", { localDraftId: item.localDraftId }) : navigation.navigate("LocalCapture", { captureId: item.id }) },
          ], { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY });
        };
        const card = (
          <TimelineCard
            item={item}
            timeZone={item.source === "server" ? family?.timezone : undefined}
            selected={selecting && item.source === "server" ? selected.includes(item.id) : undefined}
            onLongPress={openCardMenu}
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
        );
        return (
          <View>
            {index === 0 || groupLabel(visibleEvents[index - 1]!) !== groupLabel(item) ? (
              <View style={styles.groupHeader}>
                <Text accessibilityRole="header" style={[styles.groupLabel, { color: colors.muted }]}>{groupLabel(item)}</Text>
                <View style={[styles.groupRule, { backgroundColor: colors.line }]} />
              </View>
            ) : null}
            {canOrganize ? (
              <SwipeActions
                actions={[
                  { key: "collect", label: "加入合集", color: colors.sage, onPress: () => navigation.navigate("Collections", { eventIds: [item.id] }) },
                  { key: "select", label: "选择", color: colors.coral, onPress: enterSelection },
                ]}
              >
                {card}
              </SwipeActions>
            ) : card}
          </View>
        );
      }}
        style={{ flex: 1, backgroundColor: colors.paper }}
      />
      <CollapsingHeroBar title="成长" scrollY={scrollY} topInset={insets.top} />
      {menuElement}
    </View>
  );
}

const styles = StyleSheet.create({
  toolRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  selectionCard: {
    borderRadius: journalRadius.card,
    borderWidth: 1,
    padding: 14,
    gap: 10,
  },
  selectionText: { fontSize: 14, fontWeight: "700" },
  selectionActions: { flexDirection: "row" },
  inboxCard: {
    borderRadius: journalRadius.control,
    borderWidth: 1,
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  inboxText: { fontSize: 15, fontWeight: "600" },
  outboxCard: { borderRadius: journalRadius.control, padding: 12 },
  outboxText: { fontSize: 13, lineHeight: 19 },
  groupHeader: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 14, marginTop: 6 },
  groupLabel: { fontSize: 13, fontWeight: "700", letterSpacing: 0.6 },
  groupRule: { flex: 1, height: StyleSheet.hairlineWidth },
});
