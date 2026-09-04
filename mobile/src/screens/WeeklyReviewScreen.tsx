import { useCallback, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { fetchMobileReview, mutateMobileReview } from "../api/client";
import type { RootStackParamList } from "../navigation/types";
import {
  reconcileWeeklyReviewReminder,
  updateWeeklyReviewReminder,
  weeklyReviewReminderEnabled,
} from "../notifications/review-reminders";
import { useApp } from "../state/AppContext";
import { cacheMobileReview, getCachedMobileReview } from "../storage/database";
import { colors, sharedStyles } from "../theme";
import type { MobileReview } from "../types";
import { dateLabel } from "../utils/format";

type Props = NativeStackScreenProps<RootStackParamList, "WeeklyReview">;

const COUNT_LABELS: [keyof MobileReview["counts"], string][] = [
  ["inbox", "收件箱待整理"],
  ["needsReview", "待校时"],
  ["duplicateSuggestions", "疑似重复"],
  ["clusterSuggestions", "分簇建议"],
  ["guestSubmissions", "访客新提交"],
  ["failedImports", "导入失败项"],
];

function statusLabel(status: MobileReview["status"]): string {
  return status === "completed" ? "已完成" : status === "in_progress" ? "进行中" : "未开始";
}

export function WeeklyReviewScreen({ navigation }: Props) {
  const { credentials, online } = useApp();
  const [review, setReview] = useState<MobileReview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reminders, setReminders] = useState(false);

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true); else setLoading(true);
    setError(null);
    const [cached, enabled] = await Promise.all([getCachedMobileReview(), weeklyReviewReminderEnabled()]);
    setReminders(enabled);
    if (cached) setReview(cached);
    if (!credentials) {
      setError(cached ? "当前离线，正在显示上次成功的回顾缓存。" : "连接家庭服务器后可开始每周回顾。");
      setLoading(false); setRefreshing(false);
      return;
    }
    try {
      const next = await fetchMobileReview(credentials);
      await cacheMobileReview(next);
      await reconcileWeeklyReviewReminder(next);
      setReview(next);
    } catch (reason) {
      setError(cached ? "暂时无法刷新，已有回顾缓存没有被清空。" : reason instanceof Error ? reason.message : "读取失败。");
    } finally {
      setLoading(false); setRefreshing(false);
    }
  }, [credentials]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const mutate = async (input: Record<string, unknown>) => {
    if (!credentials || online === false || !review) {
      setError("这个写操作需要联网；尚未向服务器提交任何改变。");
      return null;
    }
    setBusy(true); setError(null);
    try {
      const result = await mutateMobileReview(credentials, { reviewId: review.id, key: review.key, ...input });
      await cacheMobileReview(result.review);
      await reconcileWeeklyReviewReminder(result.review);
      setReview(result.review);
      return result;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "写入失败。");
      return null;
    } finally {
      setBusy(false);
    }
  };

  const toggleReminders = async (enabled: boolean) => {
    setError(null);
    const result = await updateWeeklyReviewReminder(enabled, review);
    const accepted = enabled && result !== "denied";
    setReminders(accepted);
    if (result === "denied") setError("通知权限未开启；每周回顾本身仍可完整使用。可稍后在系统设置中重新允许。");
  };

  if (!review && loading) return <View style={sharedStyles.empty}><ActivityIndicator color={colors.coral} /></View>;
  if (!review) return <View style={sharedStyles.empty}><Text style={sharedStyles.emptyTitle}>暂时无法打开回顾</Text><Text style={sharedStyles.emptyText}>{error}</Text></View>;

  const selected = review.events.filter((event) => event.selected);
  const focus = selected.length ? selected : review.events;
  const missingVoices = focus.filter((event) => event.contributionCount === 0);
  return <ScrollView
    contentContainerStyle={sharedStyles.content}
    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={colors.coral} />}
    style={sharedStyles.screen}
  >
    <Text style={sharedStyles.eyebrow}>Weekly family rhythm</Text>
    <Text style={sharedStyles.title}>每周回顾</Text>
    <Text style={sharedStyles.intro}>{dateLabel(review.periodStart, review.preferences.timezone)} 至 {dateLabel(new Date(new Date(review.periodEnd).getTime() - 1).toISOString(), review.preferences.timezone)} · {statusLabel(review.status)}</Text>
    {error ? <View style={error.includes("缓存") || error.includes("离线") ? sharedStyles.notice : sharedStyles.warning}><Text style={error.includes("缓存") || error.includes("离线") ? sharedStyles.noticeText : sharedStyles.warningText}>{error}</Text></View> : null}
    {review.canWrite ? <Pressable disabled={busy} onPress={() => void mutate({ operation: review.status === "completed" ? "reopen" : review.status === "open" ? "start" : "complete" })} style={[sharedStyles.primaryButton, busy && sharedStyles.disabled]}><Text style={sharedStyles.primaryText}>{review.status === "completed" ? "重新打开本周" : review.status === "open" ? "开始本周回顾" : "完成本周回顾"}</Text></Pressable> : <View style={sharedStyles.notice}><Text style={sharedStyles.noticeText}>当前账号只读。已有缓存可离线查看，但不会生成写入或 outbox。</Text></View>}

    <Step number="1" title="整理本周素材" description="新内容仍先经过收件箱人工确认；建议不会自动合并或确认事实。">
      <View style={styles.metricGrid}>{COUNT_LABELS.map(([key, label]) => <Pressable key={key} onPress={() => key === "failedImports" ? navigation.navigate("ImportSessions") : navigation.navigate("MainTabs", { screen: "Inbox" })} style={styles.metric}><Text style={styles.metricValue}>{review.counts[key]}</Text><Text style={styles.metricLabel}>{label}</Text></Pressable>)}</View>
    </Step>

    <Step number="2" title="选择本周重点" description="这里只列出已确认 MemoryEvent；点开记忆补标题、地点、人物或成长节点。">
      {review.events.length ? review.events.map((event) => <View key={event.id} style={[sharedStyles.card, event.selected && styles.selected]}>
        <Pressable onPress={() => navigation.navigate("Memory", { id: event.id })}><Text style={sharedStyles.cardTitle}>{event.title}</Text><Text style={sharedStyles.body}>{dateLabel(event.occurredAt, review.preferences.timezone)}{event.participantNames.length ? ` · ${event.participantNames.join("、")}` : ""}{event.locationText ? ` · ${event.locationText}` : ""}</Text></Pressable>
        {review.canWrite ? <Pressable disabled={busy} onPress={() => void mutate({ operation: "highlight", eventId: event.id, selected: !event.selected })} style={sharedStyles.secondaryButton}><Text style={sharedStyles.secondaryText}>{event.selected ? "取消重点" : "选为重点"}</Text></Pressable> : null}
      </View>) : <View style={sharedStyles.notice}><Text style={sharedStyles.noticeText}>这一周还没有已确认事件。可以先整理收件箱，也可以完成一个空白周。</Text></View>}
    </Step>

    <Step number="3" title="补上家人的声音" description="仅提示重点记忆中还没有 family 可见讲述的部分，不强迫每条都补充。">
      <Pressable onPress={() => navigation.navigate("Requests")} style={sharedStyles.card}><Text style={sharedStyles.cardTitle}>等待回答 · {review.counts.pendingRequests}</Text><Text style={sharedStyles.body}>查看、关闭或分享已有口述史问题。</Text></Pressable>
      {missingVoices.length ? <View style={sharedStyles.card}><Text style={sharedStyles.cardTitle}>还缺家人声音 · {missingVoices.length}</Text>{missingVoices.map((event) => <Text key={event.id} style={sharedStyles.body}>· {event.title}</Text>)}{review.canWrite ? <Pressable onPress={() => navigation.navigate("RequestCreate")} style={sharedStyles.secondaryButton}><Text style={sharedStyles.secondaryText}>向家人发一个问题</Text></Pressable> : null}</View> : null}
    </Step>

    <Step number="4" title="生成周记草稿" description="不用 AI 也会使用真实标题、日期、人物、地点与原话，并为每段保留来源。">
      {review.storyId ? <Pressable onPress={() => navigation.navigate("StoryDetail", { id: review.storyId! })} style={sharedStyles.card}><Text style={sharedStyles.cardTitle}>本周期已有来源周记草稿</Text><Text style={styles.link}>原生打开草稿 →</Text></Pressable> : review.events.length && review.canWrite ? <Pressable disabled={busy} onPress={() => void mutate({ operation: "generate" }).then((result) => { if (result?.storyId) navigation.navigate("StoryDetail", { id: result.storyId }); })} style={[sharedStyles.primaryButton, busy && sharedStyles.disabled]}><Text style={sharedStyles.primaryText}>不用 AI，生成有来源的草稿</Text></Pressable> : <Text style={sharedStyles.body}>{review.events.length ? "当前账号不能创建故事。" : "没有已确认事件时不会编造故事。"}</Text>}
      {review.canWrite && review.events.length ? <Pressable disabled={busy} onPress={() => void mutate({ operation: "optimize_ai" })} style={[sharedStyles.secondaryButton, busy && sharedStyles.disabled]}><Text style={sharedStyles.secondaryText}>已明确同意时，用 AI 优化表达</Text></Pressable> : null}
      <View style={sharedStyles.notice}><Text style={sharedStyles.noticeText}>AI 默认关闭；仅在文本能力已配置、家庭已同意且你再次点按后入队。引文逐字保留，结果仍是草稿，不会自动发布或覆盖人工编辑。</Text></View>
    </Step>

    <View style={sharedStyles.card}><View style={styles.switchRow}><View style={styles.grow}><Text style={sharedStyles.cardTitle}>本机隐私提醒</Text><Text style={sharedStyles.body}>只在本机调度，可随时关闭。锁屏文案不会包含名字、照片或家人原话。</Text></View><Switch onValueChange={(value) => void toggleReminders(value)} trackColor={{ false: colors.line, true: colors.sage }} value={reminders} /></View><Text style={styles.privacyCopy}>“这周有几段家庭记忆等待整理”</Text>{!review.reminderAt && reminders ? <Text style={sharedStyles.body}>本周期没有待调度的未来提醒；刷新到下个周期后会重新核对。</Text> : null}</View>
  </ScrollView>;
}

