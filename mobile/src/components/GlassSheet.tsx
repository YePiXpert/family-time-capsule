import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Animated, Modal, Pressable, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { haptics } from "../design/haptics";
import { journalGlass, journalMotion, journalRadius, journalSpace, journalType } from "../design/tokens";
import { useAccessibleEffects } from "../design/use-effects";
import { useColorTheme } from "../theme";
import { GlassSurface } from "./GlassSurface";
import { Text } from "./typography";

/**
 * 玻璃底部弹层（M2）：替换系统 Alert 的确认交互。模态透明 + 下滑手势关闭 +
 * RN Animated 弹簧；减少动态时只做淡入淡出，减少透明时由 GlassSurface 退回纯色。
 */

export type GlassSheetProps = {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
};

export function GlassSheet({ visible, onClose, children }: GlassSheetProps) {
  const { scheme } = useColorTheme();
  const { reducedMotion } = useAccessibleEffects();
  const insets = useSafeAreaInsets();
  const [progress] = useState(() => new Animated.Value(0));
  const [dragY] = useState(() => new Animated.Value(0));
  const [sheetHeight, setSheetHeight] = useState(0);

  useEffect(() => {
    if (!visible) return;
    dragY.setValue(0);
    if (reducedMotion) {
      progress.setValue(1);
      return;
    }
    progress.setValue(0);
    Animated.spring(progress, { toValue: 1, ...journalMotion.spring, useNativeDriver: true }).start();
  }, [visible, reducedMotion, progress, dragY]);

  const dismiss = useCallback(() => {
    if (reducedMotion) {
      progress.setValue(0);
      onClose();
      return;
    }
    Animated.parallel([
      Animated.timing(progress, { toValue: 0, duration: journalMotion.sheetDuration / 2, useNativeDriver: true }),
      Animated.spring(dragY, { toValue: 0, ...journalMotion.spring, useNativeDriver: false }),
    ]).start(() => onClose());
  }, [reducedMotion, progress, dragY, onClose]);

  const pan = useMemo(() => Gesture.Pan()
    .activeOffsetY(10)
    .failOffsetY(-10)
    .onUpdate(event => {
      if (!reducedMotion && event.translationY > 0) dragY.setValue(event.translationY);
    })
    .onEnd(event => {
      if (reducedMotion) return;
      if (event.translationY > 120 || event.velocityY > 600) dismiss();
      else Animated.spring(dragY, { toValue: 0, ...journalMotion.spring, useNativeDriver: false }).start();
    }), [reducedMotion, dragY, dismiss]);

  const slide = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [sheetHeight > 0 ? sheetHeight : 480, 0],
  });
  const scrimOpacity = progress.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={dismiss} statusBarTranslucent>
      <GestureHandlerRootView style={styles.fill}>
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: journalGlass.scrim[scheme], opacity: scrimOpacity }]} />
        <Pressable accessibilityRole="button" accessibilityLabel="关闭" onPress={dismiss} style={StyleSheet.absoluteFill} />
        <Animated.View pointerEvents="box-none" style={[styles.sheetHolder, { transform: reducedMotion ? [] : [{ translateY: slide }] }]}>
          <GestureDetector gesture={pan}>
            <Animated.View
              onLayout={event => setSheetHeight(event.nativeEvent.layout.height)}
              style={[styles.sheet, { paddingBottom: insets.bottom + journalSpace.medium, transform: reducedMotion ? [] : [{ translateY: dragY }] }]}
            >
              <GlassSurface tier="sheet" interactive />
              <View style={styles.grabber} />
              {children}
            </Animated.View>
          </GestureDetector>
        </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  );
}

export type ConfirmSheetOptions = {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
};

type GlassSheetContextValue = {
  confirm: (options: ConfirmSheetOptions) => Promise<boolean>;
};

const GlassSheetContext = createContext<GlassSheetContextValue | null>(null);

let confirmImpl: ((options: ConfirmSheetOptions) => Promise<boolean>) | null = null;

/** 模块级确认 API（与 hook 等价）；Provider 未挂载时安全回退为 false。 */
export function confirmSheet(options: ConfirmSheetOptions): Promise<boolean> {
  return confirmImpl ? confirmImpl(options) : Promise.resolve(false);
}

