import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Image, Modal, Pressable, ScrollView, View, useWindowDimensions } from "react-native";
import { Text } from "../components/typography";
import { Button, IconButton } from "../components/ui";
import { GlassSheet } from "../components/GlassSheet";
import { JournalIcon } from "../components/JournalIcon";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import type { Credentials } from "../types";
import type { ReaderAsset, ReaderTranscript, MediaDerivation } from "./types";
import { fetchMediaDerivations } from "../api/client";
import { exportOriginalCopy } from "./export-original";
import { useSharedStyles } from "../theme";
import { useAccessibleEffects } from "../design/use-effects";
import { NativeVideoPlayer } from "./NativeVideoPlayer";
import { derivationFailure, mediaRequestFailure, type PlaybackSource } from "./playback-source";
import { useAppActive } from "./use-app-active";
import { mediaClock, ReaderPlaybackControls, ReaderSwipeSurface } from "./ReaderChrome";
import { ReaderPhoto } from "./ReaderPhoto";
export type NativeReaderAsset = ReaderAsset & {
  localUri?: string;
  /** Confirmed original mapping from this account, never inferred from filenames. */
  remoteAssetId?: string;
  localTranscript?: ReaderTranscript | null;
  initialSeconds?: number;
  thumbnailPath?: string | null;
};
function mediaSource(
  credentials: Credentials | null,
  item: NativeReaderAsset,
  id = item.id,
) {
  return item.localUri && id === item.id
    ? { uri: item.localUri }
    : credentials
      ? {
          uri: `${credentials.serverUrl}/api/media/${encodeURIComponent(id)}`,
          headers: { Authorization: `Bearer ${credentials.token}` },
        }
      : null;
}
export function NativeMediaReader({
  assets,
  credentials,
  onPosition,
}: {
  onPosition?: (assetId: string, seconds: number) => void;
  assets: NativeReaderAsset[];
  credentials: Credentials | null;
}) {
  const s = useSharedStyles();
  const { reducedMotion } = useAccessibleEffects();
  const [index, setIndex] = useState<number | null>(null),
    [continuous, setContinuous] = useState(false);
  const [readingAssets, setReadingAssets] = useState<NativeReaderAsset[]>([]);
  const [moreVisible, setMoreVisible] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const filmstrip = useRef<FlatList<{ asset: NativeReaderAsset; slot: number }>>(null);
  const [blockedPreviews, setBlockedPreviews] = useState<string[]>([]);
  const permissionChanged = useCallback((assetId: string, denied: boolean) => {
    setBlockedPreviews((current) => denied
      ? current.includes(assetId) ? current : [...current, assetId]
      : current.includes(assetId) ? current.filter((id) => id !== assetId) : current);
  }, []);
  const visibleAssets = readingAssets.flatMap((asset, slot) => assets.some((candidate) => sameReaderAsset(candidate, asset)) ? [{ asset, slot }] : []);
  const selected = index === null ? null : readingAssets[index] ?? null;
  const visibleIndex = visibleAssets.findIndex((entry) => entry.slot === index);
  const removed = selected && visibleIndex < 0;
  const latestLocal = selected?.localUri
    ? assets.find((candidate) => candidate.id === selected.id && candidate.localUri === selected.localUri) : undefined;
  const item = removed ? null : selected && latestLocal
    ? { ...selected, remoteAssetId: latestLocal.remoteAssetId } : selected;
  // A reordered list preserves reading, but removal/revocation must close it permanently.
  if (removed && index !== null) setIndex(null);
  const ended = useCallback(() => {
    if (!continuous || index === null) return;
    const next = readingAssets.findIndex((a, i) => i > index && a.type === "audio" && assets.some((candidate) => sameReaderAsset(candidate, a)));
    if (next >= 0) setIndex(next);
  }, [assets, readingAssets, continuous, index]);
  const navigate = useCallback((direction: -1 | 1) => {
    setIndex((current) => {
      const available = readingAssets.flatMap((asset, slot) => assets.some((candidate) => sameReaderAsset(candidate, asset)) ? [slot] : []);
      const position = current === null ? -1 : available.indexOf(current);
      return position < 0 ? current : available[position + direction] ?? current;
    });
    setMoreVisible(false);
    setControlsVisible(true);
  }, [assets, readingAssets]);
  useEffect(() => {
    if (index !== null) filmstrip.current?.scrollToOffset({ offset: Math.max(0, visibleIndex * 72 - 100), animated: !reducedMotion });
  }, [index, visibleIndex, reducedMotion, controlsVisible]);
  return (
    <>
      {assets.map((asset, i) => (
        <Pressable
          key={`${asset.id}-${i}`}
          accessibilityRole="button"
          accessibilityLabel={`打开阅读器：${asset.filename}`}
          onPress={() => {
            // Sync may reorder or reconcile local IDs while a reader is open.
            setReadingAssets(assets.map((value) => ({ ...value })));
            setMoreVisible(false);
            setControlsVisible(true);
            setIndex(i);
          }}
          style={s.card}
        >
          {thumbnailSource(credentials, asset, blockedPreviews.includes(asset.id)) ? (
            <Image accessibilityLabel={asset.type === "video" ? `${asset.filename}，视频封面` : asset.filename} source={thumbnailSource(credentials, asset, blockedPreviews.includes(asset.id))!} style={{ width: "100%", height: 250, resizeMode: "contain" }} />
          ) : null}
          <Text style={s.cardTitle}>{asset.filename}</Text>
          <Text style={s.body}>
            {asset.author ||
              (asset.type === "video"
                ? "打开视频"
                : asset.type === "audio"
                  ? "播放家人的声音"
                  : "全屏阅读")}
          </Text>
        </Pressable>
      ))}
      <Modal
        visible={item !== null}
        onRequestClose={() => setIndex(null)}
        animationType={reducedMotion ? "none" : "fade"}
      >
        <SafeAreaView style={[s.screen, { flex: 1 }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: s.colors.line }}>
            <Button title="返回" icon="arrow-left" variant="ghost" full={false} accessibilityLabel="关闭阅读器" onPress={() => setIndex(null)} />
            <View style={{ flex: 1, minWidth: 0, opacity: controlsVisible ? 1 : 0 }}>
              <Text numberOfLines={1} style={{ color: s.colors.ink, fontSize: 14, textAlign: "center" }}>{item?.dateLabel || item?.author || "这一刻"}</Text>
            </View>
            <Button title="更多" variant="ghost" full={false} accessibilityLabel="更多素材操作" onPress={() => setMoreVisible(true)} />
          </View>
          {item ? (
            <Active
              key={item.id}
              item={item}
              credentials={credentials}
              continuous={continuous}
              toggleContinuous={() => setContinuous((value) => !value)}
              onEnded={ended}
              onPosition={onPosition}
              moreVisible={moreVisible}
              onMoreClose={() => setMoreVisible(false)}
              controlsVisible={controlsVisible}
              onToggleControls={() => setControlsVisible((value) => !value)}
              onNavigate={navigate}
              onPermissionChange={permissionChanged}
            />
          ) : null}
          {controlsVisible && visibleAssets.length > 1 ? <View style={{ borderTopWidth: 1, borderTopColor: s.colors.line, backgroundColor: s.colors.paper }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12 }}>
              <Button title="上一份" variant="ghost" full={false} disabled={visibleIndex <= 0} onPress={() => navigate(-1)} />
              <Text style={{ color: s.colors.muted, fontSize: 13 }}>{visibleIndex + 1} / {visibleAssets.length}</Text>
              <Button title="下一份" variant="ghost" full={false} disabled={visibleIndex < 0 || visibleIndex === visibleAssets.length - 1} onPress={() => navigate(1)} />
            </View>
            <FlatList
              ref={filmstrip}
              horizontal
              data={visibleAssets}
              keyExtractor={({ asset, slot }) => `${asset.id}-${slot}`}
              extraData={[index, blockedPreviews]}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 8, gap: 8 }}
              style={{ flexGrow: 0 }}
              getItemLayout={(_data, i) => ({ length: 72, offset: i * 72, index: i })}
              renderItem={({ item: entry }) => <ReaderThumbnail asset={entry.asset} credentials={credentials} selected={entry.slot === index} hideRemotePreview={blockedPreviews.includes(entry.asset.id)} onPress={() => { setIndex(entry.slot); setMoreVisible(false); }} />}
            />
          </View> : null}
        </SafeAreaView>
      </Modal>
    </>
  );
}
function Active({
  item,
  credentials,
  continuous,
  toggleContinuous,
  onEnded,
  onPosition,
  moreVisible, onMoreClose, controlsVisible, onToggleControls, onNavigate, onPermissionChange,
}: {
  onPermissionChange: (assetId: string, denied: boolean) => void;
  moreVisible: boolean;
  onMoreClose: () => void;
  controlsVisible: boolean;
  onToggleControls: () => void;
  onNavigate: (direction: -1 | 1) => void;
  onPosition?: (assetId: string, seconds: number) => void;
  item: NativeReaderAsset;
  credentials: Credentials | null;
  continuous: boolean;
  toggleContinuous: () => void;
  onEnded: () => void;
}) {
  const s = useSharedStyles();
  const remoteId = item.remoteAssetId || item.id;
  const canReadRemote = !item.localUri || Boolean(item.remoteAssetId);
  const [jobState, setJobState] = useState<{ assetId: string; jobs: MediaDerivation[] }>({ assetId: remoteId, jobs: [] }),
    [transcript, setTranscript] = useState<ReaderTranscript | null>(
      item.localTranscript ?? null,
    ),
    [error, setError] = useState(""),
    [denied, setDenied] = useState(false),
    [original, setOriginal] = useState(false),
    [zoom, setZoom] = useState(1),
    [retry, setRetry] = useState(0);
  const { height } = useWindowDimensions();
  const [audioSpeed, setAudioSpeed] = useState(1);
  const [imageFailure, setImageFailure] = useState<{ key: string; message: string } | null>(null);
  const audioController = useRef<{ seekTo: (seconds: number) => Promise<void> } | null>(null);
  const receiveAudioController = useCallback((controller: { seekTo: (seconds: number) => Promise<void> } | null) => { audioController.current = controller; }, []);
  const compatibilityRequested = useRef(false);
  const jobs = jobState.assetId === remoteId ? jobState.jobs : [];
  const [metadataLoaded, setMetadataLoaded] = useState(Boolean(item.localUri && !item.remoteAssetId));
  const [generating, setGenerating] = useState(false);
  const [jobsRevision, setJobsRevision] = useState(0);
  const appActive = useAppActive();
  const requests = useRef(new Set<AbortController>());
  const serverUrl = credentials?.serverUrl;
  const token = credentials?.token;
  useEffect(() => {
    if (!serverUrl || !token || !canReadRemote || !appActive) return;
    const auth = { serverUrl, token };
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function load(first = false) {
      try {
        let data = await fetchMediaDerivations(auth, remoteId, undefined, controller.signal);
        if (controller.signal.aborted) return;
        setJobState({ assetId: remoteId, jobs: data.jobs });
        setTranscript(data.transcript);
        setMetadataLoaded(true);
        setError("");
        setDenied(false);
        onPermissionChange(item.id, false);
        if (first && ["image", "video"].includes(item.type) && !data.jobs.some((job) => job.kind === "preview")) {
          data = await fetchMediaDerivations(auth, remoteId, "preview", controller.signal);
          if (controller.signal.aborted) return;
          setJobState({ assetId: remoteId, jobs: data.jobs });
        }
        if (data.jobs.some((job) => ["queued", "running"].includes(job.status)))
          timer = setTimeout(() => void load(), 2000);
      } catch (e) {
        if (controller.signal.aborted) return;
        const status = (e as { status?: number }).status;
        onPermissionChange(item.id, status === 401 || status === 403 || status === 404);
        setDenied(!item.localUri && (status === 401 || status === 403 || status === 404));
        // An owned local original stays readable if the remote account or network is unavailable.
        if (item.localUri) setJobState({ assetId: remoteId, jobs: [] });
        setError(item.localUri ? "" : mediaRequestFailure(e).message);
        // An unavailable metadata endpoint must not prevent readable originals from loading.
        setMetadataLoaded(true);
      }
    }
    void load(true);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [serverUrl, token, remoteId, canReadRemote, item.id, item.localUri, item.type, retry, jobsRevision, appActive, onPermissionChange]);
  useEffect(() => {
    const pending = requests.current;
    if (!appActive) {
      pending.forEach((request) => request.abort());
    }
    return () => pending.forEach((request) => request.abort());
  }, [appActive, remoteId, serverUrl, token]);
  const preview = jobs.find((j) => j.kind === "preview"),
    transcode = jobs.find((j) => j.kind === "transcode"),
    waveform = jobs.find((j) => j.kind === "waveform");
  const selectedId = original || item.localUri && (!credentials || !canReadRemote)
    ? item.id
    : item.type === "image"
      ? preview?.outputAssetId || item.thumbnailId || item.id
      : transcode?.outputAssetId || item.id;
  const source = mediaSource(credentials, item, selectedId);
  async function generate(kind: MediaDerivation["kind"]) {
    if (!credentials || !canReadRemote || !appActive) return;
    const controller = new AbortController();
    requests.current.add(controller);
    if (kind === "transcode") setGenerating(true);
    setError("");
    try {
      const data = await fetchMediaDerivations(credentials, remoteId, kind, controller.signal);
      if (controller.signal.aborted) return;
      setJobState({ assetId: remoteId, jobs: data.jobs });
      setJobsRevision((value) => value + 1);
    } catch (e) {
      if (!controller.signal.aborted)
        setError((e as { code?: string }).code === "derivative_quota"
          ? derivationFailure("derivative_quota") : mediaRequestFailure(e).message);
    } finally {
      requests.current.delete(controller);
      if (kind === "transcode") setGenerating(false);
    }
  }
  function playbackFailed() {
    if (!credentials || !canReadRemote || compatibilityRequested.current || transcode) return;
    compatibilityRequested.current = true;
    void generate("transcode");
  }
  function retryVideo() {
    setError("");
    if (!transcode || transcode.status === "failed") compatibilityRequested.current = false;
    if (transcode?.status === "failed") void generate("transcode");
    else setRetry((value) => value + 1);
  }
  const processingVideo = generating || transcode?.status === "queued" || transcode?.status === "running";
  const poster = denied ? null : preview?.outputAssetId
    ? mediaSource(credentials, { ...item, localUri: undefined }, preview.outputAssetId)
    : thumbnailSource(credentials, item);
  const retryMedia = () => { setError(""); setImageFailure(null); setRetry((value) => value + 1); };
  return (
    <View style={{ flex: 1, minHeight: 0 }}>
      {item.type === "video" ? (
        <NativeVideoPlayer
          source={!denied && (metadataLoaded || item.localUri && !credentials) ? source : null}
          localOriginal={Boolean(item.localUri && selectedId === item.id)}
          remoteOriginal={item.remoteAssetId ? mediaSource(credentials, { ...item, localUri: undefined }, item.remoteAssetId) : null}
          onUnsupported={playbackFailed}
          onRetry={retryVideo}
          retryToken={retry}
          initialSeconds={item.initialSeconds}
          onPosition={onPosition ? (seconds) => onPosition(item.id, seconds) : undefined}
          externalError={error || (transcode?.status === "failed" ? derivationFailure(transcode.errorCode) : !source ? "请先连接家庭服务器后播放。" : "")}
          message={processingVideo ? "正在准备兼容播放版，完成后会自动切换。" : undefined}
          poster={poster}
          controlsVisible={controlsVisible}
          onToggleControls={onToggleControls}
          onNavigate={onNavigate}
        />
      ) : item.type === "image" ? (
        <ReaderPhoto key={`${selectedId}-${retry}`} source={denied ? null : source} filename={item.filename} zoom={zoom} error={denied ? error : imageFailure?.key === `${selectedId}-${retry}` ? imageFailure.message : undefined}
          onError={() => setImageFailure({ key: `${selectedId}-${retry}`, message: "照片暂时无法读取，请重新加载。" })}
          onRetry={retryMedia} controlsVisible={controlsVisible} onToggleControls={onToggleControls} onNavigate={onNavigate} />
      ) : !denied && source && item.type === "audio" ? (
        <Audio key={`${selectedId}-${retry}`} source={source} continuous={continuous} onEnded={onEnded} transcript={transcript}
          speed={audioSpeed} onController={receiveAudioController} onRetry={retryMedia} controlsVisible={controlsVisible} onToggleControls={onToggleControls} onNavigate={onNavigate}
          initialSeconds={item.initialSeconds} onPosition={onPosition ? (seconds) => onPosition(item.id, seconds) : undefined} />
      ) : (
        <ReaderSwipeSurface onNavigate={onNavigate}>
          <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 28, gap: 20 }}>
            <JournalIcon name={item.type === "audio" ? "audio" : "file"} size={64} color={s.colors.coral} />
            <Text style={s.cardTitle}>{item.type === "document" ? "这份家庭资料" : "暂时无法读取"}</Text>
            <Text accessibilityRole={error ? "alert" : undefined} style={error ? s.error : s.body}>{error || "从右上角“更多”导出原件，即可用本机应用打开。"}</Text>
            {error ? <Button title="重新加载" onPress={retryMedia} /> : null}
          </View>
        </ReaderSwipeSurface>
      )}
      <GlassSheet visible={moreVisible} onClose={onMoreClose}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <Text accessibilityRole="header" style={s.cardTitle}>素材信息</Text>
          <IconButton icon="close" label="关闭更多操作" onPress={onMoreClose} />
        </View>
        <ScrollView style={{ maxHeight: height * 0.64 }} contentContainerStyle={{ gap: 16, paddingBottom: 16 }}>
          <View style={{ gap: 6 }}>
            <Text selectable style={s.label}>{item.filename}</Text>
            {[item.dateLabel, item.author].filter(Boolean).map((value, i) => <Text key={i} style={s.body}>{value}</Text>)}
            {item.durationMs ? <Text style={s.body}>时长 {mediaClock(item.durationMs / 1000)}</Text> : null}
            <Text style={s.body}>{item.localUri ? "本机原件" : "家庭资料"}{item.mimeType ? ` · ${item.mimeType}` : ""}</Text>
          </View>
          {error ? <Text accessibilityRole="alert" style={s.error}>{error}</Text> : null}
          <Button title="导出原件副本" icon="download" disabled={denied} onPress={() => void exportOriginalCopy(item, credentials).catch((reason) => setError((reason as Error).message))} />
          {item.type === "image" ? <>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              <Button title="放大" full={false} disabled={zoom >= 4} onPress={() => setZoom((value) => Math.min(4, value + 0.5))} />
              <Button title="缩小" full={false} disabled={zoom <= 1} onPress={() => setZoom((value) => Math.max(1, value - 0.5))} />
              <Button title="适合屏幕" full={false} onPress={() => setZoom(1)} />
            </View>
            {!item.localUri ? <Button title="加载原图" disabled={denied || original} onPress={() => { setOriginal(true); setError(""); onMoreClose(); }} /> : null}
          </> : null}
          {canReadRemote && ["video", "audio"].includes(item.type) ? <Button title="准备兼容播放版" disabled={denied || processingVideo || !credentials} onPress={() => void generate("transcode")} /> : null}
          {item.type === "audio" ? <>
            <Text style={s.cardTitle}>声音详情</Text>
            <Button title={`播放速度 ${audioSpeed}×`} onPress={() => { const speeds = [0.75, 1, 1.25, 1.5, 2]; setAudioSpeed(speeds[(speeds.indexOf(audioSpeed) + 1) % speeds.length]!); }} />
            <Button title={continuous ? "关闭连续播放" : "连续播放下一段声音"} onPress={toggleContinuous} />
            {canReadRemote ? <Button title="生成声音波形" disabled={denied || !credentials || waveform?.status === "queued" || waveform?.status === "running"} onPress={() => void generate("waveform")} /> : null}
            {waveform?.outputAssetId && !denied ? <Image source={mediaSource(credentials, { ...item, localUri: undefined }, waveform.outputAssetId)!} accessibilityLabel="声音波形" style={{ width: "100%", height: 100, resizeMode: "contain" }} /> : null}
            {transcript?.segments.map((segment, i) => <Button key={i} title={`${mediaClock(segment.startSeconds)} · ${segment.text}`} onPress={() => { void audioController.current?.seekTo(segment.startSeconds); onMoreClose(); }} />)}
          </> : null}
          {jobs.filter((job) => job.status !== "succeeded").map((job) => <Text key={job.kind} style={job.status === "failed" ? s.error : s.body}>
            {{ preview: "封面", transcode: "兼容播放版", waveform: "声音波形" }[job.kind]}：{job.status === "failed" ? derivationFailure(job.errorCode) : job.status === "queued" ? "等待处理" : "正在处理"}
          </Text>)}
          <Button title="重新加载" onPress={item.type === "video" ? retryVideo : retryMedia} />
        </ScrollView>
      </GlassSheet>
    </View>
  );
}

