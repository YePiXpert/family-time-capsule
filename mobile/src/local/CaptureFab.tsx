import { useState } from "react";
import { Pressable, View } from "react-native";
import Animated, { FadeInUp } from "react-native-reanimated";
import { GlassView } from "expo-glass-effect";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { JournalIcon } from "../components/JournalIcon";
import { useStore } from "./context";
import { useNav } from "./navigation";
import { beginDraft } from "./services";
import {
  ErrorText,
  hapticLight,
  messageOf,
  usePressScale,
  useStyles,
  useTheme,
} from "./ui";

/** 悬浮钮直径与离屏幕右、下边（安全区之上）的距离：书架最后一行按它对齐，字排在它左边。 */
export const FAB_SIZE = 56;
export const FAB_INSET = 20;
const SIZE = FAB_SIZE;

/**
 * 「记一刻」悬浮钮：书架与月册内页共用这一份，别再各写一遍。
 * iOS 液态玻璃下是赤陶 tint 的系统玻璃圆钮，其余平台是实底赤陶加柔和投影。
 * 玻璃圆钮不做淡入、忙碌时只淡图标：祖先透明度小于 1 时系统不画玻璃，
 * 书架上就只剩一支白铅笔（1.0.0 真机截图）。
 * 按压：玻璃只用系统 isInteractive 的反馈，不再叠一层缩放；纸面圆钮轻缩（MOTION.pressScale）。
 */
export function CaptureFab() {
  const store = useStore(),
    nav = useNav(),
    s = useStyles(),
    { colors, dark, liquid, reduceMotion } = useTheme();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const press = usePressScale();
  return (
    <View
      pointerEvents="box-none"
      style={{
        position: "absolute",
        right: FAB_INSET,
        bottom: insets.bottom + FAB_INSET,
        alignItems: "flex-end",
        gap: 8,
      }}
    >
      <ErrorText message={error} />
      <Animated.View
        entering={
          reduceMotion || liquid
            ? undefined
            : FadeInUp.delay(240).duration(360)
        }
        style={liquid ? undefined : press.style}
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
          onPressIn={liquid ? undefined : press.onPressIn}
          onPressOut={liquid ? undefined : press.onPressOut}
          style={[
            {
              width: SIZE,
              height: SIZE,
              borderRadius: SIZE / 2,
              alignItems: "center",
              justifyContent: "center",
              opacity: busy && !liquid ? 0.5 : 1,
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
          <View style={{ opacity: busy && liquid ? 0.5 : 1 }}>
            <JournalIcon name="edit" color={colors.onAccent} size={24} />
          </View>
        </Pressable>
      </Animated.View>
    </View>
  );
}
