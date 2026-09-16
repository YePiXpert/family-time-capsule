import { useJournalContentInset } from "../navigation/dock-metrics";
import { findSavedRecord, timelineRecordKey } from "../navigation/records";
import { draftReadingScope } from "../drafts/reading";
import { useResumableDrafts } from "../drafts/use-resumable-drafts";
import { resumableDraftTitle } from "../drafts/resumable";
import { useResumableMemoryEdits } from "../memories/use-resumable-edits";
import { resumableMemoryEditTitle } from "../memories/resumable-edits";
import { growthStages, eventGrowthStage } from "../design/growth-stages";
import { calendarDate } from "../utils/calendar";
import { onThisDay } from "../utils/on-this-day";
import { indexCalendarMonths } from "../utils/calendar-months";
import { growthHeading } from "../design/growth";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePendingImports } from "./PendingScreen";
import { Text } from "../components/typography";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigation } from "@react-navigation/native";
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { useAppData, useAppActions } from "../state/AppContext";
import { JournalHomeHeader } from "../components/JournalHomeHeader";
import { MonthPicker } from "../components/MonthPicker";
import { useContextMenu } from "../components/ContextMenu";
import { SwipeActions } from "../components/SwipeActions";
import { TimelineCard } from "../components/TimelineCard";
import { JournalArtwork } from "../components/JournalArtwork";
import { JournalIcon } from "../components/JournalIcon";
import { Button, Chip, EmptyState, IconButton } from "../components/ui";
import { useColorTheme } from "../theme";
import { journalRadius, journalSpace } from "../design/tokens";
import type { MaterialRef } from "../collections/local";
import type { LocalTimelineEvent } from "../types";
import type { AppNavigation, MainTabParamList } from "../navigation/types";