function Step({ number, title, description, children }: { number: string; title: string; description: string; children: React.ReactNode }) {
  return <View style={styles.step}><View style={styles.stepHeader}><Text style={styles.stepNumber}>{number}</Text><View style={styles.grow}><Text style={sharedStyles.cardTitle}>{title}</Text><Text style={sharedStyles.body}>{description}</Text></View></View>{children}</View>;
}

const styles = StyleSheet.create({
  step: { gap: 10, paddingTop: 8 },
  stepHeader: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  stepNumber: { width: 28, height: 28, borderRadius: 14, overflow: "hidden", textAlign: "center", paddingTop: 4, color: colors.card, backgroundColor: colors.ink, fontWeight: "800" },
  grow: { flex: 1, gap: 3 },
  metricGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  metric: { width: "48%", minHeight: 72, justifyContent: "center", backgroundColor: colors.card, borderColor: colors.line, borderWidth: 1, borderRadius: 13, padding: 12 },
  metricValue: { color: colors.ink, fontSize: 23, fontWeight: "800" },
  metricLabel: { color: colors.muted, fontSize: 12 },
  selected: { borderColor: colors.coral, backgroundColor: colors.softCoral },
  link: { color: colors.coralDark, fontSize: 14, fontWeight: "800" },
  switchRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  privacyCopy: { color: colors.ink, fontSize: 14, fontWeight: "700", textAlign: "center" },
});
