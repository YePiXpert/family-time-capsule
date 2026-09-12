import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePreventRemove } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { ActivityIndicator, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Text } from "../components/typography";
import { Button } from "../components/ui";
import { NativeMediaReader } from "../media/NativeMediaReader";
import { useAppActive } from "../media/use-app-active";
import type { RootStackParamList } from "../navigation/types";
import { useAppData } from "../state/AppContext";
import { useSharedStyles } from "../theme";
import { nativeReadingStore, nativeReadingTransport, readingDownloads, resolveReadingScope } from "../reading/native";
import { ReadingError, validateReadingManifest, type ReadingProgress, type ReadingScope } from "../reading/engine";
import type { ReadingManifest } from "../reading/types";
import { OwnerExitControl } from "../viewing/OwnerExitControl";
import { familyViewingPlaylist } from "../viewing/playlist";

type ViewingContent = { scope: ReadingScope; manifest: ReadingManifest; downloadKey: string | null; initialProgress: ReadingProgress };

export function FamilyViewingScreen({ route, navigation }: NativeStackScreenProps<RootStackParamList, "FamilyViewing">) {
  const s = useSharedStyles();
  const { credentials, online: connected, userId, family } = useAppData();
  const active = useAppActive();
  const connection = JSON.stringify([credentials?.serverUrl ?? null, credentials?.instanceId ?? null, credentials?.token ?? null]);
  const [entryConnection] = useState(connection);
  const [knownUser, setKnownUser] = useState(userId);
  const [knownFamily, setKnownFamily] = useState(family?.id ?? null);
  if (!knownUser && userId) setKnownUser(userId);
  if (!knownFamily && family?.id) setKnownFamily(family.id);
  const contextChanged = connection !== entryConnection || Boolean(knownUser && userId !== knownUser) || Boolean(knownFamily && family?.id !== knownFamily);
  const [content, setContent] = useState<ViewingContent | null>(null);
  const [verifiedOnline, setVerifiedOnline] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [exitAllowed, setExitAllowed] = useState(false);
  const [exitHint, setExitHint] = useState(false);
  const [closedByPermission, setClosedByPermission] = useState(false);
  const current = useRef<ViewingContent | null>(null);
  const withdrawn = useRef(false);
  const progress = useRef<ReadingProgress>({ chapter: 0, page: 0, media: {} });
  const { collectionId, downloadKey } = route.params;

  usePreventRemove(!exitAllowed, () => setExitHint(true));
  useEffect(() => { if (exitAllowed) navigation.goBack(); }, [exitAllowed, navigation]);
  const leave = useCallback(() => setExitAllowed(true), []);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function inspect() {
      if (!active) return;
      try {
        if (contextChanged || !credentials) throw new ReadingError("账号或家庭已变化，请由手机持有人退出后重新打开。", 403);
        if (withdrawn.current) return;
        const resolved = await resolveReadingScope(credentials, { offline: connected === false });
        if (!alive) return;
        const scope = resolved.scope;
        if (userId && userId !== scope.userId || family?.id && family.id !== scope.familyId)
          throw new ReadingError("相册与当前账号或家庭不一致，请退出后重新打开。", 403);
        if (current.current && current.current.scope.key !== scope.key)
          throw new ReadingError("当前阅读身份已变化，请退出后重新打开。", 403);
        const transport = nativeReadingTransport(credentials, scope);
        let key = current.current ? current.current.downloadKey : downloadKey ?? null;
        if (!current.current && !key) key = (await nativeReadingStore.list(scope.key)).find((row) => row.kind === "collection" && row.id === collectionId && row.state === "ready")?.key ?? null;
        if (!alive) return;
        let manifest: ReadingManifest;
        let online = resolved.online;
        if (key) {
          if (resolved.online) online = await readingDownloads.revalidate(scope, key, transport) === "online";
          const entry = await nativeReadingStore.get(key);
          if (!entry || entry.scope !== scope.key || entry.kind !== "collection" || entry.id !== collectionId || entry.state !== "ready")
            throw new ReadingError("这份相册的下载已不可用，请退出后重新打开。", 404);
          manifest = validateReadingManifest(entry.manifest);
          if (!current.current) progress.current = entry.progress;
        } else {
          if (!resolved.online) throw new ReadingError("这份相册尚未下载，联网后才能观看。", 0);
          manifest = await transport.manifest("collection", collectionId);
        }
        if (!alive) return;
        if (manifest.kind !== "collection" || manifest.id !== collectionId || manifest.userId !== scope.userId || manifest.familyId !== scope.familyId)
          throw new ReadingError("相册与当前阅读身份不一致。", 403);
        if (current.current && current.current.manifest.digest !== manifest.digest)
          throw new ReadingError("相册或来源已更新，请由持有人退出后重新打开。", 409);
        const next = current.current && current.current.downloadKey === key ? current.current : { scope, manifest, downloadKey: key, initialProgress: progress.current };
        current.current = next;
        setContent(next);
        setVerifiedOnline(online);
        setError("");
      } catch (reason) {
        if (!alive) return;
        const status = reason instanceof ReadingError ? reason.status : -1;
        if ([401, 403, 404, 409].includes(status)) { withdrawn.current = true; setClosedByPermission(true); }
        if (status !== 0 || !current.current) {
          current.current = null;
          setContent(null);
        }
        setVerifiedOnline(false);
        setError(reason instanceof Error ? reason.message : "暂时无法打开这份相册。");
      } finally {
        if (alive && active && !withdrawn.current) timer = setTimeout(() => void inspect(), 30_000);
      }
    }
    void inspect();
    return () => { alive = false; clearTimeout(timer); };
  }, [active, credentials, connected, collectionId, downloadKey, contextChanged, retry, userId, family?.id]);

  useEffect(() => readingDownloads.subscribe((removedKey) => {
    if (removedKey && removedKey === current.current?.downloadKey) {
      withdrawn.current = true;
      setClosedByPermission(true);
      current.current = null;
      setContent(null);
      setError("相册副本或阅读权限已撤下，请由持有人退出后重新打开。");
    }
  }), []);

  const playlist = useMemo(() => content ? familyViewingPlaylist(content.manifest, content.downloadKey, content.initialProgress.media) : [], [content]);
  const savePosition = useCallback((assetId: string, seconds: number) => {
    progress.current = { ...progress.current, media: { ...progress.current.media, [assetId]: seconds } };
    const key = current.current?.downloadKey;
    if (key) void readingDownloads.saveProgress(key, progress.current).catch(() => {});
  }, []);
  const visible = !contextChanged && content && (!userId || userId === content.scope.userId) && (!family?.id || family.id === content.scope.familyId) ? content : null;
  return <SafeAreaView style={[s.screen, { flex: 1 }]}>
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12 }}>
      <OwnerExitControl onExit={leave} />
      <Text style={s.body}>给家人看 · 仅观看</Text>
    </View>
    {visible && playlist.length > 0 ? <NativeMediaReader
      key={`${visible.scope.key}:${visible.manifest.digest}:${visible.downloadKey ?? "online"}`}
      assets={playlist}
      credentials={verifiedOnline && connected !== false ? credentials : null}
      viewingOnly
      viewingTitle={visible.manifest.title}
      onViewingExit={leave}
      onPosition={savePosition}
    /> : <View style={[s.empty, { flex: 1 }]}>
      {!error && !contextChanged && !content ? <ActivityIndicator color={s.colors.coral} /> : null}
      <Text style={s.emptyTitle}>{content && !playlist.length ? "相册里还没有可直接观看的内容" : "给家人看"}</Text>
      <Text accessibilityRole={error || contextChanged ? "alert" : undefined} style={s.emptyText}>
        {contextChanged ? "账号或家庭已变化，请由手机持有人退出后重新打开。" : error || (content ? "这里可观看照片、视频、声音和文字。" : "正在打开这份相册…")}
      </Text>
      {error && !contextChanged && !closedByPermission ? <Button title="重新打开相册" onPress={() => setRetry((value) => value + 1)} /> : null}
      {exitHint ? <Text style={s.body}>请长按左上角退出，再由手机持有人确认。</Text> : null}
    </View>}
  </SafeAreaView>;
}