function Audio({
  source, continuous, onEnded, transcript, initialSeconds = 0, onPosition, speed,
  onController, controlsVisible, onToggleControls, onNavigate, onRetry,
}: {
  initialSeconds?: number;
  onPosition?: (seconds: number) => void;
  source: PlaybackSource;
  continuous: boolean;
  onEnded: () => void;
  transcript: ReaderTranscript | null;
  speed: number;
  onController: (controller: { seekTo: (seconds: number) => Promise<void> } | null) => void;
  controlsVisible: boolean;
  onToggleControls: () => void;
  onNavigate: (direction: -1 | 1) => void;
  onRetry: () => void;
}) {
  const s = useSharedStyles();
  const player = useAudioPlayer(source);
  const status = useAudioPlayerStatus(player);
  const [error, setError] = useState("");
  const appActive = useAppActive(() => player.pause());
  const restored = useRef(false);
  useEffect(() => {
    if (status.isLoaded && !restored.current) {
      restored.current = true;
      if (initialSeconds > 0) void player.seekTo(Math.min(initialSeconds, status.duration)).catch(() => setError("无法恢复播放位置，可拖动进度条定位。"));
    }
  }, [initialSeconds, player, status.isLoaded, status.duration]);
  usePlaybackProgress(status.currentTime, status.isLoaded && (initialSeconds === 0 || status.currentTime > 0), onPosition);
  const finish = useRef(false);
  const autoStarted = useRef(false);
  useEffect(() => {
    if (status.didJustFinish && !finish.current) { finish.current = true; onEnded(); }
    else if (!status.didJustFinish) finish.current = false;
  }, [status.didJustFinish, onEnded]);
  useEffect(() => {
    if (continuous && appActive && status.isLoaded && !autoStarted.current) {
      autoStarted.current = true;
      player.play();
    }
  }, [appActive, continuous, status.isLoaded, player]);
  useEffect(() => { player.setPlaybackRate(speed); }, [player, speed]);
  const seekTo = useCallback(async (value: number) => {
    if (!Number.isFinite(value) || value < 0 || value > status.duration) return;
    try { await player.seekTo(value); setError(""); }
    catch { setError("暂时无法定位，请重试。"); }
  }, [player, status.duration]);
  useEffect(() => { onController({ seekTo }); return () => onController(null); }, [onController, seekTo]);
  async function toggleAudio() {
    if (status.playing) { player.pause(); return; }
    if (status.error) { onRetry(); return; }
    if (!status.isLoaded) return;
    if (status.didJustFinish || status.currentTime >= status.duration) await seekTo(0);
    player.play();
  }
  return (
    <View style={{ flex: 1, minHeight: 0 }}>
      <ReaderSwipeSurface onNavigate={onNavigate}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: 28, gap: 24 }}>
          <Pressable accessibilityRole="button" accessibilityLabel={controlsVisible ? "收起观看工具" : "显示观看工具"} onPress={onToggleControls} style={{ alignItems: "center", paddingVertical: 12, gap: 16 }}>
            <View style={{ width: 112, height: 112, borderRadius: 56, alignItems: "center", justifyContent: "center", backgroundColor: s.colors.softCoral }}><JournalIcon name="microphone" size={52} color={s.colors.coral} /></View>
            <Text style={s.cardTitle}>家人的声音</Text>
          </Pressable>
          {!status.isLoaded || status.isBuffering ? <ActivityIndicator color={s.colors.coral} /> : null}
          {status.error || error ? <View style={{ gap: 12 }}><Text style={s.error} accessibilityRole="alert">{status.error ? "这段声音暂时无法播放，请重试。" : error}</Text><Button title="重试声音" onPress={onRetry} /></View> : null}
          {transcript ? <View style={{ gap: 8 }}><Text selectable style={{ color: s.colors.ink, fontSize: 18, lineHeight: 30 }}>{transcript.text}</Text>{transcript.edited ? <Text style={s.body}>已由家人修订</Text> : null}</View> : null}
        </ScrollView>
      </ReaderSwipeSurface>
      {controlsVisible ? <ReaderPlaybackControls kind="audio" playing={status.playing} muted={status.mute} seconds={status.currentTime} duration={status.duration} disabled={!status.isLoaded}
        onPlayPause={() => void toggleAudio()} onSeek={(value) => void seekTo(value)} onMute={() => setAudioMuted(player, !status.mute)} /> : null}
    </View>
  );
}
function setAudioMuted(player: { muted: boolean }, muted: boolean) { player.muted = muted; }

