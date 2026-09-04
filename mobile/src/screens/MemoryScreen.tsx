import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { useVideoPlayer, VideoView } from "expo-video";
import { fetchMobileMemory } from "../api/client";
import { useApp } from "../state/AppContext";
import type { RootStackParamList } from "../navigation/types";
import {
  cacheMemoryDetail,
  getCachedMemoryDetail,
  listLocalMemoryMedia,
  type LocalMemoryMedia,
} from "../storage/database";
import { colors, sharedStyles } from "../theme";
import type { MobileMemory, MobileMemoryAsset } from "../types";
import { dateLabel } from "../utils/format";

type Props = NativeStackScreenProps<RootStackParamList, "Memory">;

export function MemoryScreen({ route }: Props) {
  const { credentials, events, family, online } = useApp();
  const [memory, setMemory] = useState<MobileMemory | null>(null);
  const [localMedia, setLocalMedia] = useState<LocalMemoryMedia[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const summary = events.find((event) => event.id === route.params.id);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [cached, archivedMedia] = await Promise.all([
      getCachedMemoryDetail(route.params.id),
      listLocalMemoryMedia(route.params.id),
    ]);
    setLocalMedia(archivedMedia);
    if (cached) setMemory(cached);
    if (credentials && online !== false) {
      try {
        const next = await fetchMobileMemory(credentials, route.params.id);
        await cacheMemoryDetail(next);
        setMemory(next);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "无法更新记忆详情。");
      }
    } else if (!cached) {
      setError("当前离线；这份记忆还没有在本机打开过。");
    }
    setLoading(false);
  }, [credentials, online, route.params.id]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  const title = memory?.title ?? summary?.title ?? "记忆详情";
  const occurredAt = memory?.occurredAt ?? summary?.occurredAt;
  const localCover = summary?.localCoverUri ?? null;
  const useLocalMedia = online === false || !credentials;
  return (
    <ScrollView contentContainerStyle={sharedStyles.content} style={sharedStyles.screen}>
      {localCover && !(useLocalMedia && localMedia.some((asset) => asset.mediaType === "image")) ? <Image source={{ uri: localCover }} style={styles.cover} /> : null}
      {useLocalMedia
        ? localMedia.map((asset) => <LocalMemoryMediaView asset={asset} key={asset.captureId} />)
        : memory?.assets.map((asset) => <MemoryMedia asset={asset} credentials={credentials} key={asset.id} />)}
      <View style={styles.heading}>
        <Text style={sharedStyles.eyebrow}>阅读记忆</Text>
        <Text style={sharedStyles.title}>{title}</Text>
        {occurredAt ? <Text style={styles.date}>{dateLabel(occurredAt, family?.timezone)}{memory?.ageLabel ?? summary?.ageLabel ? ` · ${memory?.ageLabel ?? summary?.ageLabel}` : ""}</Text> : null}
        {memory?.locationText ?? summary?.locationText ? <Text style={sharedStyles.intro}>地点 · {memory?.locationText ?? summary?.locationText}</Text> : null}
        <Text style={styles.sync}>{memory ? (online === false ? "本机缓存 · 当前离线" : "详情已同步到本机") : "读取中"}</Text>
      </View>

      {error ? <View style={sharedStyles.warning}><Text style={sharedStyles.warningText}>{error}</Text><Pressable onPress={() => void load()} style={styles.retry}><Text style={styles.link}>重试</Text></Pressable></View> : null}
      {loading && !memory ? <ActivityIndicator color={colors.coral} /> : null}

      {(memory?.sourceNotes.length ?? 0) > 0 ? <View style={sharedStyles.card}><Text style={sharedStyles.cardTitle}>当时写下的</Text>{memory!.sourceNotes.map((note) => <Text key={note.id} style={styles.story}>{note.text}</Text>)}</View> : null}
      {(memory?.contributions.length ?? 0) > 0 ? <View style={sharedStyles.card}><Text style={sharedStyles.cardTitle}>家人讲述</Text>{memory!.contributions.map((contribution) => <View key={contribution.id} style={styles.contribution}><Text style={styles.author}>{contribution.authorName}</Text><Text style={styles.story}>{contribution.text}</Text>{contribution.audioPath ? <AudioMedia credentials={credentials} path={contribution.audioPath} /> : null}</View>)}</View> : null}
      {(memory?.participants.length ?? summary?.participantNames.length ?? 0) > 0 ? <View style={sharedStyles.card}><Text style={sharedStyles.cardTitle}>在场的人</Text><Text style={sharedStyles.body}>{memory ? memory.participants.map((person) => person.displayName).join(" · ") : summary?.participantNames.join(" · ")}</Text></View> : null}
    </ScrollView>
  );
}

