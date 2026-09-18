import { useState } from "react";
import { Pressable, View } from "react-native";
import Animated, {
  FadeInUp,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { GlassView } from "expo-glass-effect";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { JournalIcon } from "../components/JournalIcon";
import { useStore } from "./context";
import { useNav } from "./navigation";
import { beginDraft } from "./services";
import {
  ErrorText,
  PRESS_SPRING,
  hapticLight,
  messageOf,
  useStyles,
  useTheme,
} from "./ui";

const SIZE = 56;

/**
 * 「记一刻」悬浮钮：书架与月册内页共用这一份，别再各写一遍。
 * iOS 液态玻璃下是赤陶 tint 的系统玻璃圆钮，其余平台是实底赤陶加柔和投影。
 */
export function CaptureFab() {
  const store = useStore(),
    nav = useNav(),
    s = useStyles(),
    { colors, dark, liquid } = useTheme();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const reduceMotion = useReducedMotion();
  const scale = useSharedValue(1);
  const pressStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));
  const press = (to: number) => {
    if (reduceMotion) return;
    // eslint-disable-next-line react-hooks/immutability -- reanimated 共享值的就地修改是其既定用法
    scale.value = withSpring(to, PRESS_SPRING);
  };
  return (
    <View
      pointerEvents="box-none"
      style={{
        position: "absolute",
        right: 20,
        bottom: insets.bottom + 20,
        alignItems: "flex-end",
        gap: 8,
      }}
    >
      <ErrorText message={error} />
      <Animated.View
        entering={reduceMotion ? undefined : FadeInUp.delay(240).duration(360)}
        style={pressStyle}
      >
        <Pressable
          testID="capture-new"
          accessibilityRole="button"
          accessibilityLabel="记一刻"
          disabled={busy}
          onPress={() => {
            hapticLight();
            setBusy(true);
            void beginDraft(store)
              .then((draftId) => nav.navigate("Editor", { draftId }))
              .catch((e) => setError(messageOf(e)))
              .finally(() => setBusy(false));
          }}
          onPressIn={() => press(0.92)}
          onPressOut={() => press(1)}
          style={[
            {
              width: SIZE,
              height: SIZE,
              borderRadius: SIZE / 2,
              alignItems: "center",
              justifyContent: "center",
              opacity: busy ? 0.5 : 1,
            },
            !liquid && { backgroundColor: colors.accent },
            !liquid && s.fabShadow,
          ]}
        >
          {liquid && (
            <GlassView
              glassEffectStyle="regular"
              colorScheme={dark ? "dark" : "light"}
              tintColor={colors.accent}
              isInteractive
              style={{
                position: "absolute",
                width: SIZE,
                height: SIZE,
                borderRadius: SIZE / 2,
              }}
            />
          )}
          <JournalIcon name="plus" color={colors.onAccent} size={26} />
        </Pressable>
      </Animated.View>
    </View>
  );
}
