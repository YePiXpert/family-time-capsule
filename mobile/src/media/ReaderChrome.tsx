import { useMemo, useRef, useState, type ReactNode } from "react";
import { PanResponder, Pressable, View } from "react-native";
import { Text } from "../components/typography";
import { Button, IconButton } from "../components/ui";
import { useColorTheme } from "../theme";

export function mediaClock(value: number) {
  const total = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
  const seconds = String(total % 60).padStart(2, "0");
  const minutes = Math.floor(total / 60);
  return minutes >= 60
    ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}:${seconds}`
    : `${String(minutes).padStart(2, "0")}:${seconds}`;
}

/** A slider with one seek at release; playback never recreates while the thumb moves. */
export function ReaderSeekBar({ seconds, duration, disabled, onSeek, testID }: {
  seconds: number;
  duration: number;
  disabled?: boolean;
  onSeek: (seconds: number) => void;
  testID?: string;
}) {
  const { colors } = useColorTheme();
  const [width, setWidth] = useState(0);
  const [dragSeconds, setDragSeconds] = useState<number | null>(null);
  const drag = useRef<number | null>(null);
  const unavailable = disabled || duration <= 0 || width <= 0;
  const shown = Math.min(Math.max(0, dragSeconds ?? seconds), Math.max(0, duration));
  const progress = duration > 0 ? shown / duration : 0;
  function update(x: number) {
    if (unavailable) return;
    const next = Math.max(0, Math.min(1, (x - 10) / Math.max(1, width - 20))) * duration;
    drag.current = next;
    setDragSeconds(next);
  }
  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel="播放进度"
      accessibilityState={{ disabled: Boolean(unavailable) }}
      accessibilityValue={{ min: 0, max: Math.max(0, Math.round(duration)), now: Math.round(shown), text: `${mediaClock(shown)}，共 ${mediaClock(duration)}` }}
      accessibilityActions={[{ name: "increment", label: "向后十秒" }, { name: "decrement", label: "向前十秒" }]}
      onAccessibilityAction={({ nativeEvent }) => {
        if (unavailable) return;
        onSeek(Math.min(duration, Math.max(0, seconds + (nativeEvent.actionName === "increment" ? 10 : -10))));
      }}
      onLayout={({ nativeEvent }) => setWidth(nativeEvent.layout.width)}
      onStartShouldSetResponder={() => !unavailable}
      onMoveShouldSetResponder={() => !unavailable}
      onResponderGrant={({ nativeEvent }) => update(nativeEvent.locationX)}
      onResponderMove={({ nativeEvent }) => update(nativeEvent.locationX)}
      onResponderRelease={() => {
        if (drag.current !== null) onSeek(drag.current);
        drag.current = null;
        setDragSeconds(null);
      }}
      onResponderTerminate={() => { drag.current = null; setDragSeconds(null); }}
      onResponderTerminationRequest={() => false}
      style={{ height: 44, justifyContent: "center", paddingHorizontal: 10, opacity: unavailable ? 0.45 : 1 }}
    >
      <View pointerEvents="none" style={{ height: 4, borderRadius: 2, backgroundColor: colors.line }}>
        <View style={{ width: `${progress * 100}%`, height: 4, borderRadius: 2, backgroundColor: colors.coral }} />
        <View style={{ position: "absolute", left: `${progress * 100}%`, marginLeft: -9, top: -7, width: 18, height: 18, borderRadius: 9, backgroundColor: colors.coral }} />
      </View>
    </View>
  );
}

export function ReaderPlaybackControls({ playing, muted, seconds, duration, disabled, onPlayPause, onMute, onSeek, kind }: {
  playing: boolean;
  muted: boolean;
  seconds: number;
  duration: number;
  disabled?: boolean;
  onPlayPause: () => void;
  onMute: () => void;
  onSeek: (seconds: number) => void;
  kind: "video" | "audio";
}) {
  const { colors } = useColorTheme();
  const name = kind === "video" ? "视频" : "声音";
  return (
    <View style={{ paddingHorizontal: 20, paddingBottom: 8, backgroundColor: colors.paper }}>
      <ReaderSeekBar testID={`media-${kind}-seek`} seconds={seconds} duration={duration} disabled={disabled} onSeek={onSeek} />
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <IconButton icon={playing ? "pause" : "play"} label={`${playing ? "暂停" : "播放"}${name}`} tone="accent" onPress={onPlayPause} />
        <Text testID={`media-${kind}-time`} style={{ color: colors.ink, fontSize: 14, fontVariant: ["tabular-nums"], textAlign: "center", flexGrow: 1, flexShrink: 1 }}>
          {mediaClock(seconds)} / {mediaClock(duration)}
        </Text>
        <Button title={muted ? "静音" : "有声"} accessibilityLabel={muted ? "打开声音" : "静音"} variant="ghost" full={false} onPress={onMute} />
      </View>
    </View>
  );
}

/** Horizontal changes apply only to the canvas; dragging playback progress is independent. */
export function ReaderSwipeSurface({ children, onNavigate, enabled = true }: {
  children: ReactNode;
  onNavigate?: (direction: -1 | 1) => void;
  enabled?: boolean;
}) {
  const gesture = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_event, state) => Boolean(enabled && onNavigate && state.numberActiveTouches === 1 && Math.abs(state.dx) > 24 && Math.abs(state.dx) > Math.abs(state.dy) * 1.5),
    onPanResponderRelease: (_event, state) => {
      if (Math.abs(state.dx) > 55) onNavigate?.(state.dx < 0 ? 1 : -1);
    },
  }), [enabled, onNavigate]);
  return <View {...gesture.panHandlers} style={{ flex: 1, minHeight: 0 }}>{children}</View>;
}

export function ReaderCanvasToggle({ visible, onPress }: { visible: boolean; onPress?: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={visible ? "收起观看工具" : "显示观看工具"} onPress={onPress} style={{ position: "absolute", inset: 0 }} />;
}
