import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, View } from "react-native";
import { useVideoPlayer, VideoView, type VideoPlayerStatus } from "expo-video";
import { Text } from "../components/typography";
import { useColorTheme, useSharedStyles } from "../theme";
import { inspectPlaybackFailure, type PlaybackFailure, type PlaybackSource } from "./playback-source";
import { useAppActive } from "./use-app-active";

export const VIDEO_LOAD_TIMEOUT_MS = 15_000;

export function NativeVideoPlayer({
  source, poster, localOriginal, remoteOriginal, initialSeconds = 0, retryToken, message, externalError,
  onPosition, onUnsupported, onRetry,
}: {
  source: PlaybackSource | null;
  poster: PlaybackSource | null;
  localOriginal: boolean;
  remoteOriginal?: PlaybackSource | null;
  initialSeconds?: number;
  retryToken: number;
  message?: string;
  externalError?: string;
  onPosition?: (seconds: number) => void;
  onUnsupported: () => void;
  onRetry: () => void;
}) {
  const s = useSharedStyles();
  const { colors } = useColorTheme();
  // A player belongs to an open asset, never to a URL, job status, or retry attempt.
  const player = useVideoPlayer(null, (value) => { value.timeUpdateEventInterval = 0.5; });
  const sourceKey = JSON.stringify(source);
  const stableSource = useMemo<PlaybackSource | null>(() => JSON.parse(sourceKey), [sourceKey]);
  const [status, setStatus] = useState<VideoPlayerStatus>("idle");
  const [acceptedSourceKey, setAcceptedSourceKey] = useState("");
  const [firstFrame, setFirstFrame] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [requested, setRequested] = useState(true);
  const [failure, setFailure] = useState<PlaybackFailure | null>(null);
  const [seconds, setSeconds] = useState(initialSeconds);
  const [duration, setDuration] = useState(0);
  const desired = useRef(true);
  const foreground = useRef(true);
  const accepted = useRef(false);
  const nativeSourceMatches = useRef(false);
  const hasNativeSource = useRef(false);
  const loadingGeneration = useRef(-1);
  const nativeError = useRef("");
  const previousRetry = useRef(retryToken);
  const position = useRef(Math.max(0, initialSeconds));
  const restored = useRef(false);
  const generation = useRef(0);
  const lastSaved = useRef(-1);
  const save = useRef(onPosition);
  const unsupported = useRef(onUnsupported);
  const sourceRef = useRef(stableSource);
  const remoteOriginalRef = useRef(remoteOriginal);
  useEffect(() => {
    save.current = onPosition;
    unsupported.current = onUnsupported;
    sourceRef.current = stableSource;
    remoteOriginalRef.current = remoteOriginal;
  }, [onPosition, onUnsupported, stableSource, remoteOriginal]);
  const probe = useRef<AbortController | null>(null);
  const probeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const failedGeneration = useRef(-1);
  const waitStarted = useRef<number | null>(null);
  const active = useAppActive(() => {
    desired.current = false;
    foreground.current = false;
    setRequested(false);
    player.pause();
    probe.current?.abort();
    probe.current = null;
    clearTimeout(probeTimer.current);
  });

  const reportFailure = useCallback(async (nativeMessage: string) => {
    if (!foreground.current || failedGeneration.current === generation.current || !sourceRef.current) return;
    const current = generation.current;
    failedGeneration.current = current;
    // This pause belongs to failed media, not to a user changing playback intent.
    accepted.current = false;
    setAcceptedSourceKey("");
    player.pause();
    const controller = new AbortController();
    probe.current?.abort();
    probe.current = controller;
    const deadline = setTimeout(() => controller.abort(), 8_000);
    probeTimer.current = deadline;
    let result = await inspectPlaybackFailure(sourceRef.current, localOriginal, nativeMessage, controller.signal);
    if (!controller.signal.aborted && localOriginal && result.kind === "unsupported" && remoteOriginalRef.current)
      result = await inspectPlaybackFailure(remoteOriginalRef.current, false, nativeMessage, controller.signal);
    clearTimeout(deadline);
    if (generation.current !== current || !foreground.current || probe.current !== controller) return;
    setFailure(result);
    if (result.kind === "unsupported") unsupported.current();
  }, [localOriginal, player]);

  const applyReady = useCallback(() => {
    if (!accepted.current) return;
    setDuration(Number.isFinite(player.duration) ? player.duration : 0);
    if (!restored.current) {
      restored.current = true;
      if (position.current > 0)
        player.seekBy(Math.min(position.current, Math.max(0, player.duration - 0.1)) - player.currentTime);
      if (desired.current && foreground.current) player.play();
    }
  }, [player]);

  useEffect(() => {
    const subscriptions = [
      player.addListener("sourceChange", ({ source: next }) => {
        const uri = typeof next === "string" ? next : typeof next === "object" && next ? next.uri : undefined;
        nativeSourceMatches.current = loadingGeneration.current === generation.current && uri === sourceRef.current?.uri;
      }),
      player.addListener("statusChange", ({ status: next, error }) => {
        if (next === "error" && loadingGeneration.current === generation.current) nativeError.current = error?.message || "";
        if (!accepted.current) return;
        setStatus(next);
        if (next === "readyToPlay") applyReady();
        if (next === "error") void reportFailure(error?.message || "");
      }),
      player.addListener("playingChange", ({ isPlaying }) => {
        setPlaying(isPlaying);
        if (accepted.current && restored.current && player.status === "readyToPlay" && foreground.current) {
          desired.current = isPlaying;
          setRequested(isPlaying);
        }
      }),
      player.addListener("timeUpdate", ({ currentTime }) => {
        if (!accepted.current || !restored.current || !Number.isFinite(currentTime)) return;
        position.current = currentTime;
        setSeconds(currentTime);
        if (Math.abs(currentTime - lastSaved.current) >= 2) {
          lastSaved.current = currentTime;
          save.current?.(currentTime);
        }
      }),
    ];
    return () => subscriptions.forEach((subscription) => subscription.remove());
  }, [applyReady, player, reportFailure]);

  useEffect(() => {
    const current = ++generation.current;
    if (accepted.current && Number.isFinite(player.currentTime)) position.current = player.currentTime;
    accepted.current = false;
    nativeSourceMatches.current = false;
    restored.current = false;
    failedGeneration.current = -1;
    probe.current?.abort();
    probe.current = null;
    clearTimeout(probeTimer.current);
    if (hasNativeSource.current || previousRetry.current !== retryToken) waitStarted.current = null;
    previousRetry.current = retryToken;
    // Expo supersedes an in-flight native load when replaceAsync is called again.
    // Never wait for an old load here: a stalled URL must remain retryable.
    void Promise.resolve().then(async () => {
      if (generation.current !== current) return;
      setFirstFrame(false);
      setFailure(null);
      setStatus("loading");
      setAcceptedSourceKey("");
      player.pause();
      nativeError.current = "";
      loadingGeneration.current = current;
      try {
        if (!stableSource && !hasNativeSource.current) { setStatus("idle"); return; }
        hasNativeSource.current = Boolean(stableSource);
        await player.replaceAsync(stableSource);
        if (generation.current !== current) return;
        if (!stableSource) { setStatus("idle"); return; }
        accepted.current = true;
        setAcceptedSourceKey(sourceKey);
        setStatus(player.status);
        if (player.status === "readyToPlay") applyReady();
        else if (player.status === "error") void reportFailure(nativeError.current);
      } catch (error) {
        if (generation.current === current) {
          setStatus("error");
          void reportFailure(error instanceof Error ? error.message : "");
        }
      }
    });
    return () => {
      generation.current = current + 1;
      accepted.current = false;
      probe.current?.abort();
      probe.current = null;
      clearTimeout(probeTimer.current);
    };
  }, [applyReady, player, reportFailure, retryToken, sourceKey, stableSource]);

  useEffect(() => {
    foreground.current = active;
  }, [active]);

  useEffect(() => {
    if (!active || !requested || failure || externalError || message || (status === "readyToPlay" && firstFrame)) {
      waitStarted.current = null;
      return;
    }
    waitStarted.current ??= Date.now();
    const timer = setTimeout(() => {
      player.pause();
      setFailure({ kind: "timeout", message: localOriginal ? "视频加载超过 15 秒，请重试或重新选择本机原件。" : "视频加载超过 15 秒，请检查网络后重试。" });
    }, Math.max(0, VIDEO_LOAD_TIMEOUT_MS - (Date.now() - waitStarted.current)));
    return () => clearTimeout(timer);
  }, [active, externalError, failure, firstFrame, localOriginal, message, player, requested, status, sourceKey, retryToken]);

  useEffect(() => () => {
    // useVideoPlayer owns native release. Pending callbacks are invalidated by generation cleanup.
    if (lastSaved.current >= 0) save.current?.(position.current);
  }, []);

  const currentFrame = firstFrame && acceptedSourceKey === sourceKey;
  const usableFrame = currentFrame && status === "readyToPlay";
  const blockingFailure = !usableFrame && Boolean(failure || externalError);
  function togglePlayback() {
    if (playing || requested && (!blockingFailure || message)) {
      desired.current = false;
      setRequested(false);
      player.pause();
    } else {
      desired.current = true;
      setRequested(true);
      if (blockingFailure || status === "error") onRetry();
      else if (accepted.current && player.status === "readyToPlay") player.play();
    }
  }
  const explanation = usableFrame ? undefined : externalError || message || failure?.message;
  const waiting = !explanation && (!currentFrame || status === "loading");
  const cover = !currentFrame || Boolean(explanation);
  return (
    <>
      <View testID="media-video-viewport" style={{ width: "100%", height: 340, backgroundColor: colors.mediaBackdrop, borderRadius: 12, overflow: "hidden" }}>
        <VideoView
          testID="media-video-view"
          player={player}
          contentFit="contain"
          nativeControls={Boolean(stableSource) && acceptedSourceKey === sourceKey}
          surfaceType="textureView"
          onFirstFrameRender={() => { if (accepted.current || nativeSourceMatches.current) setFirstFrame(true); }}
          style={{ width: "100%", height: "100%", opacity: stableSource && acceptedSourceKey === sourceKey ? 1 : 0 }}
        />
        {cover ? <View pointerEvents="box-none" style={{ position: "absolute", inset: 0 }}>
          {!currentFrame && poster ? <Image accessibilityLabel="视频封面" source={poster} resizeMode="contain" style={{ position: "absolute", inset: 0 }} /> : null}
          <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: 20 }} pointerEvents="box-none">
            <View pointerEvents="none" style={{ backgroundColor: colors.card, borderRadius: 12, padding: 16, gap: 8 }}>
              {waiting || message ? <ActivityIndicator color={colors.coral} /> : null}
              <Text testID="media-video-status" accessibilityLiveRegion="polite" style={externalError || failure && !message ? s.error : s.body}>
                {explanation || (requested ? "正在加载视频…" : "点击播放视频")}
              </Text>
            </View>
          </ScrollView>
        </View> : null}
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <Pressable accessibilityRole="button" onPress={togglePlayback} style={s.secondaryButton}>
          <Text style={s.secondaryText}>{playing || requested && (!blockingFailure || message) ? "暂停视频" : "播放视频"}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => { desired.current = true; setRequested(true); onRetry(); }} style={s.secondaryButton}>
          <Text style={s.secondaryText}>重试视频</Text>
        </Pressable>
      </View>
      <Text testID="media-video-time" style={s.body}>{seconds.toFixed(1)} / {duration.toFixed(1)} 秒</Text>
      {currentFrame ? <Text testID="media-video-first-frame" style={s.body}>视频画面已显示</Text> : <Text style={s.body}>等待视频画面</Text>}
    </>
  );
}
