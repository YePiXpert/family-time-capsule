import { useCallback, useState } from "react";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { confirmMobileInbox, fetchMobileInbox, mergeMobileInbox, patchMobileInbox } from "../api/client";
import { useApp } from "../state/AppContext";
import type { AppNavigation } from "../navigation/types";
import { colors, sharedStyles } from "../theme";
import type { MobileInboxEntry } from "../types";
import { inputDateTime } from "../utils/format";
import { archiveLocalCaptures } from "../storage/database";

export function InboxScreen() {
  const navigation = useNavigation<AppNavigation>();
  const { credentials, people, runSync } = useApp();
  const [entries, setEntries] = useState<MobileInboxEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<MobileInboxEntry | null>(null);
  const [title, setTitle] = useState("");
  const [occurredAt, setOccurredAt] = useState("");
  const [location, setLocation] = useState("");
  const [participants, setParticipants] = useState<Set<string>>(new Set());
  const [mergeTitle, setMergeTitle] = useState("");

  const load = useCallback(async (nextCursor: string | null = null) => {
    if (!credentials) return;
    setLoading(true);
    setError(null);
    try {
      const page = await fetchMobileInbox(credentials, nextCursor);
      setEntries((current) => nextCursor ? [...current, ...page.entries.filter((item) => !current.some((old) => old.id === item.id))] : page.entries);
      setCursor(page.nextCursor);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法读取收件箱。");
    } finally {
      setLoading(false);
    }
  }, [credentials]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const beginEdit = (entry: MobileInboxEntry) => {
    setEditing(entry);
    setTitle(entry.title);
    setOccurredAt(inputDateTime(entry.occurredAtWall));
    setLocation(entry.locationText ?? "");
    setParticipants(new Set(entry.participantPersonIds));
    setError(null);
  };

  const saveEdit = async () => {
    if (!credentials || !editing) return;
    if (occurredAt && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u.test(occurredAt)) {
      setError("时间格式无效，请使用 2026-09-04T18:30。");
      return;
    }
    setLoading(true);
    try {
      const updated = await patchMobileInbox(credentials, editing.id, {
        title,
        occurredAtWall: occurredAt || null,
        locationText: location,
        participantPersonIds: [...participants],
      });
      setEntries((current) => current.map((entry) => entry.id === updated.id ? updated : entry));
      setEditing(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "修改失败。");
    } finally {
      setLoading(false);
    }
  };

  const confirm = async (id: string) => {
    if (!credentials) return;
    setLoading(true);
    setError(null);
    try {
      const memoryEventId = await confirmMobileInbox(credentials, id);
      await archiveLocalCaptures([id], memoryEventId);
      setEntries((current) => current.filter((entry) => entry.id !== id));
      setEditing(null);
      await runSync();
      navigation.navigate("Memory", { id: memoryEventId });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "确认失败。");
    } finally {
      setLoading(false);
    }
  };

  const merge = async () => {
    if (!credentials || selected.size < 2 || !mergeTitle.trim()) {
      setError("请选择至少两项，并填写合并后的标题。");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const ids = [...selected];
      const memoryEventId = await mergeMobileInbox(credentials, ids, mergeTitle.trim());
      await archiveLocalCaptures(ids, memoryEventId);
      setEntries((current) => current.filter((entry) => !selected.has(entry.id)));
      setSelected(new Set());
      setMergeTitle("");
      await runSync();
      navigation.navigate("Memory", { id: memoryEventId });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "合并失败。");
    } finally {
      setLoading(false);
    }
  };

  if (!credentials) {
    return <View style={sharedStyles.empty}><Text style={sharedStyles.emptyTitle}>收件箱需要家庭服务器</Text><Text style={sharedStyles.emptyText}>本机记录不会丢失。连接后，等待补传的素材会出现在这里。</Text><Pressable onPress={() => navigation.navigate("Settings")} style={sharedStyles.primaryButton}><Text style={sharedStyles.primaryText}>连接服务器</Text></Pressable></View>;
  }

  return (
    <ScrollView contentContainerStyle={sharedStyles.content} style={sharedStyles.screen}>
      <View><Text style={sharedStyles.eyebrow}>从素材到记忆</Text><Text style={sharedStyles.title}>收件箱</Text><Text style={sharedStyles.intro}>先修改标题、时间、人物与地点，再单条确认或多选合并。</Text></View>
      {error ? <View style={sharedStyles.warning}><Text style={sharedStyles.warningText}>{error}</Text><Pressable onPress={() => void load()} style={styles.inlineButton}><Text style={styles.link}>重试</Text></Pressable></View> : null}

      {selected.size >= 2 ? <View style={sharedStyles.card}><Text style={sharedStyles.cardTitle}>合并 {selected.size} 项</Text><TextInput onChangeText={setMergeTitle} placeholder="合并后的记忆标题" style={sharedStyles.input} value={mergeTitle} /><Pressable disabled={loading} onPress={() => void merge()} style={sharedStyles.primaryButton}><Text style={sharedStyles.primaryText}>合并并确认入档</Text></Pressable></View> : null}

      {editing ? <View style={sharedStyles.card}>
        <View style={styles.between}><Text style={sharedStyles.cardTitle}>修改待整理素材</Text><Pressable onPress={() => setEditing(null)} style={styles.inlineButton}><Text style={styles.link}>收起</Text></Pressable></View>
        <Text style={sharedStyles.label}>标题</Text><TextInput onChangeText={setTitle} style={sharedStyles.input} value={title} />
        <Text style={sharedStyles.label}>发生时间</Text><TextInput autoCapitalize="none" onChangeText={setOccurredAt} placeholder="2026-09-04T18:30" style={sharedStyles.input} value={occurredAt} />
        <Text style={sharedStyles.label}>地点</Text><TextInput onChangeText={setLocation} placeholder="可不填" style={sharedStyles.input} value={location} />
        <Text style={sharedStyles.label}>人物</Text><View style={styles.peopleWrap}>{people.map((person) => <Pressable key={person.id} onPress={() => setParticipants((current) => { const next = new Set(current); if (next.has(person.id)) next.delete(person.id); else next.add(person.id); return next; })} style={[styles.personChip, participants.has(person.id) && styles.personChipActive]}><Text style={[styles.personText, participants.has(person.id) && styles.personTextActive]}>{person.displayName}</Text></Pressable>)}</View>
        <View style={styles.buttonRow}><Pressable disabled={loading} onPress={() => void saveEdit()} style={[sharedStyles.secondaryButton, styles.grow]}><Text style={sharedStyles.secondaryText}>保存修改</Text></Pressable><Pressable disabled={loading} onPress={() => void confirm(editing.id)} style={[sharedStyles.primaryButton, styles.grow]}><Text style={sharedStyles.primaryText}>确认入档</Text></Pressable></View>
      </View> : null}

      {entries.length === 0 && !loading ? <View style={sharedStyles.empty}><Text style={sharedStyles.emptyTitle}>收件箱已经整理完</Text><Text style={sharedStyles.emptyText}>新记录同步后会先来到这里，不会自动确认事实或合并。</Text></View> : entries.map((entry) => {
        const image = entry.assets.find((asset) => asset.type === "image");
        const checked = selected.has(entry.id);
        const source = image ? { uri: `${credentials.serverUrl}${image.thumbnailPath ?? image.mediaPath}`, headers: { authorization: `Bearer ${credentials.token}` } } : null;
        return <View key={entry.id} style={styles.entry}>
          {source ? <Image source={source} style={styles.thumbnail} /> : <View style={styles.thumbnailPlaceholder}><Text style={styles.kind}>{entry.kind === "text" ? "文字" : entry.assets[0]?.type === "audio" ? "录音" : "素材"}</Text></View>}
          <View style={styles.grow}><Text numberOfLines={2} style={styles.entryTitle}>{entry.title}</Text><Text style={styles.meta}>{entry.occurredAtWall ? entry.occurredAtWall.replace("T", " ") : "待校时"}{entry.locationText ? ` · ${entry.locationText}` : ""}</Text><View style={styles.buttonRow}><Pressable onPress={() => setSelected((current) => { const next = new Set(current); if (next.has(entry.id)) next.delete(entry.id); else next.add(entry.id); return next; })} style={[styles.smallButton, checked && styles.smallButtonActive]}><Text style={checked ? styles.smallTextActive : styles.smallText}>{checked ? "已选择" : "选择"}</Text></Pressable><Pressable onPress={() => beginEdit(entry)} style={styles.smallButton}><Text style={styles.smallText}>修改</Text></Pressable><Pressable onPress={() => void confirm(entry.id)} style={styles.smallButton}><Text style={styles.smallText}>确认</Text></Pressable></View></View>
        </View>;
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
