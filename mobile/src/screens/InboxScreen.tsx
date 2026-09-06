import { useCallback, useRef, useState } from "react";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { memoryCacheScope } from "../memories/cache-scope";
import { ApiError, confirmMobileInbox, fetchMobileInbox, mergeMobileInbox, patchMobileInbox } from "../api/client";
import { DateTimeField } from "../components/DateTimeField";
import { useApp } from "../state/AppContext";
import type { AppNavigation } from "../navigation/types";
import { colors, sharedStyles } from "../theme";
import type { InboxDraftPatch, MobileInboxEntry } from "../types";
import { inputDateTime } from "../utils/format";
import { archiveLocalCaptures } from "../storage/database";
import { canReviewMobileInbox } from "../authz/product-access";
import { TranscriptEditor } from "../transcripts/TranscriptEditor";
import { NativeMediaReader } from "../media/NativeMediaReader";
import { NameEditor } from "../names/NameEditor";

export function InboxScreen() {
  const { credentials, viewer, family } = useApp();
  return <InboxContent key={memoryCacheScope(credentials, viewer?.id, family?.id)} />;
}

function InboxContent() {
  const navigation = useNavigation<AppNavigation>();
  const { credentials, people, runSync, viewer } = useApp();
  const generation = useRef(0);
  const canReview = canReviewMobileInbox(viewer);
  const [entries, setEntries] = useState<MobileInboxEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<MobileInboxEntry | null>(null);
  const [title, setTitle] = useState("");
  const [occurredAt, setOccurredAt] = useState<string | null>(null);
  const [location, setLocation] = useState("");
  const [participants, setParticipants] = useState<Set<string>>(new Set());
  const [reading, setReading] = useState<string | null>(null);
  const [mergeTitle, setMergeTitle] = useState("");

  const load = useCallback(async (nextCursor: string | null = null) => {
    if (!credentials) return;
    const request = ++generation.current;
    setLoading(true);
    setError(null);
    try {
      const page = await fetchMobileInbox(credentials, nextCursor);
      if (request !== generation.current) return;
      setEntries((current) => nextCursor ? [...current, ...page.entries.filter((item) => !current.some((old) => old.id === item.id))] : page.entries);
      setCursor(page.nextCursor);
    } catch (reason) {
      if (request !== generation.current) return;
      if (reason instanceof ApiError && [401, 403, 404].includes(reason.status)) { setEntries([]); setEditing(null); setReading(null); setSelected(new Set()); }
      setError(reason instanceof Error ? reason.message : "无法读取收件箱。");
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, [credentials]);

  useFocusEffect(useCallback(() => { void load(); return () => { generation.current++; }; }, [load]));

  const beginEdit = (entry: MobileInboxEntry) => {
    setEditing(entry);
    setTitle(entry.title);
    setOccurredAt(entry.occurredAtWall ? inputDateTime(entry.occurredAtWall) : null);
    setLocation(entry.locationText ?? "");
    setParticipants(new Set(entry.participantPersonIds));
    setError(null);
  };

  const saveEdit = async () => {
    if (!credentials || !editing || !canReview || loading) return;
    const request = ++generation.current;
    setLoading(true);
    try {
      const updated = await patchMobileInbox(credentials, editing.id, {
        title,
        occurredAtWall: occurredAt,
        locationText: location,
        participantPersonIds: [...participants],
      });
      if (request !== generation.current) return;
      setEntries((current) => current.map((entry) => entry.id === updated.id ? updated : entry));
      setEditing(null);
    } catch (reason) {
      if (request !== generation.current) return;
      if (reason instanceof ApiError && [401, 403, 404].includes(reason.status)) { setEntries([]); setEditing(null); setReading(null); setSelected(new Set()); }
      setError(reason instanceof Error ? reason.message : "修改失败。");
    } finally {
      if (request === generation.current) setLoading(false);
    }
  };

  /**
   * 确认入档。若正在编辑这一条，则把屏幕上尚未单独保存的
   * 标题/时间/人物/地点一并提交，服务端在同一事务中保存并确认；
   * 不存在只确认旧草稿的路径。
   */
  const confirm = async (entry: MobileInboxEntry) => {
    if (!credentials || !canReview || loading) return;
    const request = ++generation.current;
    let draft: InboxDraftPatch | undefined;
    if (editing && editing.id === entry.id) {
      draft = {
        title,
        occurredAtWall: occurredAt,
        locationText: location,
        participantPersonIds: [...participants],
      };
    }
    setLoading(true);
    setError(null);
    try {
      const memoryEventId = await confirmMobileInbox(credentials, entry.id, draft);
      if (request !== generation.current) return;
      await archiveLocalCaptures([entry.id], memoryEventId);
      if (request !== generation.current) return;
      setEntries((current) => current.filter((item) => item.id !== entry.id));
      setEditing(null);
      await runSync();
      if (request !== generation.current) return;
      navigation.navigate("Memory", { id: memoryEventId });
    } catch (reason) {
      if (request !== generation.current) return;
      if (reason instanceof ApiError && [401, 403, 404].includes(reason.status)) { setEntries([]); setEditing(null); setReading(null); setSelected(new Set()); }
      setError(reason instanceof Error ? reason.message : "确认失败。");
    } finally {
      if (request === generation.current) setLoading(false);
    }
  };

  const merge = async () => {
    if (!credentials || !canReview || loading) return;
    const request = ++generation.current;
    if (selected.size < 2 || !mergeTitle.trim()) {
      setError("请选择至少两项，并填写合并后的标题。");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const ids = [...selected];
      const memoryEventId = await mergeMobileInbox(credentials, ids, mergeTitle.trim());
      if (request !== generation.current) return;
      await archiveLocalCaptures(ids, memoryEventId);
      if (request !== generation.current) return;
      setEntries((current) => current.filter((entry) => !selected.has(entry.id)));
      setSelected(new Set());
      setMergeTitle("");
      await runSync();
      if (request !== generation.current) return;
      navigation.navigate("Memory", { id: memoryEventId });
    } catch (reason) {
      if (request !== generation.current) return;
      if (reason instanceof ApiError && [401, 403, 404].includes(reason.status)) { setEntries([]); setEditing(null); setReading(null); setSelected(new Set()); }
      setError(reason instanceof Error ? reason.message : "合并失败。");
    } finally {
      if (request === generation.current) setLoading(false);
    }
  };

  if (!credentials) {
    return <View style={sharedStyles.empty}><Text style={sharedStyles.emptyTitle}>收件箱需要家庭服务器</Text><Text style={sharedStyles.emptyText}>本机记录不会丢失。连接后，等待补传的素材会出现在这里。</Text><Pressable onPress={() => navigation.navigate("Settings")} style={sharedStyles.primaryButton}><Text style={sharedStyles.primaryText}>连接服务器</Text></Pressable></View>;
  }

  return (
    <ScrollView contentContainerStyle={sharedStyles.content} style={sharedStyles.screen}>
      <View><Text style={sharedStyles.eyebrow}>从素材到记忆</Text><Text style={sharedStyles.title}>收件箱</Text><Text style={sharedStyles.intro}>{canReview ? "先修改标题、时间、人物与地点，再单条确认或多选合并。" : "当前家庭角色可查看待整理素材，但不能修改、合并或确认。"}</Text></View>
      {error ? <View style={sharedStyles.warning}><Text style={sharedStyles.warningText}>{error}</Text><Pressable onPress={() => void load()} style={styles.inlineButton}><Text style={styles.link}>重试</Text></Pressable></View> : null}

      {canReview && selected.size >= 2 ? <View style={sharedStyles.card}><Text style={sharedStyles.cardTitle}>合并 {selected.size} 项</Text><TextInput onChangeText={setMergeTitle} placeholder="合并后的记忆标题" style={sharedStyles.input} value={mergeTitle} /><Pressable disabled={loading} onPress={() => void merge()} style={sharedStyles.primaryButton}><Text style={sharedStyles.primaryText}>合并并确认入档</Text></Pressable></View> : null}

      {canReview && editing ? <View style={sharedStyles.card}>
        <View style={styles.between}><Text style={sharedStyles.cardTitle}>修改待整理素材</Text><Pressable onPress={() => setEditing(null)} style={styles.inlineButton}><Text style={styles.link}>收起</Text></Pressable></View>
        <Text style={sharedStyles.label}>标题</Text><TextInput onChangeText={setTitle} style={sharedStyles.input} value={title} />
        <Text style={sharedStyles.label}>发生时间</Text><DateTimeField onChange={setOccurredAt} value={occurredAt} />
        <Text style={sharedStyles.label}>地点</Text><TextInput onChangeText={setLocation} placeholder="可不填" style={sharedStyles.input} value={location} />
        <Text style={sharedStyles.label}>人物</Text><View style={styles.peopleWrap}>{people.map((person) => <Pressable key={person.id} onPress={() => setParticipants((current) => { const next = new Set(current); if (next.has(person.id)) next.delete(person.id); else next.add(person.id); return next; })} style={[styles.personChip, participants.has(person.id) && styles.personChipActive]}><Text style={[styles.personText, participants.has(person.id) && styles.personTextActive]}>{person.displayName}</Text></Pressable>)}</View>
        <View style={styles.buttonRow}><Pressable disabled={loading} onPress={() => void saveEdit()} style={[sharedStyles.secondaryButton, styles.grow]}><Text style={sharedStyles.secondaryText}>保存修改</Text></Pressable><Pressable disabled={loading} onPress={() => void confirm(editing)} style={[sharedStyles.primaryButton, styles.grow]}><Text style={sharedStyles.primaryText}>确认入档</Text></Pressable></View>
      </View> : null}

      {entries.length === 0 && !loading ? <View style={sharedStyles.empty}><Text style={sharedStyles.emptyTitle}>收件箱已经整理完</Text><Text style={sharedStyles.emptyText}>新记录同步后会先来到这里，不会自动确认事实或合并。</Text></View> : entries.map((entry) => {
        const image = entry.assets.find((asset) => asset.type === "image");
        const checked = selected.has(entry.id);
        const source = image ? { uri: `${credentials.serverUrl}${image.thumbnailPath ?? image.mediaPath}`, headers: { authorization: `Bearer ${credentials.token}` } } : null;
        return <View key={entry.id}><View style={styles.entry}>
          {source ? <Image source={source} style={styles.thumbnail} /> : <View style={styles.thumbnailPlaceholder}><Text style={styles.kind}>{entry.kind === "text" ? "文字" : entry.assets[0]?.type === "audio" ? "录音" : "素材"}</Text></View>}
          <View style={styles.grow}><Text numberOfLines={2} style={styles.entryTitle}>{entry.title}</Text><Text style={styles.meta}>{entry.occurredAtWall ? entry.occurredAtWall.replace("T", " ") : "待校时"}{entry.locationText ? ` · ${entry.locationText}` : ""}</Text>{canReview ? <View style={styles.buttonRow}><Pressable onPress={() => setSelected((current) => { const next = new Set(current); if (next.has(entry.id)) next.delete(entry.id); else next.add(entry.id); return next; })} style={[styles.smallButton, checked && styles.smallButtonActive]}><Text style={checked ? styles.smallTextActive : styles.smallText}>{checked ? "已选择" : "选择"}</Text></Pressable><Pressable onPress={() => beginEdit(entry)} style={styles.smallButton}><Text style={styles.smallText}>修改</Text></Pressable><Pressable onPress={() => void confirm(entry)} style={styles.smallButton}><Text style={styles.smallText}>确认</Text></Pressable></View> : null}</View>
        </View><Pressable onPress={() => setReading(reading === entry.id ? null : entry.id)} style={sharedStyles.secondaryButton}><Text style={sharedStyles.secondaryText}>{reading === entry.id ? "收起素材" : "查看素材与全文"}</Text></Pressable>{reading === entry.id ? <View>{entry.rawText ? <Text selectable style={sharedStyles.body}>{entry.rawText}</Text> : null}<NativeMediaReader credentials={credentials} assets={entry.assets} />{entry.assets.filter(asset => asset.type === "audio" || asset.type === "video").map(asset => <TranscriptEditor key={asset.id} assetId={asset.id} label={asset.filename} />)}</View> : null}{canReview ? <NameEditor kind="inbox_item" id={entry.id} onSaved={() => void load()} /> : null}</View>;
      })}
      {loading ? <ActivityIndicator color={colors.coral} /> : null}
      {cursor && !loading ? <Pressable onPress={() => void load(cursor)} style={sharedStyles.secondaryButton}><Text style={sharedStyles.secondaryText}>加载更多</Text></Pressable> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  entry: { flexDirection: "row", alignItems: "flex-start", gap: 12, padding: 11, backgroundColor: colors.card, borderColor: colors.line, borderRadius: 16, borderWidth: 1 },
  thumbnail: { width: 88, height: 88, borderRadius: 12, backgroundColor: colors.softCoral },
  thumbnailPlaceholder: { width: 88, height: 88, borderRadius: 12, backgroundColor: colors.softCoral, alignItems: "center", justifyContent: "center" },
  kind: { color: colors.coralDark, fontWeight: "800" },
  grow: { flex: 1, gap: 6 },
  entryTitle: { color: colors.ink, fontSize: 16, lineHeight: 21, fontWeight: "800" },
  meta: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  buttonRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  smallButton: { minHeight: 44, minWidth: 52, alignItems: "center", justifyContent: "center", borderColor: colors.line, borderRadius: 10, borderWidth: 1, paddingHorizontal: 8 },
  smallButtonActive: { backgroundColor: colors.softSage, borderColor: colors.sage },
  smallText: { color: colors.coralDark, fontSize: 12, fontWeight: "700" },
  smallTextActive: { color: colors.sage, fontSize: 12, fontWeight: "800" },
  between: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  inlineButton: { minHeight: 44, justifyContent: "center", paddingHorizontal: 8 },
  link: { color: colors.coralDark, fontSize: 13, fontWeight: "800" },
  peopleWrap: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  personChip: { minHeight: 44, justifyContent: "center", borderColor: colors.line, borderRadius: 22, borderWidth: 1, paddingHorizontal: 13 },
  personChipActive: { backgroundColor: colors.softSage, borderColor: colors.sage },
  personText: { color: colors.muted, fontWeight: "700" },
  personTextActive: { color: colors.sage },
});
