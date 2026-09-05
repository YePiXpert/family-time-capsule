import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { useVideoPlayer, VideoView } from "expo-video";
import { useEvent } from "expo";
import type { Credentials } from "../types";
import type { ReaderAsset, ReaderTranscript, MediaDerivation } from "./types";
import { fetchMediaDerivations } from "../api/client";
import { exportOriginalCopy } from "./export-original";
import { sharedStyles as s } from "../theme";
export type NativeReaderAsset = ReaderAsset & {
  localUri?: string;
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
  return item.localUri
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
  const [index, setIndex] = useState<number | null>(null),
    [continuous, setContinuous] = useState(false);
  const item = index === null ? null : assets[index];
  const ended = useCallback(() => {
    if (!continuous || index === null) return;
    const next = assets.findIndex((a, i) => i > index && a.type === "audio");
    if (next >= 0) setIndex(next);
  }, [assets, continuous, index]);
  return (
    <>
      {assets.map((asset, i) => (
        <Pressable
          key={`${asset.id}-${i}`}
          accessibilityRole="button"
          accessibilityLabel={`打开阅读器：${asset.filename}`}
          onPress={() => setIndex(i)}
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
        animationType="slide"
      >
        <SafeAreaView style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={s.content}>
            <Button title="关闭阅读器" onPress={() => setIndex(null)} />
            <Text style={s.body} accessibilityLiveRegion="polite">
              {index === null ? 0 : index + 1} / {assets.length}
            </Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Button
                title="上一份"
                disabled={index === null || index === 0}
                onPress={() => setIndex((i) => (i === null ? null : i - 1))}
              />
              <Button
                title="下一份"
                disabled={index === null || index === assets.length - 1}
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
  const [jobs, setJobs] = useState<MediaDerivation[]>([]),
    [transcript, setTranscript] = useState<ReaderTranscript | null>(
      item.localTranscript ?? null,
    ),
    [error, setError] = useState(""),
    [denied, setDenied] = useState(false),
    [original, setOriginal] = useState(false),
    [zoom, setZoom] = useState(1),
    [retry, setRetry] = useState(0);
  const { width } = useWindowDimensions();
  useEffect(() => {
    if (!credentials || item.localUri) return;
    let alive = true,
      timer: ReturnType<typeof setTimeout> | undefined;
    async function load(first = false) {
      try {
        const data = await fetchMediaDerivations(
          credentials!,
          item.id,
          first && ["image", "video"].includes(item.type)
            ? "preview"
            : undefined,
        );
        if (!alive) return;
        setJobs(data.jobs);
        setTranscript(data.transcript);
        setError("");
        setDenied(false);
        if (data.jobs.some((j) => ["queued", "running"].includes(j.status)))
          timer = setTimeout(() => void load(), 2000);
      } catch (e) {
        if (!alive) return;
        const status = (e as { status?: number }).status;
        setDenied(status === 403 || status === 404);
        setError(
          status === 403 || status === 404
            ? "来源已删除或当前没有阅读权限。"
            : "无法连接服务器，请检查网络后重试。",
        );
      }
    }
    void load(true);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [credentials, item.id, item.localUri, item.type, retry]);
  const preview = jobs.find((j) => j.kind === "preview"),
    transcode = jobs.find((j) => j.kind === "transcode"),
    waveform = jobs.find((j) => j.kind === "waveform");
  const selectedId = original
    ? item.id
    : item.type === "image"
      ? preview?.outputAssetId || item.thumbnailId || item.id
      : transcode?.outputAssetId || item.id;
  const source = mediaSource(credentials, item, selectedId);
  async function generate(kind: MediaDerivation["kind"]) {
    if (!credentials) return;
    try {
      await fetchMediaDerivations(credentials, item.id, kind);
      setRetry((v) => v + 1);
    } catch {
      setError("无法开始处理，请稍后重试。");
    }
  }
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
      {error ? (
        <Text accessibilityRole="alert" style={s.error}>
          {error}
        </Text>
      ) : null}
      {!denied && source ? (
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
        ) : item.type === "video" ? (
          <Video
            key={`${selectedId}-${retry}`}
            source={source}
            initialSeconds={item.initialSeconds}
            onPosition={
              onPosition ? (seconds) => onPosition(item.id, seconds) : undefined
            }
            poster={
              preview?.outputAssetId
                ? mediaSource(credentials, item, preview.outputAssetId)
                : null
            }
          />
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
      {!item.localUri && ["video", "audio"].includes(item.type) ? (
        <>
          <Button
            title="生成兼容播放版"
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
        .filter((j) => j.status !== "succeeded")
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
type PlaybackSource = { uri: string; headers?: Record<string, string> };
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
function Video({
  source,
  poster,
  initialSeconds = 0,
  onPosition,
}: {
  initialSeconds?: number;
  onPosition?: (seconds: number) => void;
  source: PlaybackSource;
  poster: PlaybackSource | null;
}) {
  const player = useVideoPlayer(source, (player) => {
    player.timeUpdateEventInterval = 1;
  });
  const time = useEvent(player, "timeUpdate", {
    currentTime: 0,
    currentLiveTimestamp: null,
    currentOffsetFromLive: null,
    bufferedPosition: 0,
  });
  const restored = useRef(false);
  const { status, error } = useEvent(player, "statusChange", {
    status: player.status,
    error: undefined,
  });
  useEffect(() => {
    if (status === "readyToPlay" && !restored.current) {
      restored.current = true;
      if (initialSeconds > 0)
        player.seekBy(Math.min(initialSeconds, player.duration) - player.currentTime);
    }
  }, [status, player, initialSeconds]);
  usePlaybackProgress(
    time.currentTime,
    status === "readyToPlay" && (initialSeconds === 0 || time.currentTime > 0),
    onPosition,
  );
  return (
    <>
      {status === "loading" ? (
        <>
          <ActivityIndicator />
          {poster ? (
            <Image
              source={poster}
              accessibilityLabel="视频封面"
              style={{ width: "100%", height: 240, resizeMode: "contain" }}
            />
          ) : null}
        </>
      ) : null}
      {error ? (
        <Text style={s.error}>视频暂时无法解码，请重试或生成兼容播放版。</Text>
      ) : null}
      <VideoView
        player={player}
        contentFit="contain"
        nativeControls
        style={{ width: "100%", height: 340 }}
      />
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