function sourceFor(credentials: ReturnType<typeof useApp>["credentials"], path: string) {
  return credentials ? { uri: `${credentials.serverUrl}${path}`, headers: { authorization: `Bearer ${credentials.token}` } } : null;
}

function MemoryMedia({ asset, credentials }: { asset: MobileMemoryAsset; credentials: ReturnType<typeof useApp>["credentials"] }) {
  const source = sourceFor(credentials, asset.mediaPath);
  if (!source) return null;
  if (asset.type === "image") return <Image accessibilityLabel={asset.filename} resizeMode="cover" source={source} style={styles.galleryImage} />;
  if (asset.type === "video") return <VideoMedia source={source} />;
  return <View style={sharedStyles.card}><Text style={styles.author}>{asset.filename}</Text><AudioMedia credentials={credentials} path={asset.mediaPath} /></View>;
}

function LocalMemoryMediaView({ asset }: { asset: LocalMemoryMedia }) {
  const source = { uri: asset.localUri };
  if (asset.mediaType === "image") {
    return <Image accessibilityLabel={asset.title} resizeMode="cover" source={source} style={styles.galleryImage} />;
  }
  if (asset.mediaType === "video") return <VideoMedia source={source} />;
  return <View style={sharedStyles.card}><Text style={styles.author}>{asset.title}</Text><AudioSourceMedia source={source} /></View>;
}

function AudioMedia({ credentials, path }: { credentials: ReturnType<typeof useApp>["credentials"]; path: string }) {
  const source = useMemo(() => sourceFor(credentials, path), [credentials, path]);
  return <AudioSourceMedia source={source} />;
}

function AudioSourceMedia({ source }: { source: { uri: string; headers?: Record<string, string> } | null }) {
  const player = useAudioPlayer(source);
  const status = useAudioPlayerStatus(player);
  return <Pressable accessibilityRole="button" onPress={() => status.playing ? player.pause() : player.play()} style={sharedStyles.secondaryButton}><Text style={sharedStyles.secondaryText}>{status.playing ? "暂停声音" : "播放声音"}</Text></Pressable>;
}

function VideoMedia({ source }: { source: { uri: string; headers?: Record<string, string> } }) {
  const player = useVideoPlayer(source);
  return <VideoView contentFit="contain" nativeControls player={player} style={styles.video} />;
}

const styles = StyleSheet.create({
  cover: { width: "100%", height: 250, borderRadius: 20, backgroundColor: colors.softCoral },
  galleryImage: { width: "100%", height: 300, borderRadius: 20, backgroundColor: colors.softCoral },
  video: { width: "100%", height: 240, borderRadius: 20, backgroundColor: "#1B1715" },
  heading: { gap: 6 },
  date: { color: colors.coralDark, fontSize: 14, fontWeight: "700" },
  sync: { color: colors.sage, fontSize: 12, fontWeight: "700" },
  story: { color: colors.ink, fontSize: 16, lineHeight: 26 },
  contribution: { gap: 6, borderTopColor: colors.line, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12 },
  author: { color: colors.coralDark, fontSize: 13, fontWeight: "800" },
  retry: { minHeight: 44, justifyContent: "center" },
  link: { color: colors.coralDark, fontWeight: "800" },
});
