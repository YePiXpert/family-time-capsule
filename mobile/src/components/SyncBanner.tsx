import { useEffect } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppActions, useSyncStatus } from "../state/AppContext";
import { useColorTheme } from "../theme";
import { Text } from "./typography";

/** Sync messages float over content; mounting and dismissing never resize navigation. */
export function SyncBanner() {
  const insets = useSafeAreaInsets();
  const { colors } = useColorTheme();
  const { message } = useSyncStatus();
  const { dismissMessage } = useAppActions();
  useEffect(() => {
    if (!message || !/^已同步 \d+ 段回忆。$/.test(message)) return;
    const timer = setTimeout(dismissMessage, message === "已同步 0 段回忆。" ? 0 : 4000);
    return () => clearTimeout(timer);
  }, [message, dismissMessage]);
  if (!message || message === "已同步 0 段回忆。") return null;
  // Keep the compact native header's back button usable while a notice is up.
  return <View pointerEvents="box-none" style={[styles.bannerOverlay, { top: insets.top + 64 }]}><Pressable testID="sync-banner" accessibilityRole="button" accessibilityLabel="同步提示，点按收起" accessibilityHint="点按收起" onPress={dismissMessage} style={[styles.banner, { backgroundColor: colors.softSage, borderColor: colors.line }]}><Text accessibilityLiveRegion="polite" style={[styles.bannerText, { color: colors.sage }]}>{message}</Text></Pressable></View>;
}

const styles = StyleSheet.create({
  bannerOverlay: { position: "absolute", left: 20, right: 20, zIndex: 10 },
  banner: { paddingHorizontal: 16, paddingVertical: 12, borderRadius: 12, borderWidth: 1 },
  bannerText: { fontSize: 12, fontWeight: "700", textAlign: "center" },
});