function sameReaderAsset(candidate: NativeReaderAsset, original: NativeReaderAsset) {
  return Boolean(candidate.id === original.id || original.localUri && candidate.localUri === original.localUri || original.remoteAssetId && candidate.id === original.remoteAssetId);
}
function thumbnailSource(credentials: Credentials | null, asset: NativeReaderAsset, hideRemotePreview = false): PlaybackSource | null {
  if (asset.type === "image" && asset.localUri) return { uri: asset.localUri };
  if (hideRemotePreview) return null;
  if (!credentials) return null;
  if (asset.thumbnailPath) return { uri: `${credentials.serverUrl}${asset.thumbnailPath}`, headers: { Authorization: `Bearer ${credentials.token}` } };
  if (asset.thumbnailId) return mediaSource(credentials, { ...asset, localUri: undefined }, asset.thumbnailId);
  return asset.type === "image" ? mediaSource(credentials, asset) : null;
}
function ReaderThumbnail({ asset, credentials, selected, hideRemotePreview, onPress }: { asset: NativeReaderAsset; credentials: Credentials | null; selected: boolean; hideRemotePreview: boolean; onPress: () => void }) {
  const s = useSharedStyles();
  const source = thumbnailSource(credentials, asset, hideRemotePreview);
  const sourceKey = JSON.stringify(source);
  const [failedSource, setFailedSource] = useState<string | null>(null);
  return <Pressable accessibilityRole="button" accessibilityLabel={`查看${asset.filename}`} accessibilityState={{ selected }} onPress={onPress}
    style={{ width: 64, height: 64, borderRadius: 10, borderWidth: 2, borderColor: selected ? s.colors.coral : s.colors.line, backgroundColor: s.colors.card, overflow: "hidden", alignItems: "center", justifyContent: "center" }}>
    {source && failedSource !== sourceKey ? <Image source={source} resizeMode="cover" onError={() => setFailedSource(sourceKey)} style={{ position: "absolute", inset: 0 }} /> : <JournalIcon name={asset.type === "image" ? "image" : asset.type === "video" ? "video" : asset.type === "audio" ? "microphone" : "file"} color={s.colors.coral} size={24} />}
    {asset.type === "video" && source && failedSource !== sourceKey ? <View style={{ position: "absolute", right: 2, bottom: 2, borderRadius: 12, padding: 3, backgroundColor: s.colors.card }}><JournalIcon name="play" color={s.colors.ink} size={13} /></View> : null}
  </Pressable>;
}
/** Persist bounded updates and the final observed position without restarting playback. */
function usePlaybackProgress(
  seconds: number,
  ready: boolean,
  save?: (seconds: number) => void,
) {
  const latest = useRef({ seconds: 0, ready: false, save });
  const last = useRef(-1);
  useEffect(() => {
    latest.current = { seconds, ready, save };
    if (
      ready &&
      Number.isFinite(seconds) &&
      seconds >= 0 &&
      Math.abs(seconds - last.current) >= 2
    ) {
      last.current = seconds;
      save?.(seconds);
    }
  }, [seconds, ready, save]);
  useEffect(
    () => () => {
      const v = latest.current;
      if (v.ready) v.save?.(v.seconds);
    },
    [],
  );
}
