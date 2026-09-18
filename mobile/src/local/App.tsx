import { AISettingsScreen } from "../ai/Settings";
import {
  Component,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  StyleSheet,
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
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useReducedMotion } from "react-native-reanimated";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { inspectBackup, recoverStartupBackup } from "./backup";
import { StatusBar } from "expo-status-bar";
import { subscribeToPendingNativeShares } from "../../modules/share-intake/src";
import { openLocalStore } from "./disk";
import { backupDirectory, ensureDirectories, verifyMedia } from "./files";
import * as LocalAuthentication from "expo-local-authentication";
import { StoreContext, useLibrary, useStore } from "./context";
import {
  LocalTheme,
  Button,
  ErrorText,
  Glass,
  Page,
  Text,
  messageOf,
  useStyles,
  useTheme,
} from "./ui";
import type { LocalStore } from "./store";
import type { Routes } from "./navigation";
import { Month } from "./Home";
import { Year } from "./Year";
import { SearchScreen } from "./SearchScreen";
import { RecapScreen } from "./RecapScreen";
import { Firsts, Shelf, TitlePage } from "./Shelf";
import { AlbumScreen, Picker, AlbumDetails } from "./Albums";
import { SeriesScreen } from "./Series";
import { Footprint } from "./Footprint";
import { People } from "./People";
import { Settings, Profile, Appearance, Storage, Backup } from "./Settings";
import { Editor } from "./Editor";
import { RecordScreen } from "./Record";
import { MediaScreen } from "./Media";
import { receiveShares } from "./services";
import { healthFile } from "./health-file";
const Stack = createNativeStackNavigator<Routes>();
function LockGate({ onUnlock }: { onUnlock: () => void }) {
  const s = useStyles();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const unlock = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: "解锁成长记",
        cancelLabel: "取消",
      });
      if (result.success) onUnlock();
      else setError("没有解锁成功，再试一次。");
    } catch {
      // 设备未设置任何锁屏方式时不把用户锁死在门外。
      setError("此设备没有可用的锁屏验证，已暂时放行。");
      onUnlock();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Page top>
      <View style={{ minHeight: 140 }} />
      <Glass radius={24} style={{ padding: 20, gap: 12 }}>
        <Text style={s.muted}>小美成长记</Text>
        <Text style={s.title}>这些时光只属于你们</Text>
        <Text style={s.muted}>用指纹、面容或锁屏密码解锁继续。</Text>
        <ErrorText message={error} />
        <Button
          title={busy ? "正在验证…" : "解锁"}
          primary
          testID="lock-unlock"
          disabled={busy}
          onPress={() => {
            void unlock();
          }}
        />
      </Glass>
    </Page>
  );
}

