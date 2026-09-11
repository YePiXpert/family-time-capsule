import { ActivityIndicator, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useApp } from "./state/AppContext";
import { AppNavigator } from "./navigation/AppNavigator";
import { OnboardingGate, WelcomeFlow } from "./screens/WelcomeFlow";
import { SyncConsentScreen } from "./screens/SyncConsentScreen";
import { TextScaleContext } from "./components/typography";
import { GlassSheetProvider } from "./components/GlassSheet";
import { JournalThemeProvider, useColorTheme } from "./theme";
import { RecoveryView } from "./components/RecoveryView";

/**
 * 启动门禁（1.3）：
 * 1. 已有有效凭据但账号未建家庭 → 初始化门（登录不再被误判失败）；
 * 2. 有待传记录但目的地未获上传授权 → 同步授权门（M4）；
 * 3. 无凭据且未处理过欢迎页 → 首次启动引导；
 * 4. 其余（含已登录用户升级）→ 直接进入主界面。
 * welcomeSeen 为 null 表示本机状态仍在读取，短暂显示加载态避免闪屏。
 */
export function AppRoot() {
  const { credentials, welcomeSeen, needsOnboarding, awaitingSyncConsent, displayMode, themeMode } = useApp();
  return (
    <JournalThemeProvider mode={themeMode ?? "auto"}>
      <TextScaleContext.Provider value={displayMode === "simple" ? 1.2 : 1}>
        <GlassSheetProvider>
          <AppRootBody
            gated={
              welcomeSeen === null ? "loading"
              : credentials && needsOnboarding ? "onboarding"
              : credentials && awaitingSyncConsent ? "consent"
              : !credentials && !welcomeSeen ? "welcome"
              : "app"
            }
          />
        </GlassSheetProvider>
      </TextScaleContext.Provider>
    </JournalThemeProvider>
  );
}

function AppRootBody({ gated }: { gated: "loading" | "onboarding" | "consent" | "welcome" | "app" }) {
  const insets = useSafeAreaInsets();
  const { colors, dark } = useColorTheme();
  const { localReadError, reloadLocal } = useApp();
  return (
    <View style={{ flex: 1, backgroundColor: colors.paper }}>
      <StatusBar style={dark ? "light" : "dark"} />
      {gated === "loading" && localReadError ? (
        <RecoveryView title="本机资料暂时无法读取" detail={localReadError} retry={reloadLocal} />
      ) : gated === "loading" ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingTop: insets.top }}>
          <ActivityIndicator color={colors.coral} size="large" />
        </View>
      ) : gated === "onboarding" ? <OnboardingGate />
        : gated === "consent" ? <SyncConsentScreen />
        : gated === "welcome" ? <WelcomeFlow />
        : <AppNavigator />}
    </View>
  );
}
