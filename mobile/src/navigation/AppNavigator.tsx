import { PendingScreen } from "../screens/PendingScreen";
import { LocalIntakeScreen } from "../screens/LocalIntakeScreen";
import { AssetLibraryScreen, AssetDetailScreen } from "../screens/AssetLibraryScreen";
import { ReadingDownloadsScreen, OfflineReadingScreen } from "../screens/ReadingScreens";
import { NavigationContainer, type Theme } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { Pressable, StyleSheet, View } from "react-native";
import { Text } from "../components/typography";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useApp } from "../state/AppContext";
import { TimelineScreen } from "../screens/TimelineScreen";
import { CaptureScreen } from "../screens/CaptureScreen";
import { InboxScreen } from "../screens/InboxScreen";
import { SettingsHubScreen } from "../screens/SettingsHubScreen";
import { WorksScreen } from "../screens/WorksScreen";
import { MemoryScreen } from "../screens/MemoryScreen";
import { SearchScreen } from "../screens/SearchScreen";
import { SettingsScreen } from "../screens/SettingsScreen";
import {
  ImportSessionDetailScreen,
  ImportSessionsScreen,
  PeopleScreen,
  PersonDetailScreen,
} from "../screens/LibraryScreens";
import { CollectionsScreen, CollectionDetailScreen } from "../screens/CollectionScreens";
import { BooksScreen, BookDetailScreen } from "../screens/BookScreens";
import { CalendarScreen } from "../screens/CalendarScreen";
import { InviteFamilyScreen } from "../screens/InviteFamilyScreen";
import { LocalCaptureDetailScreen } from "../screens/LocalCaptureDetailScreen";
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
  Timeline: ["记忆", "◷"],
  Capture: ["记录", "+"],
  Works: ["作品", "▤"],
} as const;

function MainTabs() {
  const { displayMode } = useApp();
  const simple = displayMode === "simple";
  return <Tabs.Navigator screenOptions={({ route, navigation }) => ({
    headerStyle: { backgroundColor: colors.paper },
    headerShadowVisible: false,
    headerTitleStyle: { color: colors.ink, fontWeight: "800" },
    tabBarActiveTintColor: colors.coralDark,
    tabBarInactiveTintColor: colors.muted,
    tabBarHideOnKeyboard: true,
    tabBarButtonTestID: `tab-${route.name.toLowerCase()}`,
    tabBarStyle: { height: simple ? 76 : 64, paddingTop: 5, paddingBottom: simple ? 8 : 6, backgroundColor: colors.card, borderTopColor: colors.line },
    tabBarLabelStyle: { fontSize: simple ? 14 : 11, fontWeight: "700" },
    tabBarIcon: ({ focused }) => <View style={[styles.icon, route.name === "Capture" && styles.captureIcon, focused && route.name !== "Capture" && styles.activeIcon]}><Text style={[styles.iconText, route.name === "Capture" && styles.captureIconText]}>{tabMeta[route.name][1]}</Text></View>,
    title: tabMeta[route.name][0],
    headerRight: () => <Pressable accessibilityRole="button" accessibilityLabel="设置" onPress={() => navigation.getParent()?.navigate("Settings")} style={{ padding: 14 }}><Text style={{ color: colors.coralDark, fontSize: 16 }}>设置</Text></Pressable>,
  })}>
    <Tabs.Screen component={TimelineScreen} name="Timeline" />
    <Tabs.Screen component={CaptureScreen} name="Capture" options={{ tabBarLabelStyle: { color: colors.coralDark, fontSize: simple ? 14 : 11, fontWeight: "800" } }} />
    <Tabs.Screen component={WorksScreen} name="Works" />
  </Tabs.Navigator>;
}

export function AppNavigator() {
  const insets = useSafeAreaInsets();
  const { message, dismissMessage } = useApp();
  return <View style={styles.fill}>
    {message ? <Pressable accessibilityRole="button" accessibilityLabel="同步提示，点按收起" accessibilityHint="点按收起" onPress={dismissMessage} style={[styles.banner, { paddingTop: Math.max(insets.top, 8) }]}><Text numberOfLines={2} accessibilityLiveRegion="polite" style={styles.bannerText}>{message}</Text></Pressable> : null}
    <NavigationContainer theme={navigationTheme}>
      <Stack.Navigator screenOptions={{ headerBackTitle: "返回", headerShadowVisible: false, headerStyle: { backgroundColor: colors.paper }, headerTitleStyle: { color: colors.ink, fontWeight: "800" } }}>
        <Stack.Screen component={MainTabs} name="MainTabs" options={{ headerShown: false }} />
        <Stack.Screen component={MemoryScreen} name="Memory" options={{ title: "记忆" }} />
        <Stack.Screen component={AssetLibraryScreen} name="AssetLibrary" options={{ title: "资料库" }} />
        <Stack.Screen component={AssetDetailScreen} name="AssetDetail" options={{ title: "资料" }} />
        <Stack.Screen component={SearchScreen} name="Search" options={{ title: "搜索" }} />
        <Stack.Screen component={SettingsHubScreen} name="Settings" options={{ title: "设置" }} />
        <Stack.Screen component={SettingsScreen} name="DeviceSettings" options={{ title: "存储与同步" }} />
        <Stack.Screen component={PeopleScreen} name="People" options={{ title: "家人" }} />
        <Stack.Screen component={PendingScreen} name="Pending" options={{title:"待处理"}} />
        <Stack.Screen component={InboxScreen} name="Inbox" options={{ title: "待整理" }} />
        <Stack.Screen component={PersonDetailScreen} name="PersonDetail" options={{ title: "人物" }} />
        <Stack.Screen component={LocalIntakeScreen} name="LocalIntake" options={{ title: "收到的内容" }} />
        <Stack.Screen component={ImportSessionsScreen} name="ImportSessions" options={{ title: "导入会话" }} />
        <Stack.Screen component={ImportSessionDetailScreen} name="ImportSessionDetail" options={{ title: "导入进度" }} />
        <Stack.Screen component={CollectionsScreen} name="Collections" options={{title:"相册与章节"}} />
        <Stack.Screen component={CollectionDetailScreen} name="CollectionDetail" options={{title:"相册"}} />
        <Stack.Screen component={ReadingDownloadsScreen} name="ReadingDownloads" options={{title:"离线收藏"}} />
        <Stack.Screen component={OfflineReadingScreen} name="OfflineReading" options={{title:"离线阅读"}} />
        <Stack.Screen component={BooksScreen} name="Books" options={{title:"家庭书架"}} />
        <Stack.Screen component={BookDetailScreen} name="BookDetail" options={{title:"家庭作品"}} />
        <Stack.Screen component={CalendarScreen} name="Calendar" options={{ title: "记忆日历" }} />
        <Stack.Screen component={InviteFamilyScreen} name="InviteFamily" options={{ title: "邀请家人加入" }} />
        <Stack.Screen component={LocalCaptureDetailScreen} name="LocalCapture" options={{ title: "本机记录" }} />
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