type ConfirmRequest = { options: ConfirmSheetOptions; resolve: (value: boolean) => void };

export function GlassSheetProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const confirm = useCallback((options: ConfirmSheetOptions) => new Promise<boolean>(resolve => setRequest({ options, resolve })), []);
  useEffect(() => {
    confirmImpl = confirm;
    return () => { if (confirmImpl === confirm) confirmImpl = null; };
  }, [confirm]);
  const settle = useCallback((value: boolean) => {
    setRequest(current => {
      current?.resolve(value);
      return null;
    });
  }, []);
  return (
    <GlassSheetContext.Provider value={{ confirm }}>
      {children}
      <ConfirmSheet request={request} onSettle={settle} />
    </GlassSheetContext.Provider>
  );
}

function ConfirmSheet({ request, onSettle }: { request: ConfirmRequest | null; onSettle: (value: boolean) => void }) {
  const { colors } = useColorTheme();
  const options = request?.options;
  const close = useCallback((value: boolean) => {
    haptics.selection();
    onSettle(value);
  }, [onSettle]);
  return (
    <GlassSheet visible={request !== null} onClose={() => close(false)}>
      {options ? (
        <View style={styles.confirmBody}>
          <Text accessibilityRole="header" style={[styles.confirmTitle, { color: colors.ink }]}>{options.title}</Text>
          {options.message ? <Text style={[styles.confirmMessage, { color: colors.muted }]}>{options.message}</Text> : null}
          <View style={styles.confirmActions}>
            <Pressable accessibilityRole="button" accessibilityLabel={options.cancelLabel ?? "取消"} onPress={() => close(false)} style={({ pressed }) => [styles.cancelButton, { borderColor: colors.line }, pressed && styles.pressed]}>
              <Text style={[styles.cancelLabel, { color: colors.coralDark }]}>{options.cancelLabel ?? "取消"}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={options.confirmLabel ?? "确定"}
              onPress={() => close(true)}
              style={({ pressed }) => [
                styles.confirmButton,
                options.destructive
                  ? { backgroundColor: colors.errorSoft, borderColor: colors.dangerLine }
                  : { backgroundColor: colors.coral, borderColor: colors.coral },
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.confirmLabel, { color: options.destructive ? colors.error : colors.onCoral }]}>{options.confirmLabel ?? "确定"}</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </GlassSheet>
  );
}

export function useConfirmSheet() {
  const context = useContext(GlassSheetContext);
  if (!context) throw new Error("GlassSheetProvider is missing");
  return context.confirm;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  sheetHolder: { flex: 1, justifyContent: "flex-end" },
  sheet: {
    borderTopLeftRadius: journalRadius.sheet,
    borderTopRightRadius: journalRadius.sheet,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    overflow: "hidden",
    paddingHorizontal: journalSpace.page,
    paddingTop: journalSpace.small,
  },
  grabber: {
    alignSelf: "center",
    width: 40,
    height: 5,
    borderRadius: journalRadius.pill,
    backgroundColor: "rgba(120,100,90,0.35)",
    marginBottom: journalSpace.medium,
  },
  confirmBody: { gap: journalSpace.small, paddingTop: journalSpace.hair },
  confirmTitle: { fontSize: journalType.heading, fontWeight: "800", textAlign: "center" },
  confirmMessage: { fontSize: journalType.body, lineHeight: 22, textAlign: "center" },
  confirmActions: { flexDirection: "row", gap: journalSpace.small, marginTop: journalSpace.small },
  cancelButton: {
    flex: 1,
    minHeight: 50,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: journalRadius.control,
    borderWidth: 1,
    backgroundColor: "transparent",
  },
  cancelLabel: { fontSize: journalType.body, fontWeight: "700" },
  confirmButton: { flex: 1, minHeight: 50, alignItems: "center", justifyContent: "center", borderRadius: journalRadius.control, borderWidth: 1 },
  confirmLabel: { fontSize: journalType.body, fontWeight: "700" },
  pressed: { opacity: 0.72 },
});