function Root() {
  const state = useLibrary(),
    store = useStore(),
    s = useStyles(),
    theme = useTheme();
  const reduceMotion = useReducedMotion();
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [locked, setLocked] = useState(state.settings.lockEnabled === true);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (status) => {
      // 退到后台即重新上锁；回到前台由解锁门接管。
      if (status !== "active" && state.settings.lockEnabled) setLocked(true);
    });
    return () => sub.remove();
  }, [state.settings.lockEnabled]);
  // 闲时巡检：每次退到后台完整校验少量素材，跨会话逐步覆盖全库。
  const patrolled = useRef(new Set<string>());
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
    const patrolSome = async () => {
      let checked = 0;
      for (const m of Object.values(store.get().media)) {
        if (checked >= 3) break;
        if (patrolled.current.has(m.id)) continue;
        patrolled.current.add(m.id);
        checked++;
        try {
          await verifyMedia(m);
        } catch {
          // 巡检只读不写；损坏素材由保存/备份路径报告。
        }
      }
    };
    const sub = AppState.addEventListener("change", (status) => {
      if (status === "active") void drain();
      else {
        void patrolSome();
        // 退后台顺手把健康统计落盘。
        void healthFile().flush();
      }
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
      <Page top>
        <View style={{ minHeight: 120 }} />
        <Glass radius={24} style={{ padding: 20, gap: 12 }}>
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
        </Glass>
      </Page>
    );
  if (locked)
    return (
      <>
        <StatusBar style={theme.dark ? "light" : "dark"} />
        <LockGate onUnlock={() => setLocked(false)} />
      </>
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
          <View
            style={{
              padding: 12,
              backgroundColor: theme.colors.glass,
              borderBottomWidth: StyleSheet.hairlineWidth,
              borderBottomColor: theme.colors.glassLine,
            }}
          >
            {" "}
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
            headerStyle: { backgroundColor: theme.colors.card },
            contentStyle: { backgroundColor: theme.colors.paper },
            animation: reduceMotion ? "none" : "fade",
          }}
        >
          <Stack.Screen
            name="Shelf"
            component={Shelf}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="Search"
            component={SearchScreen}
            options={{ title: "搜索" }}
          />
          <Stack.Screen
            name="Month"
            component={Month}
            options={{ title: "" }}
          />
          <Stack.Screen
            name="Year"
            component={Year}
            options={{ title: "" }}
          />
          <Stack.Screen
            name="Recap"
            component={RecapScreen}
            options={{ title: "年度回顾" }}
          />
          <Stack.Screen
            name="Firsts"
            component={Firsts}
            options={{ title: "" }}
          />
          <Stack.Screen
            name="Footprint"
            component={Footprint}
            options={{ title: "足迹" }}
          />
          <Stack.Screen
            name="People"
            component={People}
            options={{ title: "整理人物" }}
          />
          <Stack.Screen
            name="Title"
            component={TitlePage}
            options={{ title: "" }}
          />
          <Stack.Screen
            name="Settings"
            component={Settings}
            options={{ title: "我的" }}
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
            name="Series"
            component={SeriesScreen}
            options={{ title: "时光系列" }}
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
            name="AISettings"
            component={AISettingsScreen}
            options={{ title: "AI 设置" }}
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
    return { error: messageOf(e) };
  }
  render() {
    if (this.state.error)
      return (
        <View
          style={{
            padding: 32,
            flex: 1,
            justifyContent: "center",
            backgroundColor: "#FAF5EC",
          }}
        >
          <NativeText style={{ color: "#3B3129" }}>
            页面暂时无法打开，已保存的资料仍在本机。
          </NativeText>
          <NativeText style={{ color: "#3B3129" }}>{this.state.error}</NativeText>
          <Pressable
            accessibilityRole="button"
            onPress={() => this.setState({ error: "" })}
            style={{ padding: 20 }}
          >
            <NativeText style={{ color: "#3B3129" }}>重试</NativeText>
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
  const [recovering, setRecovering] = useState(false);
  const recover = async (existing?: File) => {
    if (recovering) return;
    setRecovering(true);
    try {
      let file = existing;
      if (!file) {
        const selected = await DocumentPicker.getDocumentAsync({
          type: "*/*",
          copyToCacheDirectory: true,
        });
        if (selected.canceled) return;
        file = new File(selected.assets[0]!.uri);
      }
      const selectedFile = file;
      const library = await inspectBackup(selectedFile);
      Alert.alert(
        "从备份恢复？",
        `备份包含 ${Object.keys(library.records).length} 条记录、${Object.keys(library.albums).length} 本相册。原有文件会保留，恢复后以这份备份继续使用。`,
        [
          { text: "取消", style: "cancel" },
          {
            text: "恢复备份",
            onPress: () => {
              setRecovering(true);
              void recoverStartupBackup(selectedFile)
                .then(initialize)
                .catch((e) => setError(messageOf(e)))
                .finally(() => setRecovering(false));
            },
          },
        ],
      );
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setRecovering(false);
    }
  };

  const [verifiedBackup, setVerifiedBackup] = useState<File | null>(null);
  useEffect(() => {
    if (!error || store || !backupDirectory.exists) return;
    let cancelled = false;
    void (async () => {
      const candidates = backupDirectory
        .list()
        .filter(
          (f): f is File => f instanceof File && f.name.endsWith(".xmb"),
        )
        .sort((a, b) => b.name.localeCompare(a.name));
      // 推荐位只放完整可读的备份；损坏文件静默跳过，不留一个必然失败的按钮。
      for (const file of candidates) {
        try {
          await inspectBackup(file);
          if (!cancelled) setVerifiedBackup(file);
          return;
        } catch {
          // try the next candidate
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [error, store]);
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
                backgroundColor: "#FAF5EC",
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
                  {verifiedBackup && (
                    <Pressable
                      accessibilityRole="button"
                      disabled={recovering}
                      onPress={() => {
                        void recover(verifiedBackup);
                      }}
                      style={{ padding: 20 }}
                    >
                      <NativeText>从最近的本机备份恢复</NativeText>
                    </Pressable>
                  )}
                  <Pressable
                    accessibilityRole="button"
                    disabled={recovering}
                    onPress={() => {
                      void recover();
                    }}
                    style={{ padding: 20 }}
                  >
                    <NativeText>
                      {recovering ? "正在恢复…" : "从完整备份恢复"}
                    </NativeText>
                  </Pressable>
                </>
              ) : (
                <ActivityIndicator color="#B4553C" />
              )}
            </View>
          )}
        </Boundary>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
