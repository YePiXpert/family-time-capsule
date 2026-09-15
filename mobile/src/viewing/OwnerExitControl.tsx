import { useCallback, useEffect, useRef, useState } from "react";
import { Platform, Pressable, View } from "react-native";
import { GlassSheet } from "../components/GlassSheet";
import { Text } from "../components/typography";
import { Button } from "../components/ui";
import { useSharedStyles } from "../theme";

/** A deliberate hand-back gesture, not device authentication or an operating-system lock. */
export function OwnerExitControl({ onExit }: { onExit: () => void }) {
  const s = useSharedStyles();
  const [confirming, setConfirming] = useState(false);
  const exitPending = useRef(false);
  useEffect(() => () => { exitPending.current = false; }, []);
  const finishExit = useCallback(() => {
    if (!exitPending.current) return;
    exitPending.current = false;
    onExit();
  }, [onExit]);
  const cancel = () => { exitPending.current = false; setConfirming(false); };
  const confirm = () => {
    exitPending.current = true;
    setConfirming(false);
    // UIKit must dismiss this sheet before its presenting reader or screen.
    if (Platform.OS !== "ios") finishExit();
  };
  return <>
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="长按退出观看"
      accessibilityHint="长按约一秒，再由手机持有人确认。"
      accessibilityActions={[{ name: "ownerExit", label: "请手机持有人确认退出" }]}
      onAccessibilityAction={({ nativeEvent }) => { if (nativeEvent.actionName === "ownerExit") setConfirming(true); }}
      delayLongPress={1200}
      onLongPress={() => setConfirming(true)}
      style={{ minHeight: 48, justifyContent: "center", paddingHorizontal: 8 }}
    ><Text style={s.secondaryText}>长按退出</Text></Pressable>
    <GlassSheet visible={confirming} onClose={cancel} onDismiss={finishExit}>
      <View style={{ gap: 16 }}>
        <Text accessibilityRole="header" style={s.cardTitle}>结束给家人看？</Text>
        <Text style={s.body}>请由手机持有人确认。退出后会恢复相册的完整操作。</Text>
        <Button title="继续观看" onPress={cancel} />
        <Button title="确认退出观看" variant="primary" onPress={confirm} />
      </View>
    </GlassSheet>
  </>;
}
