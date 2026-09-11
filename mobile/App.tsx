import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AppProvider } from "./src/state/AppContext";
import { AppRoot } from "./src/AppRoot";
import { loadCredentials } from "./src/auth/credentials";
import { initializeLocalStore } from "./src/storage/database";
import { colors } from "./src/theme";
import { RecoveryView, ScreenRecoveryBoundary } from "./src/components/RecoveryView";
import type { Credentials } from "./src/types";
import { clearRetiredReminders } from "./src/notifications/cleanup";

void clearRetiredReminders();

export default function App() {
  const [ready, setReady] = useState(false);
  const [startupError, setStartupError] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<Credentials | null>(null);

  const initialize = useCallback(async () => {
    setStartupError(null);
    try {
      const [, stored] = await Promise.all([initializeLocalStore(), loadCredentials()]);
      setCredentials(stored);
    } catch (reason) {
      setStartupError(reason instanceof Error ? `无法打开本机资料：${reason.message}` : "无法打开本机资料。");
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void initialize(), 0);
    return () => clearTimeout(timer);
  }, [initialize]);

  return <GestureHandlerRootView style={{ flex: 1 }}>
    <SafeAreaProvider>
      {!ready ? <View style={styles.center}><ActivityIndicator color={colors.coral} size="large" /></View>
        : startupError ? <RecoveryView title="本机资料暂时无法打开" detail={startupError} retry={initialize} />
        : <AppProvider initialCredentials={credentials}>
          <ScreenRecoveryBoundary><AppRoot /></ScreenRecoveryBoundary>
        </AppProvider>}
    </SafeAreaProvider>
  </GestureHandlerRootView>;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.paper },
});
