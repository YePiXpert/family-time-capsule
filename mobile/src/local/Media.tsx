import { useEffect, useState } from "react";
import { AppState, Image, ScrollView, View } from "react-native";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { useVideoPlayer, VideoView } from "expo-video";
import * as Sharing from "expo-sharing";
import { useLibrary } from "./context";
import { mediaDirectory, mediaFile, mediaUri } from "./files";
import { File } from "expo-file-system";
import type { LocalMedia } from "./model";
import type { Props } from "./navigation";
import { Button, ErrorText, Page, Text, messageOf, useStyles } from "./ui";
export function PhotoDetails({ media }: { media: LocalMedia }) {
  const s = useStyles();
  const metadata = media.photoMetadata;
  if (media.kind !== "image") return null;
  return (
    <View style={{ gap: 4 }}>
      <Text style={s.muted}>
        {metadata?.capturedAt
          ? `拍摄时间：${metadata.capturedAt.replace("T", " ")}`
          : "照片未提供拍摄时间"}
      </Text>
      {metadata?.latitude !== undefined && metadata.longitude !== undefined && (
        <Text style={s.muted}>
          拍摄坐标：{metadata.latitude.toFixed(6)},{" "}
          {metadata.longitude.toFixed(6)}
        </Text>
      )}
    </View>
  );
}
export function Photo({
  media,
  contain = false,
  size,
  preview = false,
}: {
  media: LocalMedia | undefined;
  contain?: boolean;
  size?: number;
  /** 列表/封面等小图场景：优先渲染持久缩略图。 */
  preview?: boolean;
}) {
  const s = useStyles();
  const [error, setError] = useState(false);
  if (!media || !mediaFile(media).exists || error)
    return (
      <View style={[s.section, { minHeight: size ?? 120, width: size }]}>
        <Text>照片暂时无法读取</Text>
        <Text style={s.muted}>原记录仍保留，可从备份恢复缺失素材。</Text>
      </View>
    );
  const thumb =
    !contain && (preview || size !== undefined) && media.thumb
      ? new File(mediaDirectory, media.thumb)
      : null;
  return (
    <Image
      accessibilityLabel={media.name}
      source={{ uri: thumb?.exists ? thumb.uri : mediaUri(media) }}
      resizeMode={contain ? "contain" : "cover"}
      onError={() => setError(true)}
      style={[
        {
          width: "100%",
          borderRadius: 12,
          aspectRatio: size
            ? 1
            : media.width && media.height
              ? media.width / media.height
              : 4 / 3,
        },
        size ? { width: size, height: size } : undefined,
      ]}
    />
  );
}
function Audio({ media }: { media: LocalMedia }) {
  const player = useAudioPlayer(mediaUri(media)),
    status = useAudioPlayerStatus(player);
  const [error, setError] = useState("");
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") player.pause();
    });
    return () => sub.remove();
  }, [player]);
  return (
    <View style={{ gap: 16 }}>
      <Text>
        {Math.floor(status.currentTime)} 秒 / {Math.floor(status.duration)} 秒
      </Text>
      <ErrorText message={error || status.error || ""} />
      <Button
        title={status.playing ? "暂停" : "播放录音"}
        icon={status.playing ? "pause" : "play"}
        primary
        onPress={() => {
          try {
            if (status.playing) player.pause();
            else {
              if (status.didJustFinish) void player.seekTo(0);
              player.play();
            }
          } catch (e) {
            setError(messageOf(e));
          }
        }}
      />
      <Button
        title="从头播放"
        onPress={() => {
          void player.seekTo(0).catch((e) => setError(messageOf(e)));
        }}
      />
    </View>
  );
}
function Video({ media }: { media: LocalMedia }) {
  const player = useVideoPlayer(mediaUri(media));
  const [error, setError] = useState("");
  useEffect(() => {
    const status = player.addListener("statusChange", (event) => {
      if (event.status === "error")
        setError("视频暂时无法播放，可导出原件用其他应用打开。");
    });
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") player.pause();
    });
    return () => {
      status.remove();
      sub.remove();
    };
  }, [player]);
  return (
    <View>
      <VideoView
        player={player}
        nativeControls
        style={{
          width: "100%",
          aspectRatio:
            media.width && media.height ? media.width / media.height : 3 / 4,
        }}
      />
      <ErrorText message={error} />
    </View>
  );
}
export function MediaScreen({ route }: Props<"Media">) {
  const state = useLibrary(),
    media = state.media[route.params.id];
  const [error, setError] = useState("");
  if (!media || !mediaFile(media).exists)
    return (
      <Page>
        <Text>素材文件缺失，记录信息仍保留。</Text>
      </Page>
    );
  return (
    <Page>
      <Text>{media.name}</Text>
      {media.kind === "image" ? (
        <ScrollView maximumZoomScale={4} minimumZoomScale={1}>
          <Photo media={media} contain />
        </ScrollView>
      ) : media.kind === "audio" ? (
        <Audio media={media} />
      ) : media.kind === "video" ? (
        <Video media={media} />
      ) : (
        <Text>使用下方按钮打开或保存这份文件。</Text>
      )}
      <PhotoDetails media={media} />
      <ErrorText message={error} />
      <Button
        title="导出原件"
        icon="download"
        onPress={() => {
          void Sharing.shareAsync(mediaUri(media)).catch((e) =>
            setError(messageOf(e)),
          );
        }}
      />
    </Page>
  );
}
