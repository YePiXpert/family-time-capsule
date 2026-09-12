import { NativeVoiceContribution } from "../contributions/VoiceContribution";
import type { VoiceReceipt } from "../contributions/submit-voice";
import { Text, TextInput } from "../components/typography";
import { getServerCacheRevision, useServerPermissionRevision } from "../storage/cache-lifecycle";
import { MemoryEditor } from "../memories/MemoryEditor";
import { useCallback, useMemo, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { NativeMediaReader } from "../media/NativeMediaReader";
import {
  createMobileContribution,
  ApiError,
  fetchMobileMemory,
  updateMobileContribution,
} from "../api/client";
import { useAppData, useAppActions } from "../state/AppContext";
import type { RootStackParamList } from "../navigation/types";
import {
  cacheMemoryDetail,
  getCachedMemoryDetail,
  removeCachedMemoryDetail,
  listLocalMemoryMedia,
  type LocalMemoryMedia,
} from "../storage/database";
import { useSharedStyles } from "../theme";
import type { JournalPalette } from "../design/tokens";
import type { MobileContributionVisibility, MobileMemory } from "../types";
import { dateLabel } from "../utils/format";
import {
  eligibleContributionAuthors,
  shouldRenderStandaloneCover,
} from "../memories/presentation";
import { memoryCacheScope } from "../memories/cache-scope";
import { OrganizerPanel } from "../ai/OrganizerPanel";

type Props = NativeStackScreenProps<RootStackParamList, "Memory">;

const CONTRIBUTION_VISIBILITIES: {
  value: MobileContributionVisibility;
  label: string;
}[] = [
  { value: "family", label: "全家可见" },
  { value: "parents", label: "仅监护人" },
  { value: "private", label: "仅自己" },
  { value: "child_later", label: "长大后可见" },
];

function visibilityLabel(value: MobileContributionVisibility): string {
  return CONTRIBUTION_VISIBILITIES.find((option) => option.value === value)?.label ?? value;
}

export function MemoryScreen(props: Props) {
  const { credentials, viewer, family } = useAppData();
  const scope = memoryCacheScope(credentials, viewer?.id, family?.id);
  const permissionRevision = useServerPermissionRevision();
  // Remount before rendering after an account/event change, including any
  // private text already held in state or in an editing control.
  return <MemoryDetailScreen key={JSON.stringify([scope, props.route.params.id, permissionRevision])} {...props} cacheScope={scope} />;
}

function MemoryDetailScreen({ route, navigation, cacheScope }: Props & { cacheScope: string | null }) {
  const s = useSharedStyles();
  const styles = useMemo(() => createStyles(s.colors), [s.colors]);
  const { credentials, events, family, online, people, viewer } = useAppData();
  const { reloadLocal } = useAppActions();
  const [memory, setMemory] = useState<MobileMemory | null>(null);
  const [localMedia, setLocalMedia] = useState<LocalMemoryMedia[]>([]);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [contributionText, setContributionText] = useState("");
  const [authorPersonId, setAuthorPersonId] = useState("");
  const [visibility, setVisibility] = useState<MobileContributionVisibility>("family");
  const [editingContributionId, setEditingContributionId] = useState<string | null>(null);
  const [editingContributionText, setEditingContributionText] = useState("");
  const [savingContribution, setSavingContribution] = useState(false);
  const requestVersion = useRef(0);
  const summary = denied ? undefined : events.find((event) => event.id === route.params.id);
  const ownDraftScope = credentials?.instanceId && viewer?.id && family?.id ? JSON.stringify([credentials.serverUrl, credentials.instanceId, viewer.id, family.id]) : credentials ? null : "local";

  const load = useCallback(async () => {
    const version = ++requestVersion.current;
    const cacheRevision = getServerCacheRevision();
    setLoading(true);
    setError(null);
    try {
      const [cached, archivedMedia] = await Promise.all([
        cacheScope ? getCachedMemoryDetail(cacheScope, route.params.id) : null,
        listLocalMemoryMedia(route.params.id, ownDraftScope),
      ]);
      if (version !== requestVersion.current || cacheRevision !== getServerCacheRevision()) return;
      setLocalMedia(archivedMedia);
      if (credentials && online !== false) {
        try {
          const next = await fetchMobileMemory(credentials, route.params.id);
          if (version !== requestVersion.current || cacheRevision !== getServerCacheRevision()) return;
          if (cacheScope && !await cacheMemoryDetail(cacheScope, next, cacheRevision)) return;
          if (version !== requestVersion.current || cacheRevision !== getServerCacheRevision()) return;
          setDenied(false);
          setMemory(next);
        } catch (reason) {
          if (version !== requestVersion.current || cacheRevision !== getServerCacheRevision()) return;
          if (reason instanceof ApiError && [401, 403, 404].includes(reason.status)) {
            setDenied(true);
            setMemory(null);
            setLocalMedia([]);
            if (cacheScope) await removeCachedMemoryDetail(cacheScope, route.params.id);
            if (version === requestVersion.current) await reloadLocal?.();
          } else {
            setDenied(!cached && archivedMedia.length === 0);
            setMemory(cached);
          }
          if (version === requestVersion.current)
            setError(reason instanceof Error ? reason.message : "无法更新记忆详情。");
        }
      } else {
        setDenied(!cached && archivedMedia.length === 0);
        setMemory(cached);
        if (!cached) setError("当前离线；这份记忆还没有在本机打开过。");
      }
    } catch (reason) {
      if (version === requestVersion.current)
        setError(reason instanceof Error ? reason.message : "无法读取记忆详情。");
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [credentials, online, route.params.id, cacheScope, ownDraftScope, reloadLocal]);

  useFocusEffect(useCallback(() => {
    void load();
    return () => { requestVersion.current += 1; };
  }, [load]));

  const contributionAuthors = eligibleContributionAuthors(viewer, people);
  const effectiveAuthorPersonId = authorPersonId || contributionAuthors.find(p => p.id === viewer?.personId)?.id || contributionAuthors[0]?.id || "";
  const restoreVoiceSelection = useCallback((voice: VoiceReceipt) => {
    setAuthorPersonId(voice.authorPersonId);
    setVisibility(voice.visibility);
  }, []);

  const refreshMemory = async () => {
    if (!credentials) return;
    await load();
  };

  const addContribution = async () => {
    const text = contributionText.trim();
    if (!credentials || !effectiveAuthorPersonId || !text || text.length > 5000) {
      setError("请选择作者，并输入 1–5000 字的讲述。");
      return;
    }
    setSavingContribution(true);
    setError(null);
    try {
      await createMobileContribution(credentials, route.params.id, {
        authorPersonId: effectiveAuthorPersonId,
        text,
        visibility,
      });
      await refreshMemory();
      setContributionText("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法保存讲述。");
    } finally {
      setSavingContribution(false);
    }
  };

  const saveContribution = async () => {
    const text = editingContributionText.trim();
    if (!credentials || !editingContributionId || !text || text.length > 5000) {
      setError("讲述需要 1–5000 字。");
      return;
    }
    setSavingContribution(true);
    setError(null);
    try {
      await updateMobileContribution(credentials, editingContributionId, text);
      await refreshMemory();
      setEditingContributionId(null);
      setEditingContributionText("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法修改讲述。");
    } finally {
      setSavingContribution(false);
    }
  };

  const title = memory?.title ?? summary?.title ?? "记忆详情";
  const ageLabel = memory ? memory.ageLabel : summary?.ageLabel;
  const location = memory ? memory.locationText : summary?.locationText;
  const occurredAt = memory?.occurredAt ?? summary?.occurredAt;
  const localCover = summary?.localCoverUri && (summary.source === "local" || localMedia.some(asset => asset.localUri === summary.localCoverUri)) ? summary.localCoverUri : null;
  const useLocalMedia = !denied && (online === false || !credentials);
  const showStandaloneCover = Boolean(localCover) && (
    useLocalMedia
      ? !localMedia.some((asset) => asset.mediaType === "image")
      : !memory || shouldRenderStandaloneCover(
          summary?.cover?.assetId,
          memory.assets.map((asset) => asset.id),
        )
  );
  return (
    <ScrollView contentContainerStyle={s.content} style={s.screen}>
      {showStandaloneCover ? <Image source={{ uri: localCover! }} style={styles.cover} /> : null}
      {(memory?.livePhotos?.length ?? 0) > 0 && <Text style={s.body}>Live Photo 已保留静态照片和动态原片，可在下方分别查看与播放。</Text>}
      <NativeMediaReader credentials={credentials} assets={useLocalMedia ? localMedia.map(asset => ({id:asset.captureId,type:asset.mediaType,filename:asset.title,mimeType:'',localUri:asset.localUri})) : (memory?.assets.map(asset => ({...asset,thumbnailId:asset.thumbnailPath?.split('/').at(-1),dateLabel:occurredAt?dateLabel(occurredAt,family?.timezone,memory?.occurredAtPrecision ?? summary?.occurredAtPrecision):undefined})) ?? [])} />
      {memory?.assets.filter(asset => asset.type === "audio" || asset.type === "video").map(asset => <OrganizerPanel key={asset.id} kind="asset" id={asset.id} label={asset.filename} onSaved={() => void load()} />)}
      <View style={styles.heading}>
        <Text style={s.eyebrow}>阅读记忆</Text>
        <Text style={s.title}>{title}</Text>
        {occurredAt ? <Text style={styles.date}>{dateLabel(occurredAt, family?.timezone, memory?.occurredAtPrecision ?? summary?.occurredAtPrecision)}{ageLabel ? ` · ${ageLabel}` : ""}</Text> : null}
        {location ? <Text style={s.intro}>地点 · {location}</Text> : null}
        <Text style={styles.sync}>{memory ? (online === false ? "本机缓存 · 当前离线" : "详情已同步到本机") : "读取中"}</Text>
      </View>

      {credentials && viewer?.canEditEvents?<Pressable onPress={()=>navigation.navigate("Collections",{eventIds:[route.params.id]})} style={s.secondaryButton}><Text style={s.secondaryText}>加入相册 / 章节</Text></Pressable>:null}
      {memory ? <MemoryEditor memory={memory} onSaved={load} /> : null}
      {memory ? <OrganizerPanel kind="memory_event" id={memory.id} onSaved={() => void load()} /> : null}

      {error ? <View style={s.warning}><Text style={s.warningText}>{error}</Text><Pressable onPress={() => void load()} style={styles.retry}><Text style={styles.link}>重试</Text></Pressable></View> : null}
      {loading && !memory ? <ActivityIndicator color={s.colors.coral} /> : null}

      {(memory?.sourceNotes.length ?? 0) > 0 ? <View style={s.card}><Text style={s.cardTitle}>当时写下的</Text>{memory!.sourceNotes.map((note) => <Text key={note.id} style={styles.story}>{note.text}</Text>)}</View> : null}
      {(memory?.contributions.length ?? 0) > 0 ? <View style={s.card}><Text style={s.cardTitle}>家人讲述</Text>{memory!.contributions.map((contribution) => <View key={contribution.id} style={styles.contribution}><View style={styles.contributionHeading}><Text style={styles.author}>{contribution.authorName}</Text><Text style={styles.visibility}>{visibilityLabel(contribution.visibility)}</Text></View>{editingContributionId === contribution.id ? <><TextInput multiline onChangeText={setEditingContributionText} style={[s.input, styles.contributionInput]} textAlignVertical="top" value={editingContributionText} /><View style={styles.buttonRow}><Pressable disabled={savingContribution} onPress={() => setEditingContributionId(null)} style={[s.secondaryButton, styles.grow]}><Text style={s.secondaryText}>取消</Text></Pressable><Pressable disabled={savingContribution} onPress={() => void saveContribution()} style={[s.primaryButton, styles.grow]}><Text style={s.primaryText}>保存修改</Text></Pressable></View></> : <><Text style={styles.story}>{contribution.text}</Text>{contribution.canEdit ? <Pressable onPress={() => { setEditingContributionId(contribution.id); setEditingContributionText(contribution.text); }} style={s.secondaryButton}><Text style={s.secondaryText}>修改我的讲述</Text></Pressable> : null}</>}{contribution.audioPath ? <NativeMediaReader credentials={credentials} assets={[{id:contribution.audioPath.split('/').at(-1)!,type:'audio',filename:'家人的声音',mimeType:'audio/mp4',author:contribution.authorName,dateLabel:contribution.createdAt?dateLabel(contribution.createdAt,family?.timezone):undefined}]} /> : null}</View>)}</View> : null}
      {credentials && contributionAuthors.length > 0 ? <View style={s.card}><Text style={s.cardTitle}>补一句，或留段声音</Text><Text style={s.label}>作者</Text><View style={styles.chips}>{contributionAuthors.map((person) => <Pressable key={person.id} onPress={() => setAuthorPersonId(person.id)} style={[styles.chip, effectiveAuthorPersonId === person.id && styles.chipActive]}><Text style={effectiveAuthorPersonId === person.id ? styles.chipTextActive : styles.chipText}>{person.displayName}</Text></Pressable>)}</View><Text style={s.label}>可见范围</Text><View style={styles.chips}>{CONTRIBUTION_VISIBILITIES.map((option) => <Pressable key={option.value} onPress={() => setVisibility(option.value)} style={[styles.chip, visibility === option.value && styles.chipActive]}><Text style={visibility === option.value ? styles.chipTextActive : styles.chipText}>{option.label}</Text></Pressable>)}</View><NativeVoiceContribution key={JSON.stringify([credentials?.serverUrl, credentials?.instanceId, viewer?.id, family?.id, route.params.id])} memoryId={route.params.id} authorPersonId={effectiveAuthorPersonId} authorName={contributionAuthors.find(p => p.id === effectiveAuthorPersonId)?.displayName || "家人"} visibility={visibility} onSaved={load} onRestoreSelection={restoreVoiceSelection} /><TextInput multiline onChangeText={setContributionText} placeholder="写下你的视角……" style={[s.input, styles.contributionInput]} textAlignVertical="top" value={contributionText} /><Text style={styles.counter}>{contributionText.length} / 5000</Text><Pressable disabled={savingContribution} onPress={() => void addContribution()} style={[s.primaryButton, savingContribution && s.disabled]}><Text style={s.primaryText}>保存这段讲述</Text></Pressable></View> : null}
      {(memory?.participants.length ?? summary?.participantNames.length ?? 0) > 0 ? <View style={s.card}><Text style={s.cardTitle}>在场的人</Text><Text style={s.body}>{memory ? memory.participants.map((person) => person.displayName).join(" · ") : summary?.participantNames.join(" · ")}</Text></View> : null}
    </ScrollView>
  );
}

function createStyles(palette: JournalPalette) {
  return StyleSheet.create({
  cover: { width: "100%", height: 250, borderRadius: 20, backgroundColor: palette.softCoral },
  galleryImage: { width: "100%", height: 300, borderRadius: 20, backgroundColor: palette.softCoral },
  video: { width: "100%", height: 240, borderRadius: 20, backgroundColor: palette.mediaBackdrop },
  heading: { gap: 6 },
  date: { color: palette.coralDark, fontSize: 14, fontWeight: "700" },
  sync: { color: palette.sage, fontSize: 12, fontWeight: "700" },
  story: { color: palette.ink, fontSize: 16, lineHeight: 26 },
  contribution: { gap: 6, borderTopColor: palette.line, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12 },
  contributionHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  contributionInput: { minHeight: 110 },
  author: { color: palette.coralDark, fontSize: 13, fontWeight: "800" },
  visibility: { color: palette.muted, fontSize: 11 },
  buttonRow: { flexDirection: "row", gap: 8 },
  grow: { flex: 1 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  chip: { minHeight: 48, justifyContent: "center", borderColor: palette.line, borderRadius: 21, borderWidth: 1, paddingHorizontal: 12 },
  chipActive: { backgroundColor: palette.softSage, borderColor: palette.sage },
  chipText: { color: palette.muted, fontSize: 12, fontWeight: "700" },
  chipTextActive: { color: palette.sage, fontSize: 12, fontWeight: "800" },
  counter: { color: palette.muted, fontSize: 11, textAlign: "right" },
  retry: { minHeight: 44, justifyContent: "center" },
  link: { color: palette.coralDark, fontWeight: "800" },
  });
}
