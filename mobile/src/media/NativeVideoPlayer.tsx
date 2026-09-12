import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Image, ScrollView, View } from "react-native";
import { useVideoPlayer, VideoView, type VideoPlayer, type VideoPlayerStatus } from "expo-video";
import { Text } from "../components/typography";
import { Button } from "../components/ui";
import { useColorTheme, useSharedStyles } from "../theme";
import { inspectPlaybackFailure, type PlaybackFailure, type PlaybackSource } from "./playback-source";
import { useAppActive } from "./use-app-active";
import { ReaderCanvasToggle, ReaderPlaybackControls, ReaderSwipeSurface } from "./ReaderChrome";

export const VIDEO_LOAD_TIMEOUT_MS = 15_000;

export function NativeVideoPlayer({
  source, poster, localOriginal, remoteOriginal, initialSeconds = 0, retryToken, message, externalError,
  onPosition, onUnsupported, onRetry, controlsVisible = true, onToggleControls, onNavigate, viewingOnly = false,
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
  controlsVisible?: boolean;
  onToggleControls?: () => void;
  onNavigate?: (direction: -1 | 1) => void;
  viewingOnly?: boolean;
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
  const [muted, setMuted] = useState(false);
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
      player.addListener("mutedChange", ({ muted: next }) => setMuted(next)),
      player.addListener("playToEnd", () => { desired.current = false; setRequested(false); }),
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
      else if (accepted.current && player.status === "readyToPlay") {
        if (player.duration > 0 && player.currentTime >= player.duration - 0.1) seekTo(0);
        player.play();
      }
    }
  }
  function seekTo(value: number) {
    if (!accepted.current || player.status !== "readyToPlay" || !Number.isFinite(value)) return;
    const target = Math.max(0, Math.min(value, player.duration));
    player.seekBy(target - player.currentTime);
    position.current = target;
    setSeconds(target);
    save.current?.(target);
    lastSaved.current = target;
  }
  const explanation = usableFrame ? undefined : viewingOnly
    ? message ? "视频正在准备中…" : externalError || failure ? "这段视频暂时无法播放，可以重试或查看下一份。" : undefined
    : externalError || message || failure?.message;
  const waiting = !explanation && (!currentFrame || status === "loading");
  const cover = !currentFrame || Boolean(explanation);
  return (
    <View style={{ flex: 1, minHeight: 0 }}>
      <ReaderSwipeSurface onNavigate={onNavigate}>
        <View testID="media-video-viewport" style={{ flex: 1, backgroundColor: colors.mediaBackdrop, overflow: "hidden" }}>
          <VideoView
            testID="media-video-view"
            player={player}
            contentFit="contain"
            nativeControls={false}
            allowsVideoFrameAnalysis={!viewingOnly}
            surfaceType="textureView"
            accessibilityLabel="视频画面"
            accessibilityValue={{ text: currentFrame ? "画面已呈现" : "正在加载" }}
            onFirstFrameRender={() => { if (accepted.current || nativeSourceMatches.current) setFirstFrame(true); }}
            style={{ width: "100%", height: "100%", opacity: stableSource && acceptedSourceKey === sourceKey ? 1 : 0 }}
          />
          <ReaderCanvasToggle visible={controlsVisible} onPress={onToggleControls} />
          {cover ? <View pointerEvents="box-none" style={{ position: "absolute", inset: 0 }}>
            {!currentFrame && poster ? <Image accessibilityLabel="视频封面" source={poster} resizeMode="contain" style={{ position: "absolute", inset: 0 }} /> : null}
            <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: 20 }} pointerEvents="box-none">
              <View style={{ backgroundColor: colors.card, borderRadius: 12, padding: 16, gap: 12 }}>
                {waiting || message ? <ActivityIndicator color={colors.coral} /> : null}
                <Text testID="media-video-status" accessibilityLiveRegion="polite" style={blockingFailure && !message ? s.error : s.body}>
                  {explanation || (requested ? "正在加载视频…" : "点击播放视频")}
                </Text>
                {blockingFailure && !message ? <Button title="重试视频" onPress={() => { desired.current = true; setRequested(true); onRetry(); }} /> : null}
              </View>
            </ScrollView>
          </View> : null}
        </View>
      </ReaderSwipeSurface>
      {controlsVisible ? <ReaderPlaybackControls
        kind="video"
        playing={Boolean(playing || requested && (!blockingFailure || message))}
        muted={muted}
        seconds={seconds}
        duration={duration}
        disabled={acceptedSourceKey !== sourceKey || status !== "readyToPlay"}
        onPlayPause={togglePlayback}
        onSeek={seekTo}
        onMute={() => { setNativeMuted(player, !muted); setMuted(!muted); }}
      /> : null}
    </View>
  );
}

/** Expo exposes mute as an imperative native property, independent of React state. */
function setNativeMuted(player: VideoPlayer, muted: boolean) { player.muted = muted; }
