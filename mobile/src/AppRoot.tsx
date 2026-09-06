import { ActivityIndicator, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useApp } from "./state/AppContext";
import { AppNavigator } from "./navigation/AppNavigator";
import { OnboardingGate, WelcomeFlow } from "./screens/WelcomeFlow";
import { colors } from "./theme";

/**
 * 启动门禁（1.3）：
 * 1. 已有有效凭据但账号未建家庭 → 初始化门（登录不再被误判失败）；
 * 2. 无凭据且未处理过欢迎页 → 首次启动引导；
 * 3. 其余（含已登录用户升级）→ 直接进入主界面。
 * welcomeSeen 为 null 表示本机状态仍在读取，短暂显示加载态避免闪屏。
 */
export function AppRoot() {
  const { credentials, welcomeSeen, needsOnboarding } = useApp();
  const insets = useSafeAreaInsets();
  const body = (() => {
    if (welcomeSeen === null) {
      return (
        <View style={[styles.center, { paddingTop: insets.top }]}>
          <ActivityIndicator color={colors.coral} size="large" />
        </View>
      );
    }
    if (credentials && needsOnboarding) return <OnboardingGate />;
    if (!credentials && !welcomeSeen) return <WelcomeFlow />;
    return <AppNavigator />;
  })();
  return (
    <View style={styles.fill}>
      <StatusBar style="dark" />
      {body}
    </View>
  );
}

const styles = {
  fill: { flex: 1, backgroundColor: colors.paper },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
} as const;
