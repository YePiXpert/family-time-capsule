import { NavigationContainer, type Theme } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useApp } from "../state/AppContext";
import { HomeScreen } from "../screens/HomeScreen";
import { TimelineScreen } from "../screens/TimelineScreen";
import { CaptureScreen } from "../screens/CaptureScreen";
import { InboxScreen } from "../screens/InboxScreen";
import { MoreScreen } from "../screens/MoreScreen";
import { MemoryScreen } from "../screens/MemoryScreen";
import { SearchScreen } from "../screens/SearchScreen";
import { SettingsScreen } from "../screens/SettingsScreen";
import { colors } from "../theme";
import type { MainTabParamList, RootStackParamList } from "./types";

const Tabs = createBottomTabNavigator<MainTabParamList>();
const Stack = createNativeStackNavigator<RootStackParamList>();

const navigationTheme: Theme = {
  dark: false,
  colors: { primary: colors.coral, background: colors.paper, card: colors.card, text: colors.ink, border: colors.line, notification: colors.coral },
  fonts: {
    regular: { fontFamily: "System", fontWeight: "400" },
    medium: { fontFamily: "System", fontWeight: "600" },
    bold: { fontFamily: "System", fontWeight: "700" },
    heavy: { fontFamily: "System", fontWeight: "800" },
  },
};

const tabMeta = {
  Home: ["首页", "⌂"],
  Timeline: ["时间轴", "◷"],
  Capture: ["记录", "+"],
  Inbox: ["收件箱", "▣"],
  More: ["更多", "•••"],
} as const;

function MainTabs() {
  const { home, outbox } = useApp();
  const inboxCount = home?.inbox.count ?? outbox.length;
  return <Tabs.Navigator screenOptions={({ route }) => ({
    headerStyle: { backgroundColor: colors.paper },
    headerShadowVisible: false,
    headerTitleStyle: { color: colors.ink, fontWeight: "800" },
    tabBarActiveTintColor: colors.coralDark,
    tabBarInactiveTintColor: colors.muted,
    tabBarHideOnKeyboard: true,
    tabBarStyle: { height: 64, paddingTop: 5, paddingBottom: 6, backgroundColor: colors.card, borderTopColor: colors.line },
    tabBarLabelStyle: { fontSize: 11, fontWeight: "700" },
    tabBarIcon: ({ focused }) => <View style={[styles.icon, route.name === "Capture" && styles.captureIcon, focused && route.name !== "Capture" && styles.activeIcon]}><Text style={[styles.iconText, route.name === "Capture" && styles.captureIconText]}>{tabMeta[route.name][1]}</Text></View>,
    title: tabMeta[route.name][0],
  })}>
    <Tabs.Screen component={HomeScreen} name="Home" />
    <Tabs.Screen component={TimelineScreen} name="Timeline" />
    <Tabs.Screen component={CaptureScreen} name="Capture" options={{ tabBarLabelStyle: { color: colors.coralDark, fontSize: 11, fontWeight: "800" } }} />
    <Tabs.Screen component={InboxScreen} name="Inbox" options={{ tabBarBadge: inboxCount > 0 ? Math.min(inboxCount, 99) : undefined, tabBarBadgeStyle: { backgroundColor: colors.coral, color: "#FFFFFF", fontSize: 10 } }} />
    <Tabs.Screen component={MoreScreen} name="More" />
  </Tabs.Navigator>;
}

export function AppNavigator() {
  const insets = useSafeAreaInsets();
  const { message, dismissMessage } = useApp();
  return <View style={styles.fill}>
    {message ? <Pressable accessibilityHint="点按收起" onPress={dismissMessage} style={[styles.banner, { paddingTop: Math.max(insets.top, 8) }]}><Text numberOfLines={2} style={styles.bannerText}>{message}</Text></Pressable> : null}
    <NavigationContainer theme={navigationTheme}>
      <Stack.Navigator screenOptions={{ headerBackTitle: "返回", headerShadowVisible: false, headerStyle: { backgroundColor: colors.paper }, headerTitleStyle: { color: colors.ink, fontWeight: "800" } }}>
        <Stack.Screen component={MainTabs} name="MainTabs" options={{ headerShown: false }} />
        <Stack.Screen component={MemoryScreen} name="Memory" options={{ title: "记忆" }} />
        <Stack.Screen component={SearchScreen} name="Search" options={{ title: "搜索" }} />
        <Stack.Screen component={SettingsScreen} name="Settings" options={{ title: "设置" }} />
      </Stack.Navigator>
    </NavigationContainer>
  </View>;
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.paper },
  icon: { minWidth: 28, height: 25, alignItems: "center", justifyContent: "center", borderRadius: 13 },
  activeIcon: { backgroundColor: colors.softCoral },
  iconText: { color: colors.muted, fontSize: 15, fontWeight: "900" },
  captureIcon: { width: 38, height: 38, borderRadius: 19, marginTop: -10, backgroundColor: colors.coral },
  captureIconText: { color: "#FFFFFF", fontSize: 25, lineHeight: 28 },
  banner: { backgroundColor: colors.softSage, paddingHorizontal: 16, paddingBottom: 8 },
  bannerText: { color: colors.sage, fontSize: 12, lineHeight: 17, fontWeight: "700", textAlign: "center" },
});
