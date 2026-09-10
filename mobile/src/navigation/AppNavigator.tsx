import { journalMotion } from "../design/tokens";
import { createRef, useEffect, useRef, useState, type RefObject } from "react";
import { BlurTargetView } from "expo-blur";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { GlassSurface } from "../components/GlassSurface";
import { JournalIcon, type JournalIconName } from "../components/JournalIcon";
import { JournalDockHeightContext } from "./dock-metrics";
import { useAccessibleEffects } from "../design/use-effects";
import { PendingScreen } from "../screens/PendingScreen";
import { LocalIntakeScreen } from "../screens/LocalIntakeScreen";
import { AssetLibraryScreen, AssetDetailScreen } from "../screens/AssetLibraryScreen";
import { ReadingDownloadsScreen, OfflineReadingScreen } from "../screens/ReadingScreens";
import { NavigationContainer, type Theme } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { Keyboard, Pressable, StyleSheet, View } from "react-native";
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
import { useColorTheme } from "../theme";
import type { JournalPalette } from "../design/tokens";
import type { MainTabParamList, RootStackParamList } from "./types";

const Tabs = createBottomTabNavigator<MainTabParamList>();
const Stack = createNativeStackNavigator<RootStackParamList>();

function navigationTheme(palette: JournalPalette, dark: boolean): Theme {
  return {
    dark,
    colors: { primary: palette.coral, background: palette.paper, card: palette.card, text: palette.ink, border: palette.line, notification: palette.coral },
    fonts: {
      regular: { fontFamily: "System", fontWeight: "400" },
      medium: { fontFamily: "System", fontWeight: "600" },
      bold: { fontFamily: "System", fontWeight: "700" },
      heavy: { fontFamily: "System", fontWeight: "800" },
    },
  };
}

const tabMeta: Record<string, { label: string; icon: JournalIconName }> = {
  Timeline: { label: "成长", icon: "growth" },
  Works: { label: "成长册", icon: "book" },
  Profile: { label: "我的", icon: "person" },
};

function JournalTabBar({ state, descriptors, navigation, target, onHeight }: BottomTabBarProps & { target: RefObject<View | null>; onHeight: (height: number) => void }) {
  const { viewer, credentials, displayMode } = useApp();
  const { reducedMotion } = useAccessibleEffects();
  const { colors } = useColorTheme();
  const insets = useSafeAreaInsets();
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", () => setKeyboardOpen(true));
    const hide = Keyboard.addListener("keyboardDidHide", () => setKeyboardOpen(false));
    return () => { show.remove(); hide.remove(); };
  }, []);
  const current = state.routes[state.index];
  const canCapture = !credentials || viewer?.canCapture;
  if (!current || keyboardOpen) return null;
  return <View onLayout={event => onHeight(event.nativeEvent.layout.height)} style={[styles.dock, { paddingBottom: Math.max(insets.bottom, 10) }]}>
    {current.name !== "Capture" && canCapture ? <Pressable accessibilityRole="button" accessibilityLabel="记录一刻" onPress={() => navigation.navigate("Capture")} style={({ pressed }) => [styles.floatingCapture, { boxShadow: `0 6px 24px ${colors.scrim}` }, pressed && !reducedMotion && styles.pressed]}>
      <GlassSurface target={target} />
      <JournalIcon name="plus" color={colors.coralDark} size={22} />
      <Text style={[styles.captureLabel, { color: colors.coralDark }]}>记录一刻</Text>
    </Pressable> : null}
    <View style={[styles.tabRow, { boxShadow: `0 6px 24px ${colors.scrim}` }, displayMode === "simple" && { minHeight: 84 }]}>
      <GlassSurface target={target} />
      {state.routes.filter(route => route.name !== "Capture").map(route => {
        const meta = tabMeta[route.name] ?? { label: route.name, icon: "growth" as JournalIconName };
        const focused = current.key === route.key;
        return <Pressable key={route.key} accessibilityRole="tab" accessibilityLabel={meta.label} accessibilityState={{ selected: focused }} testID={`tab-${route.name.toLowerCase()}`} onPress={() => {
          const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
        }} onLongPress={() => navigation.emit({ type: "tabLongPress", target: route.key })} style={({ pressed }) => [styles.tabItem, pressed && !reducedMotion && styles.pressed]}>
          <View style={[styles.tabIcon, focused && { backgroundColor: colors.softCoral }]}><JournalIcon name={meta.icon} color={focused ? colors.coralDark : colors.muted} /></View>
          <Text style={[styles.tabLabel, { color: focused ? colors.coralDark : colors.muted }, displayMode === "simple" && { fontSize: 16 }]}>{descriptors[route.key]?.options.tabBarAccessibilityLabel ?? meta.label}</Text>
        </Pressable>;
      })}
    </View>
  </View>;
}

