import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, View, useWindowDimensions,  } from "react-native";
import { Text, TextInput } from "../components/typography";
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
export type NativeReaderAsset = ReaderAsset & {
  localUri?: string;
  /** Confirmed original mapping from this account, never inferred from filenames. */
  remoteAssetId?: string;
  localTranscript?: ReaderTranscript | null;
  initialSeconds?: number;
  thumbnailPath?: string | null;
};
function Button({
  title,
  onPress,
  disabled = false,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const s = useSharedStyles();
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[s.secondaryButton, disabled && s.disabled]}
    >
      <Text style={s.secondaryText}>{title}</Text>
    </Pressable>
  );
}
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
  const selected = index === null ? null : readingAssets[index];
  const removed = selected && !assets.some((candidate) => candidate.id === selected.id ||
    selected.localUri && candidate.localUri === selected.localUri ||
    selected.remoteAssetId && candidate.id === selected.remoteAssetId);
  const latestLocal = selected?.localUri
    ? assets.find((candidate) => candidate.id === selected.id && candidate.localUri === selected.localUri) : undefined;
  const item = removed ? null : selected && latestLocal
    ? { ...selected, remoteAssetId: latestLocal.remoteAssetId } : selected;
  // A reordered list preserves reading, but removal/revocation must close it permanently.
  if (removed && index !== null) setIndex(null);
  const ended = useCallback(() => {
    if (!continuous || index === null) return;
    const next = readingAssets.findIndex((a, i) => i > index && a.type === "audio");
    if (next >= 0) setIndex(next);
  }, [readingAssets, continuous, index]);
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
            setIndex(i);
          }}
          style={s.card}
        >
          {asset.type === "image" ? (
            <Image
              accessibilityLabel={asset.filename}
              source={
                asset.localUri
                  ? { uri: asset.localUri }
                  : credentials
                    ? {
                        uri: `${credentials.serverUrl}${asset.thumbnailPath || `/api/media/${encodeURIComponent(asset.thumbnailId || asset.id)}`}`,
                        headers: {
                          Authorization: `Bearer ${credentials.token}`,
                        },
                      }
                    : undefined
              }
              style={{ width: "100%", height: 250, resizeMode: "contain" }}
            />
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
        <SafeAreaView style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={s.content}>
            <Button title="关闭阅读器" onPress={() => setIndex(null)} />
            <Text style={s.body} accessibilityLiveRegion="polite">
              {index === null ? 0 : index + 1} / {readingAssets.length}
            </Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Button
                title="上一份"
                disabled={index === null || index === 0}
                onPress={() => setIndex((i) => (i === null ? null : i - 1))}
              />
              <Button
                title="下一份"
                disabled={index === null || index === readingAssets.length - 1}
                onPress={() => setIndex((i) => (i === null ? null : i + 1))}
              />
            </View>
            {item ? (
              <Active
                key={item.id}
                item={item}
                credentials={credentials}
                continuous={continuous}
                toggleContinuous={() => setContinuous((v) => !v)}
                onEnded={ended}
                onPosition={onPosition}
              />
            ) : null}
          </ScrollView>
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
}: {
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
  const { width } = useWindowDimensions();
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
  }, [serverUrl, token, remoteId, canReadRemote, item.localUri, item.type, retry, jobsRevision, appActive]);
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
  return (
    <>
      <Text style={s.title}>{item.filename}</Text>
      <Text style={s.body}>
        {[
          item.author,
          item.dateLabel,
          item.durationMs ? `${(item.durationMs / 1000).toFixed(1)} 秒` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </Text>
      {error && item.type !== "video" ? (
        <Text accessibilityRole="alert" style={s.error}>
          {error}
        </Text>
      ) : null}
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
          message={processingVideo ? "正在准备兼容播放版，原视频已保留。完成后会自动切换。" : undefined}
          poster={denied ? null : preview?.outputAssetId ? mediaSource(credentials, { ...item, localUri: undefined }, preview.outputAssetId) : item.thumbnailId ? mediaSource(credentials, { ...item, localUri: undefined }, item.thumbnailId) : null}
        />
      ) : !denied && source ? (
        item.type === "image" ? (
          <>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              <Button
                title="放大"
                disabled={zoom >= 4}
                onPress={() => setZoom((v) => Math.min(4, v + 0.5))}
              />
              <Button
                title="缩小"
                disabled={zoom <= 1}
                onPress={() => setZoom((v) => Math.max(1, v - 0.5))}
              />
              <Button title="适合屏幕" onPress={() => setZoom(1)} />
              <Button title="按需加载原图" onPress={() => setOriginal(true)} />
            </View>
            <ScrollView
              horizontal
              nestedScrollEnabled
              style={{ maxHeight: 600 }}
            >
              <ScrollView
                nestedScrollEnabled
                minimumZoomScale={1}
                maximumZoomScale={4}
              >
                <Image
                  key={`${selectedId}-${retry}`}
                  accessibilityLabel={item.filename}
                  source={source}
                  resizeMode="contain"
                  onError={() => setError("图片无法预览，可重试加载原图。")}
                  style={{
                    width: Math.max(280, width - 36) * zoom,
                    height: 450 * zoom,
                  }}
                />
              </ScrollView>
            </ScrollView>
          </>
        ) : item.type === "audio" ? (
          <Audio
            key={`${selectedId}-${retry}`}
            source={source}
            continuous={continuous}
            toggleContinuous={toggleContinuous}
            onEnded={onEnded}
            transcript={transcript}
            initialSeconds={item.initialSeconds}
            onPosition={
              onPosition ? (seconds) => onPosition(item.id, seconds) : undefined
            }
          />
        ) : (
          <Text style={s.body}>
            {item.localUri
              ? "文档已下载，使用下方导出按钮在本机应用中阅读。"
              : "文档请在来源记忆中下载阅读。"}
          </Text>
        )
      ) : null}
      {canReadRemote && ["video", "audio"].includes(item.type) ? (
        <>
          <Button
            title="生成兼容播放版"
            disabled={processingVideo}
            onPress={() => void generate("transcode")}
          />
          <Button
            title="生成声音波形"
            onPress={() => void generate("waveform")}
          />
        </>
      ) : null}
      {waveform?.outputAssetId && !denied ? (
        <Image
          source={mediaSource(
            credentials,
            { ...item, localUri: undefined },
            waveform.outputAssetId,
          )!}
          accessibilityLabel="声音波形（最多前五分钟）"
          style={{ width: "100%", height: 100, resizeMode: "contain" }}
        />
      ) : null}
      {jobs
        .filter((j) => j.status !== "succeeded" && (item.type !== "video" || j.kind === "waveform"))
        .map((j) => (
          <Text key={j.kind} style={s.body}>
            {j.status === "failed"
              ? "处理失败或缺编解码器，原件仍在。"
              : "阅读衍生物等待后台处理。"}
          </Text>
        ))}
      <Button
        title="导出原件副本"
        disabled={denied}
        onPress={() =>
          void exportOriginalCopy(item, credentials).catch((e) =>
            setError((e as Error).message),
          )
        }
      />
      <Button title="重新加载" onPress={() => setRetry((v) => v + 1)} />
    </>
  );
}
function Audio({
  source,
  continuous,
  toggleContinuous,
  onEnded,
  transcript,
  initialSeconds = 0,
  onPosition,
}: {
  initialSeconds?: number;
  onPosition?: (seconds: number) => void;
  source: PlaybackSource;
  continuous: boolean;
  toggleContinuous: () => void;
  onEnded: () => void;
  transcript: ReaderTranscript | null;
}) {
  const s = useSharedStyles();
  const player = useAudioPlayer(source),
    status = useAudioPlayerStatus(player);
  const [seek, setSeek] = useState(""),
    [error, setError] = useState(""),
    [speed, setSpeed] = useState(1);
  const restored = useRef(false);
  useEffect(() => {
    if (status.isLoaded && !restored.current) {
      restored.current = true;
      if (initialSeconds > 0)
        void player
          .seekTo(Math.min(initialSeconds, status.duration))
          .catch(() => setError("无法恢复播放位置，可手动定位。"));
    }
  }, [initialSeconds, player, status.isLoaded, status.duration]);
  usePlaybackProgress(
    status.currentTime,
    status.isLoaded && (initialSeconds === 0 || status.currentTime > 0),
    onPosition,
  );
  const finish = useRef(false),
    autoStarted = useRef(false);
  useEffect(() => {
    if (status.didJustFinish && !finish.current) {
      finish.current = true;
      onEnded();
    } else if (!status.didJustFinish) finish.current = false;
  }, [status.didJustFinish, onEnded]);
  useEffect(() => {
    if (continuous && status.isLoaded && !autoStarted.current) {
      autoStarted.current = true;
      player.play();
    }
  }, [continuous, status.isLoaded, player]);
  async function seekTo(value: number) {
    if (!Number.isFinite(value) || value < 0 || value > status.duration) {
      setError("请输入录音时长内的秒数。");
      return;
    }
    try {
      await player.seekTo(value);
      setError("");
    } catch {
      setError("暂时无法定位，请重试。");
    }
  }
  return (
    <>
      {!status.isLoaded || status.isBuffering ? <ActivityIndicator /> : null}
      <Text style={s.body}>
        {status.currentTime.toFixed(1)} / {status.duration.toFixed(1)} 秒
      </Text>
      {status.error || error ? (
        <Text style={s.error} accessibilityRole="alert">
          {status.error ? "当前声音无法播放，可重试或生成兼容版。" : error}
        </Text>
      ) : null}
      <Button
        title={status.playing ? "暂停声音" : "播放声音"}
        onPress={() => (status.playing ? player.pause() : player.play())}
      />
      <Button
        title={`播放速度 ${speed}×`}
        onPress={() => {
          const speeds = [0.75, 1, 1.25, 1.5, 2],
            v = speeds[(speeds.indexOf(speed) + 1) % speeds.length]!;
          player.setPlaybackRate(v);
          setSpeed(v);
        }}
      />
      <Button
        title={continuous ? "关闭连续播放" : "主动连续播放下一段声音"}
        onPress={toggleContinuous}
      />
      <TextInput
        accessibilityLabel="定位秒数"
        keyboardType="decimal-pad"
        style={s.input}
        value={seek}
        onChangeText={setSeek}
      />
      <Button title="定位" onPress={() => void seekTo(Number(seek))} />
      {transcript ? (
        <>
          <Text style={s.cardTitle}>
            转录{transcript.edited ? " · 人工修订" : ""}
          </Text>
          <Text style={s.body}>{transcript.text}</Text>
          {transcript.segments.length ? (
            <Text style={s.body}>带真实时间段的原始转录</Text>
          ) : null}
          {transcript.segments.map((segment, i) => (
            <Button
              key={i}
              title={`${segment.startSeconds.toFixed(1)} 秒 · ${segment.text}`}
              onPress={() => void seekTo(segment.startSeconds)}
            />
          ))}
        </>
      ) : null}
    </>
  );
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
