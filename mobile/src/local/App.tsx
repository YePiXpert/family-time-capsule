import {
  Component,
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  ActivityIndicator,
  AppState,
  Text as NativeText,
  View,
  Pressable,
} from "react-native";
import {
  NavigationContainer,
  DefaultTheme,
  DarkTheme,
} from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { StatusBar } from "expo-status-bar";
import { subscribeToPendingNativeShares } from "../../modules/share-intake/src";
import { openLocalStore } from "./disk";
import { ensureDirectories } from "./files";
import { StoreContext, useLibrary, useStore } from "./context";
import {
  LocalTheme,
  Button,
  ErrorText,
  Page,
  Text,
  messageOf,
  useStyles,
  useTheme,
} from "./ui";
import type { LocalStore } from "./store";
import type { Routes } from "./navigation";
import { JournalIcon } from "../components/JournalIcon";
import { Timeline } from "./Home";
import { Albums, AlbumScreen, Picker, AlbumDetails } from "./Albums";
import { Settings, Profile, Appearance, Storage, Backup } from "./Settings";
import { Editor } from "./Editor";
import { RecordScreen } from "./Record";
import { MediaScreen } from "./Media";
import { receiveShares } from "./services";
const Stack = createNativeStackNavigator<Routes>();
const Tabs = createBottomTabNavigator<{
  Timeline: undefined;
  Albums: undefined;
  Settings: undefined;
}>();
function Home() {
  const { colors } = useTheme();
  return (
    <Tabs.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          backgroundColor: colors.card,
          borderTopColor: colors.line,
        },
        tabBarLabelStyle: { fontSize: 13 },
      }}
    >
      <Tabs.Screen
        name="Timeline"
        component={Timeline}
        options={{
          title: "记录",
          tabBarButtonTestID: "tab-records",
          tabBarIcon: ({ color }) => (
            <JournalIcon name="growth" color={color} size={24} />
          ),
        }}
      />
      <Tabs.Screen
        name="Albums"
        component={Albums}
        options={{
          title: "相册",
          tabBarButtonTestID: "tab-albums",
          tabBarIcon: ({ color }) => (
            <JournalIcon name="book" color={color} size={24} />
          ),
        }}
      />
      <Tabs.Screen
        name="Settings"
        component={Settings}
        options={{
          title: "我的",
          tabBarButtonTestID: "tab-profile",
          tabBarIcon: ({ color }) => (
            <JournalIcon name="person" color={color} size={24} />
          ),
        }}
      />
    </Tabs.Navigator>
  );
}
function Root() {
  const state = useLibrary(),
    store = useStore(),
    s = useStyles(),
    theme = useTheme();
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let draining = false;
    const drain = async () => {
      if (draining) return;
      draining = true;
      try {
        await receiveShares(store);
      } catch (e) {
        setError(messageOf(e));
      } finally {
        draining = false;
      }
    };
    void drain();
    const sub = AppState.addEventListener("change", (status) => {
      if (status === "active") void drain();
    });
    const unsubscribe = subscribeToPendingNativeShares(() => {
      void drain();
    });
    return () => {
      sub.remove();
      unsubscribe();
    };
  }, [store]);
  if (!state.welcome)
    return (
      <Page>
        <View style={{ minHeight: 140 }} />
        <Text style={s.muted}>小美成长记</Text>
        <Text style={s.title}>记下今天的小事</Text>
        <Text>写几句话，留一张照片，慢慢整理成相册。</Text>
        <Text style={s.muted}>记录保存在这台设备，随时回看。</Text>
        <ErrorText message={error} />
        <Button
          title="开始记录"
          testID="welcome-start"
          primary
          disabled={busy}
          onPress={() => {
            setBusy(true);
            void store
              .change((s) => {
                s.welcome = true;
              })
              .catch((e) => setError(messageOf(e)))
              .finally(() => setBusy(false));
          }}
        />
      </Page>
    );
  return (
    <>
      <StatusBar style={theme.dark ? "light" : "dark"} />
      <NavigationContainer
        theme={{
          ...(theme.dark ? DarkTheme : DefaultTheme),
          colors: {
            ...(theme.dark ? DarkTheme : DefaultTheme).colors,
            background: theme.colors.paper,
            card: theme.colors.paper,
            text: theme.colors.ink,
            primary: theme.colors.accent,
            border: theme.colors.line,
          },
        }}
      >
        {error ? (
          <View style={{ padding: 12, backgroundColor: theme.colors.card }}>
            <ErrorText message={error} />
            <Button
              title="重试接收素材"
              onPress={() => {
                void receiveShares(store)
                  .then(() => setError(""))
                  .catch((e) => setError(messageOf(e)));
              }}
            />
          </View>
        ) : null}
        <Stack.Navigator
          screenOptions={{
            headerBackTitle: "返回",
            headerShadowVisible: false,
            contentStyle: { backgroundColor: theme.colors.paper },
            animation: "none",
          }}
        >
          <Stack.Screen
            name="Home"
            component={Home}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="Editor"
            component={Editor}
            options={{ title: "记一刻" }}
          />
          <Stack.Screen
            name="Record"
            component={RecordScreen}
            options={{ title: "这一刻" }}
          />
          <Stack.Screen
            name="Album"
            component={AlbumScreen}
            options={{ title: "相册" }}
          />
          <Stack.Screen
            name="Picker"
            component={Picker}
            options={{ title: "选择记录" }}
          />
          <Stack.Screen
            name="AlbumDetails"
            component={AlbumDetails}
            options={{ title: "新建相册" }}
          />
          <Stack.Screen
            name="Media"
            component={MediaScreen}
            options={{ title: "查看素材" }}
          />
          <Stack.Screen
            name="Profile"
            component={Profile}
            options={{ title: "宝宝资料" }}
          />
          <Stack.Screen
            name="Storage"
            component={Storage}
            options={{ title: "本机存储" }}
          />
          <Stack.Screen
            name="Backup"
            component={Backup}
            options={{ title: "备份与恢复" }}
          />
          <Stack.Screen
            name="Appearance"
            component={Appearance}
            options={{ title: "外观设置" }}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </>
  );
}
class Boundary extends Component<{ children: ReactNode }, { error: string }> {
  state = { error: "" };
  static getDerivedStateFromError(e: Error) {
    return { error: e.message };
  }
  render() {
    if (this.state.error)
      return (
        <View style={{ padding: 32, flex: 1, justifyContent: "center" }}>
          <NativeText>页面暂时无法打开，已保存的资料仍在本机。</NativeText>
          <NativeText>{this.state.error}</NativeText>
          <Pressable
            accessibilityRole="button"
            onPress={() => this.setState({ error: "" })}
            style={{ padding: 20 }}
          >
            <NativeText>重试</NativeText>
          </Pressable>
        </View>
      );
    return this.props.children;
  }
}
export default function App() {
  const [store, setStore] = useState<LocalStore | null>(null),
    [error, setError] = useState("");
  const initialize = useCallback(async () => {
    setError("");
    try {
      ensureDirectories();
      setStore(await openLocalStore());
    } catch (e) {
      setError(messageOf(e));
    }
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => {
      void initialize();
    }, 0);
    return () => clearTimeout(timer);
  }, [initialize]);
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <Boundary>
          {store ? (
            <StoreContext.Provider value={store}>
              <LocalTheme>
                <Root />
              </LocalTheme>
            </StoreContext.Provider>
          ) : (
            <View
              style={{
                flex: 1,
                padding: 32,
                justifyContent: "center",
                gap: 20,
                backgroundColor: "#F7F8F5",
              }}
            >
              {error ? (
                <>
                  <NativeText>本机资料暂时无法打开</NativeText>
                  <NativeText>{error}</NativeText>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      void initialize();
                    }}
                    style={{ padding: 20 }}
                  >
                    <NativeText>重试读取</NativeText>
                  </Pressable>
                </>
              ) : (
                <ActivityIndicator color="#426A58" />
              )}
            </View>
          )}
        </Boundary>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