export function TimelineScreen({ route }: { route?: { params?: MainTabParamList["Timeline"] } }) {
  const [stageKey, setStageKey] = useState("");
  const [month, setMonth] = useState("");
  const list = useRef<FlatList<LocalTimelineEvent>>(null);
  const previousMonth = useRef(month);
  const [important, setImportant] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const navigation = useNavigation<AppNavigation>();
  const {
    credentials,
    events,
    family,
    home,
    outbox,
    viewer,
    people,
    userId,
  } = useAppData();
  const { runSync, reloadLocal } = useAppActions();
  const draftScope = draftReadingScope(credentials, userId, viewer?.id, family?.id);
  const unfinished = useResumableDrafts(draftScope, !credentials || Boolean(viewer?.canCapture));
  const resume = unfinished?.rows[0];
  const unfinishedEdits = useResumableMemoryEdits(draftScope, Boolean(credentials && viewer?.canEditEvents));
  const resumeEdit = unfinishedEdits?.rows[0];
  const [selectionScope, setSelectionScope] = useState(draftScope);
  if (selectionScope !== draftScope) {
    setSelectionScope(draftScope);
    setSelected([]); setSelecting(false);
  }
  const [savedNotice, setSavedNotice] = useState<NonNullable<MainTabParamList["Timeline"]>["saved"]>();
  const focusRequest = useRef<string | null>(null);
  const scrollRetry = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollAttempts = useRef(0);
  const pendingSave = route?.params?.saved;
  const savedEvent = pendingSave && pendingSave.scope === draftScope ? findSavedRecord(events, pendingSave.draftId) : null;
  if (pendingSave && savedEvent && pendingSave.requestKey !== savedNotice?.requestKey) {
    setSavedNotice(pendingSave);
    setMonth(""); setStageKey(""); setImportant(false); setSelected([]); setSelecting(false); setFiltersOpen(false);
  }
  useEffect(() => {
    if (pendingSave && pendingSave.requestKey === savedNotice?.requestKey) navigation.setParams({ saved: undefined });
  }, [pendingSave, savedNotice?.requestKey, navigation]);
  useEffect(() => () => { if (scrollRetry.current) clearTimeout(scrollRetry.current); }, []);
  const [refreshing, setRefreshing] = useState(false);
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try { await (credentials ? runSync() : reloadLocal()); }
    finally { setRefreshing(false); }
  }, [credentials, runSync, reloadLocal]);
  // 收件箱不再是主导航(M1):「记忆」页头部保留整理入口,数量来自最近一次同步。
  const imports = usePendingImports();
  const insets = useSafeAreaInsets();
  const contentBottom = useJournalContentInset();
  const { colors } = useColorTheme();
  const { openMenu, menuElement } = useContextMenu();
  const growth = growthHeading(people ?? [], new Date(), family?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
  const child = people?.find(p => p.id === growth.childId);
  const childBirthDate = child?.birthDate ?? null;
  const timezone = family?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const today = calendarDate(new Date(), timezone);
  const revisit = useMemo(() => onThisDay(events, today, timezone), [events, today, timezone]);
  const localCount = useMemo(() => events.filter(event => event.source === "local").length, [events]);
  const summary = [growth.age, !credentials ? `本机保存 · ${events.length} 段记录` : localCount ? `${localCount} 段记录保存在本机` : `${events.length} 段回忆`].filter(Boolean).join(" · ");
  const openRecord = (record: LocalTimelineEvent) => record.source === "server"
    ? navigation.navigate("Memory", { id: record.id })
    : record.localDraftId && draftScope ? navigation.navigate("SavedMemory", { draftId: record.localDraftId, scope: draftScope })
      : navigation.navigate("LocalCapture", { captureId: record.id });
  const monthIndex = useMemo(() => indexCalendarMonths(events, timezone), [events, timezone]);
  useEffect(() => {
    if (previousMonth.current === month) return;
    previousMonth.current = month;
    list.current?.scrollToOffset({ offset: 0, animated: false });
  }, [month]);
  const stages = useMemo(() => growthStages(childBirthDate, new Date(today + "T00:00:00Z"), "UTC"), [childBirthDate, today]);
  const stage = stages.find(s => s.key === stageKey);
  const childCount = (people ?? []).filter(person => person.isChild).length;
  const belongsToChild = useCallback((event: LocalTimelineEvent) => event.childPersonId ? event.childPersonId === growth.childId : event.participantIds?.length ? event.participantIds.includes(growth.childId ?? "") : childCount === 1 && event.participantNames.length === 0, [growth.childId, childCount]);
  const visibleEvents = useMemo(() => events.filter(event => {
    if (month && monthIndex.byId.get(event.id) !== month) return false;
    if (important && event.milestoneType !== "first_time") return false;
    if (!stage) return true;
    if (!belongsToChild(event)) return false;
    if (!["exact", "approximate", "date_only"].includes(event.occurredAtPrecision)) return false;
    try { const day = calendarDate(new Date(event.occurredAt), timezone); return day >= stage.from && day < stage.before; } catch { return false; }
  }), [events, month, monthIndex, important, stage, belongsToChild, timezone]);
  const currentNotice = savedNotice?.scope === draftScope ? savedNotice : undefined;
  const noticeEvent = currentNotice ? findSavedRecord(visibleEvents, currentNotice.draftId) : null;
  useEffect(() => {
    if (!currentNotice || !noticeEvent || focusRequest.current === currentNotice.requestKey) return;
    focusRequest.current = currentNotice.requestKey;
    scrollAttempts.current = 0;
    const index = visibleEvents.indexOf(noticeEvent);
    scrollRetry.current = setTimeout(() => list.current?.scrollToIndex({ index, animated: false, viewPosition: 0.1 }), 100);
  }, [currentNotice, noticeEvent, visibleEvents]);
  const groupHeaders = useMemo(() => {
    const labels = visibleEvents.map(event => stage?.label ?? (childBirthDate && belongsToChild(event) ? eventGrowthStage(childBirthDate, event.occurredAt, event.occurredAtPrecision, timezone)?.label : null) ?? (event.occurredAtPrecision === "unknown" ? "时间待补充" : null));
    return labels.map((label, index) => label === labels[index - 1] ? null : label);
  }, [visibleEvents, stage, childBirthDate, belongsToChild, timezone]);
  const selectedRefs: MaterialRef[] = draftScope ? events.filter(event => selected.includes(event.id)).flatMap<MaterialRef>(event => event.source === "server" ? [{ kind: "memory" as const, scope: draftScope, id: event.id }] : event.localDraftId ? [{ kind: "localDraft" as const, scope: draftScope, id: event.localDraftId }] : []) : [];
  const selectedIds = useMemo(() => new Set(selected), [selected]);
  const toggleSelected = useCallback((id: string) => setSelected(ids => ids.includes(id) ? ids.filter(value => value !== id) : ids.length < 100 ? [...ids, id] : ids), []);
  const enterSelection = useCallback((id: string) => { setSelecting(true); setSelected(ids => ids.includes(id) || ids.length >= 100 ? ids : [...ids, id]); }, []);
  const renderItem = useCallback(({ item, index }: { item: LocalTimelineEvent; index: number }) => (
    <TimelineRow item={item} draftScope={draftScope} highlighted={item.localDraftId === currentNotice?.draftId && Boolean(currentNotice)} groupLabel={groupHeaders[index] ?? null} canEdit={Boolean(viewer?.canEditEvents)} timeZone={family?.timezone} selected={selecting && (item.source === "server" || item.localDraftId) ? selectedIds.has(item.id) : undefined} toggleSelected={toggleSelected} enterSelection={enterSelection} openMenu={openMenu} />
  ), [groupHeaders, viewer?.canEditEvents, family?.timezone, selecting, selectedIds, toggleSelected, enterSelection, openMenu, draftScope, currentNotice]);
  const inboxCount = (viewer?.canReviewInbox ? home?.inbox.count ?? 0 : 0) + imports.length;
  return (
    <View style={{ flex: 1, backgroundColor: colors.paper }}>
      <FlatList
        ref={list}
        testID="timeline-list"
        contentInsetAdjustmentBehavior="never"
        automaticallyAdjustContentInsets={false}
        maintainVisibleContentPosition={{ minIndexForVisible: 1 }}
        contentContainerStyle={{
          padding: journalSpace.page,
          paddingTop: insets.top + 20,
          paddingBottom: contentBottom,
          gap: 18,
          ...(events.length === 0 ? { flexGrow: 1 } : {}),
        }}
      data={visibleEvents}
      keyExtractor={timelineRecordKey}
      onScrollToIndexFailed={info => {
        if (scrollAttempts.current++ >= 3) return;
        list.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
        if (scrollRetry.current) clearTimeout(scrollRetry.current);
        scrollRetry.current = setTimeout(() => list.current?.scrollToIndex({ index: info.index, animated: false, viewPosition: 0.1 }), 150);
      }}
      ListEmptyComponent={
        <EmptyState
          art={<JournalArtwork kind="keepsake" />}
          title={month ? monthIndex.counts.has(month) ? "没有符合筛选的记录" : "本机暂无这个月的记录" : stage || important ? "这里还没有记录" : "第一篇成长记，从今天开始"}
          body={month ? monthIndex.counts.has(month) ? "可以查看全部月份，或调整月龄和重要时刻筛选。" : credentials ? "这个月的资料可能尚未同步到本机。可以下拉同步，或先查看全部记录。" : "选一张照片，或为已有记录补充发生日期；只明确到年份的记录仍在全部月份中。" : "选一张照片，留下一句想对宝宝说的话。"}
          action={month ? <Button title="查看全部记录" onPress={() => { setMonth(""); setStageKey(""); setImportant(false); setSelected([]); }} full={false} /> : <Button title="记一刻" variant="primary" icon="plus" onPress={() => draftScope && navigation.navigate("Capture", { scope: draftScope, target: { kind: "new" } })} full={false} />}
        />
      }
      ListHeaderComponent={
        <View style={{ gap: 12 }}>
          <JournalHomeHeader
            title={growth.title}
            summary={summary}
            selecting={selecting}
            onSelect={() => { setSelecting(value => !value); setSelected([]); }}
            onSearch={() => navigation.navigate("Search")}
          />
          {resume ? <Pressable testID="timeline-resume-draft" accessibilityRole="button" accessibilityLabel={`${resume.savedContent ? "继续补记" : "继续记录"}：${resumableDraftTitle(resume)}`} onPress={() => draftScope && navigation.navigate("Capture", { scope: draftScope, target: { kind: "local", draftId: resume.id, editSaved: Boolean(resume.savedContent) } })} style={[styles.resumeCard, { backgroundColor: colors.card, borderColor: colors.line }]}>
            <View style={{ flex: 1, gap: 4 }}><Text style={{ color: colors.coralDark, fontSize: 13 }}>{resume.savedContent ? "继续上次的补记" : "继续上次没写完的记录"}</Text><Text numberOfLines={2} style={{ color: colors.ink, fontSize: 15 }}>{resumableDraftTitle(resume)}</Text></View>
            <JournalIcon name="chevron-right" color={colors.coralDark} size={18} />
          </Pressable> : null}
          {unfinished && unfinished.rows.length > 1 ? <Button title={`查看 ${unfinished.rows.length} 条未完成记录`} variant="ghost" full={false} onPress={() => navigation.navigate("Pending")} /> : null}
          {unfinished?.error ? <Button title="查看未完成记录" variant="ghost" full={false} onPress={() => navigation.navigate("Pending")} /> : null}
          {resumeEdit ? <Pressable testID="timeline-resume-memory-edit" accessibilityRole="button" accessibilityLabel={`继续补记：${resumableMemoryEditTitle(resumeEdit)}`} onPress={() => draftScope && navigation.navigate("Capture", { scope: draftScope, target: { kind: "memory", memoryId: resumeEdit.memoryId } })} style={[styles.resumeCard, { backgroundColor: colors.card, borderColor: colors.line }]}>
            <View style={{ flex: 1, gap: 4 }}><Text style={{ color: colors.coralDark, fontSize: 13 }}>继续上次的补记</Text><Text numberOfLines={2} style={{ color: colors.ink, fontSize: 15 }}>{resumableMemoryEditTitle(resumeEdit)}</Text></View>
            <JournalIcon name="chevron-right" color={colors.coralDark} size={18} />
          </Pressable> : null}
          {unfinishedEdits?.error ? <Text accessibilityLiveRegion="polite" style={{ color: colors.muted, fontSize: 13 }}>{unfinishedEdits.error}</Text> : null}
          {revisit && !month && !stage && !important && !selecting && !currentNotice ? <Pressable testID="timeline-on-this-day" accessibilityRole="button" accessibilityLabel={`${revisit.yearsAgo} 年前的今天：${revisit.event.title}`} onPress={() => openRecord(revisit.event)} style={[styles.revisitCard, { backgroundColor: colors.softCoral }]}>
            <Text style={{ color: colors.coralDark, fontSize: 12 }}>{revisit.yearsAgo} 年前的今天</Text>
            <View style={styles.toolRow}><Text numberOfLines={2} style={{ flex: 1, color: colors.ink, fontSize: 18 }}>{revisit.event.title}</Text><JournalIcon name="chevron-right" color={colors.coralDark} size={18} /></View>
          </Pressable> : null}
          {currentNotice ? <View style={[styles.savedNotice, { borderColor: colors.line }]}>
            <Text accessibilityLiveRegion="polite" style={{ color: colors.sage, fontSize: 13 }}>这一刻已保存。按发生日期收进成长记。</Text>
            <Button title="查看刚保存的记录" variant="ghost" full={false} onPress={() => {
              const record = findSavedRecord(events, currentNotice.draftId);
              if (record?.source === "server") navigation.navigate("Memory", { id: record.id });
              else navigation.navigate("SavedMemory", { draftId: currentNotice.draftId, scope: currentNotice.scope });
            }} />
          </View> : null}
          <View style={{ gap: 8 }}>
            <MonthPicker compact value={month} currentMonth={today.slice(0, 7)} counts={monthIndex.counts} allowAll onChange={setMonth} />
            <View style={styles.toolRow}>
              <Chip accessibilityRole="button" icon="star" label="第一次" selected={important} onPress={() => setImportant(value => !value)} />
              <View style={styles.tools}>
                {stages.length ? <Button title={stage?.label ?? "按月龄"} variant="ghost" full={false} onPress={() => setFiltersOpen(value => !value)} /> : null}
                <IconButton icon="calendar" label="日历" onPress={() => navigation.navigate("Calendar")} />
              </View>
            </View>
            {filtersOpen && stages.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} accessibilityLabel="按月龄回看">
              {[{ key: "", label: "全部月龄" }, ...stages].map(item => <Chip key={item.key} label={item.label} selected={(stage?.key ?? "") === item.key} onPress={() => setStageKey(item.key)} />)}
            </ScrollView> : null}
            {month || stage || important ? <Button title="清除筛选" variant="ghost" full={false} onPress={() => { setMonth(""); setStageKey(""); setImportant(false); }} /> : null}
          </View>

          {selecting ? (
            <View style={[styles.selectionCard, { backgroundColor: colors.softCoral, borderColor: colors.peach }]}>
              <Text style={[styles.selectionText, { color: colors.coralDark }]}>已选 {selected.length} 条{selected.length >= 100 ? " · 一本最多 100 条" : ""}</Text>
              <View style={styles.selectionActions}>
                <Button title="预览成长册" variant="primary" disabled={!selected.length || !credentials || !draftScope || draftScope === "local" || selected.some(id => events.find(event => event.id === id)?.source !== "server")} onPress={() => { if (draftScope && draftScope !== "local") navigation.navigate("BookCreate", { eventIds: selected, scope: draftScope }); }} full={false} />
                <Button title={`加入相册 · ${selected.length} 条`} variant="ghost" disabled={!selected.length} onPress={() => draftScope && navigation.navigate("Collections", { refs: selectedRefs, scope: draftScope })} full={false} />
              </View>
            </View>
          ) : null}

          {inboxCount > 0 ? (
            <Pressable accessibilityRole="button" onPress={() => navigation.navigate("Pending")} style={[styles.inboxCard, { backgroundColor: colors.card, borderColor: colors.line }]}>
              <Text style={[styles.inboxText, { color: colors.ink }]}>有 {inboxCount > 99 ? "99+" : inboxCount} 条内容需要确认</Text>
            </Pressable>
          ) : null}

          {filtersOpen && outbox.length > 0 ? (
            <View style={[styles.outboxCard, { backgroundColor: colors.softSage }]}>
              <JournalIcon name="check" color={colors.sage} size={16} />
              <Text style={[styles.outboxText, { color: colors.sage }]}>
                {outbox.length} 份已保存在本机，
                {credentials ? "联网后会继续补传" : "连接服务器后再补传"}。
              </Text>
            </View>
          ) : null}
        </View>
      }
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          tintColor={colors.coral}
          onRefresh={() => void refresh()}
        />
      }
      renderItem={renderItem}
        style={{ flex: 1, backgroundColor: colors.paper }}
      />

      {menuElement}
    </View>
  );
}

