import { useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, View } from "react-native";
import { Text } from "../components/typography";
import { Button } from "../components/ui";
import { useColorTheme, useSharedStyles } from "../theme";
import { ReaderSwipeSurface } from "./ReaderChrome";
import type { PlaybackSource } from "./playback-source";

export function ReaderPhoto({ source, filename, zoom, controlsVisible, error, onError, onRetry, onToggleControls, onNavigate }: {
  source: PlaybackSource | null;
  filename: string;
  zoom: number;
  controlsVisible: boolean;
  error?: string;
  onError: () => void;
  onRetry: () => void;
  onToggleControls: () => void;
  onNavigate: (direction: -1 | 1) => void;
}) {
  const { colors } = useColorTheme();
  const s = useSharedStyles();
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [loaded, setLoaded] = useState(false);
  const [pinching, setPinching] = useState(false);
  return (
    <ReaderSwipeSurface enabled={zoom === 1 && !pinching} onNavigate={onNavigate}>
      <View onLayout={({ nativeEvent }) => setSize({ width: nativeEvent.layout.width, height: nativeEvent.layout.height })} style={{ flex: 1, minHeight: 0, backgroundColor: colors.mediaBackdrop }}>
        {source && size.width > 0 && size.height > 0 ? <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ minWidth: size.width }}>
          <ScrollView
            nestedScrollEnabled
            minimumZoomScale={1}
            maximumZoomScale={4}
            centerContent
            showsVerticalScrollIndicator={false}
            scrollEventThrottle={80}
            onScroll={({ nativeEvent }) => setPinching(nativeEvent.zoomScale > 1.01)}
            contentContainerStyle={{ minHeight: size.height }}
          >
            <Pressable accessibilityRole="button" accessibilityLabel={`${filename}，${controlsVisible ? "收起" : "显示"}观看工具`} onPress={onToggleControls} style={{ width: size.width * zoom, height: size.height * zoom }}>
              <Image source={source} accessibilityLabel={filename} resizeMode="contain" onLoad={() => setLoaded(true)} onError={onError} style={{ width: "100%", height: "100%" }} />
            </Pressable>
          </ScrollView>
        </ScrollView> : null}
        {error || !source ? <View style={{ position: "absolute", inset: 0, justifyContent: "center", padding: 20, backgroundColor: colors.mediaBackdrop }}>
          <View style={[s.card, { gap: 12 }]}><Text accessibilityRole="alert" style={s.error}>{error || "暂时无法读取这张照片。"}</Text><Button title="重新加载照片" onPress={onRetry} /></View>
        </View> : !loaded ? <View pointerEvents="none" style={{ position: "absolute", inset: 0, justifyContent: "center", alignItems: "center" }}><ActivityIndicator color={colors.coral} /></View> : null}
      </View>
    </ReaderSwipeSurface>
  );
}