function MainTabs() {
  const { reducedMotion } = useAccessibleEffects();
  const { colors } = useColorTheme();
  const insets = useSafeAreaInsets();
  const [dockHeight, setDockHeight] = useState(84 + Math.max(insets.bottom, 10));
  const targets = useRef(new Map<string, RefObject<View | null>>());
  const targetFor = (key: string) => {
    if (!targets.current.has(key)) targets.current.set(key, createRef<View>());
    return targets.current.get(key)!;
  };
  return <JournalDockHeightContext.Provider value={dockHeight}><Tabs.Navigator
    tabBar={props => <JournalTabBar {...props} onHeight={setDockHeight} target={targetFor(props.state.routes[props.state.index]?.key ?? "empty")} />}
    screenLayout={({ children, route }) => <BlurTargetView ref={targetFor(route.key)} style={styles.fill}>{children}</BlurTargetView>}
    screenOptions={{
      headerStyle: { backgroundColor: colors.paper }, headerShadowVisible: false,
      headerTitleStyle: { color: colors.ink, fontWeight: "600" },
      headerTintColor: colors.coralDark,
      animation: reducedMotion ? "none" : "fade", transitionSpec: { animation: "timing", config: { duration: reducedMotion ? 0 : journalMotion.duration } }, tabBarHideOnKeyboard: true,
    }}>
    <Tabs.Screen component={TimelineScreen} name="Timeline" options={{ headerShown: false }} />
    <Tabs.Screen component={WorksScreen} name="Works" options={{ title: "成长册", headerShown: false }} />
    <Tabs.Screen component={SettingsHubScreen} name="Profile" options={{ title: "我的", headerShown: false }} />
    {/* Keep the existing capture route for pending shares and durable draft links. */}
    <Tabs.Screen component={CaptureScreen} name="Capture" options={{ title: "记录一刻", headerShown: false }} />
  </Tabs.Navigator></JournalDockHeightContext.Provider>;
}

export function AppNavigator() {
  const insets = useSafeAreaInsets();
  const { reducedMotion } = useAccessibleEffects();
  const { colors, dark } = useColorTheme();
  const { message, dismissMessage } = useApp();
  return <View style={[styles.fill, { backgroundColor: colors.paper }]}>
    {message ? <Pressable accessibilityRole="button" accessibilityLabel="同步提示，点按收起" accessibilityHint="点按收起" onPress={dismissMessage} style={[styles.banner, { paddingTop: Math.max(insets.top, 8), backgroundColor: colors.softSage }]}><Text numberOfLines={2} accessibilityLiveRegion="polite" style={[styles.bannerText, { color: colors.sage }]}>{message}</Text></Pressable> : null}
    <NavigationContainer theme={navigationTheme(colors, dark)}>
      <Stack.Navigator screenOptions={{ animation: reducedMotion ? "none" : "fade", animationDuration: reducedMotion ? 0 : journalMotion.duration, headerBackTitle: "返回", headerShadowVisible: false, headerStyle: { backgroundColor: colors.paper }, headerTitleStyle: { color: colors.ink, fontWeight: "800" }, headerTintColor: colors.coralDark, contentStyle: { backgroundColor: colors.paper } }}>
        <Stack.Screen component={MainTabs} name="MainTabs" options={{ headerShown: false }} />
        <Stack.Screen component={MemoryScreen} name="Memory" options={{ title: "成长记录" }} />
        <Stack.Screen component={AssetLibraryScreen} name="AssetLibrary" options={{ title: "资料库" }} />
        <Stack.Screen component={AssetDetailScreen} name="AssetDetail" options={{ title: "资料" }} />
        <Stack.Screen component={SearchScreen} name="Search" options={{ title: "搜索" }} />
        <Stack.Screen component={SettingsHubScreen} name="Settings" options={{ title: "我的" }} />
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
  fill: { flex: 1 },
  dock: { position: "absolute", bottom: 0, left: 16, right: 16 },
  tabRow: { flexDirection: "row", minHeight: 72, borderRadius: 28, overflow: "hidden" },
  tabItem: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 8, gap: 3 },
  tabIcon: { paddingHorizontal: 20, paddingVertical: 5, borderRadius: 18 },
  tabLabel: { fontSize: 12.5, fontWeight: "600" },
  floatingCapture: { alignSelf: "flex-end", minHeight: 52, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 18, marginBottom: 12, borderRadius: 26, overflow: "hidden" },
  pressed: { transform: [{ scale: 0.96 }] },
  captureLabel: { fontSize: 16, fontWeight: "700", paddingVertical: 12 },
  banner: { paddingHorizontal: 16, paddingBottom: 8 },
  bannerText: { fontSize: 12, lineHeight: 17, fontWeight: "700", textAlign: "center" },
});