/** Stable rows avoid rebuilding swipe actions when another record or sync status changes. */
const TimelineRow = memo(function TimelineRow({ item, draftScope, highlighted, groupLabel, canEdit, timeZone, selected, toggleSelected, enterSelection, openMenu }: {
  item: LocalTimelineEvent;
  draftScope: string | null;
  highlighted: boolean;
  groupLabel: string | null;
  canEdit: boolean;
  timeZone?: string;
  selected?: boolean;
  toggleSelected: (id: string) => void;
  enterSelection: (id: string) => void;
  openMenu: ReturnType<typeof useContextMenu>["openMenu"];
}) {
  const navigation = useNavigation<AppNavigation>();
  const { colors } = useColorTheme();
  const canOrganize = Boolean(item.localDraftId) || (item.source === "server" && canEdit);
  const open = () => item.source === "server" ? navigation.navigate("Memory", { id: item.id }) : item.localDraftId && draftScope ? navigation.navigate("SavedMemory", { draftId: item.localDraftId, scope: draftScope }) : navigation.navigate("LocalCapture", { captureId: item.id });
  const select = () => enterSelection(item.id);
  const collect = () => draftScope && navigation.navigate("Collections", { scope: draftScope, refs: [{ kind: item.source === "server" ? "memory" : "localDraft", scope: draftScope, id: item.source === "server" ? item.id : item.localDraftId! }] });
  const card = <TimelineCard item={item} highlighted={highlighted} timeZone={timeZone} selected={selected} onPress={() => selected !== undefined ? toggleSelected(item.id) : open()} onLongPress={event => {
    if (canOrganize) select();
    openMenu([
      ...(canOrganize ? [
        ...(item.source === "server" && draftScope && draftScope !== "local" ? [{ key: "book", label: "做成成长册", icon: "book" as const, onPress: () => navigation.navigate("BookCreate", { eventIds: [item.id], scope: draftScope }) }] : []),
        { key: "collect", label: "加入相册", icon: "image" as const, onPress: collect },
        { key: "select", label: "选择", icon: "check" as const, onPress: select },
      ] : []),
      { key: "detail", label: "查看详情", icon: "chevron-right" as const, onPress: open },
    ], { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY });
  }} />;
  return <View>
    {groupLabel ? <View style={styles.groupHeader}><Text accessibilityRole="header" style={[styles.groupLabel, { color: colors.muted }]}>{groupLabel}</Text><View style={[styles.groupRule, { backgroundColor: colors.line }]} /></View> : null}
    {canOrganize ? <SwipeActions actions={[
      { key: "collect", label: "加入相册", color: colors.sage, onPress: collect },
      { key: "select", label: "选择", color: colors.coral, onPress: select },
    ]}>{card}</SwipeActions> : card}
  </View>;
});

const styles = StyleSheet.create({
  resumeCard: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderWidth: 1, borderRadius: journalRadius.control },
  revisitCard: { gap: 7, padding: 16, borderRadius: journalRadius.control },
  savedNotice: { borderBottomWidth: StyleSheet.hairlineWidth, paddingBottom: 8, gap: 4 },

  toolRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 10 },
  tools: { flexDirection: "row", alignItems: "center", gap: 8 },
  selectionCard: {
    borderRadius: journalRadius.card,
    borderWidth: 1,
    padding: 14,
    gap: 10,
  },
  selectionText: { fontSize: 14, fontWeight: "700" },
  selectionActions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  inboxCard: {
    borderRadius: journalRadius.control,
    borderWidth: 1,
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  inboxText: { fontSize: 15, fontWeight: "600" },
  outboxCard: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: journalRadius.control, padding: 12 },
  outboxText: { flex: 1, fontSize: 13, lineHeight: 19 },
  groupHeader: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 14, marginTop: 6 },
  groupLabel: { fontSize: 13, fontWeight: "500", letterSpacing: 1 },
  groupRule: { flex: 1, height: StyleSheet.hairlineWidth },
});
