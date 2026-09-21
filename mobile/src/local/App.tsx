import { Conflicts } from "../sync/Conflicts";
import { useSyncStatusValue } from "../sync/status";
import { useAutoSync } from "../sync/auto";
import { AISettingsScreen } from "../ai/Settings";
import { RecoveryCode } from "../sync/RecoveryCode";
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
  useColorScheme,
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
import { APP_NAME } from "./brand";
import { inspectBackup, recoverStartupBackup, retainedBackups } from "./backup";
import { StatusBar } from "expo-status-bar";
import { subscribeToPendingNativeShares } from "../../modules/share-intake/src";
import { openLocalStore } from "./disk";
import { ensureDirectories, verifyMedia } from "./files";
import * as LocalAuthentication from "expo-local-authentication";
import {
  StoreContext,
  SyncStatusContext,
  useLibrary,
  useStore,
} from "./context";
import {
  LocalTheme,
  Button,
  ErrorText,
  Glass,
  Page,
  Text,
  messageOf,
  paletteOf,
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
import {
  Settings,
  Profile,
  Appearance,
  Signature,
  Storage,
  Backup,
} from "./Settings";
import { Editor } from "./Editor";
import { RecordScreen } from "./Record";
import { MediaScreen } from "./Media";
import { LetterEditor } from "./LetterEditor";
import { LetterScreen } from "./LetterScreen";
import { Quotes } from "./Quotes";
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
        <Text style={s.muted}>{APP_NAME}</Text>
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
  const store = useStore();
  const syncStatus = useSyncStatusValue();
  useAutoSync(store);
  const state = useLibrary(),
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
          <Text style={s.muted}>{APP_NAME}</Text>
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
    <SyncStatusContext.Provider value={syncStatus}>
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
            <ErrorText message={error} />
            <Button
              title="重试接收"
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
            // 原生页头下线：返回与标题由 Page 基元的页内顶栏绘制（见 DESIGN.md 统一规则）。
            headerShown: false,
            contentStyle: { backgroundColor: theme.colors.paper },
            animation: reduceMotion ? "none" : "fade",
          }}
        >
          <Stack.Screen name="Shelf" component={Shelf} />
          <Stack.Screen name="Search" component={SearchScreen} />
          <Stack.Screen name="Month" component={Month} />
          <Stack.Screen name="Year" component={Year} />
          <Stack.Screen name="Recap" component={RecapScreen} />
          <Stack.Screen name="Firsts" component={Firsts} />
          <Stack.Screen name="Footprint" component={Footprint} />
          <Stack.Screen name="People" component={People} />
          <Stack.Screen name="Title" component={TitlePage} />
          <Stack.Screen name="Settings" component={Settings} />
          <Stack.Screen name="Editor" component={Editor} />
          <Stack.Screen name="Record" component={RecordScreen} />
          <Stack.Screen name="Album" component={AlbumScreen} />
          <Stack.Screen name="Series" component={SeriesScreen} />
          <Stack.Screen name="Picker" component={Picker} />
          <Stack.Screen name="AlbumDetails" component={AlbumDetails} />
          <Stack.Screen name="Media" component={MediaScreen} />
          <Stack.Screen name="Profile" component={Profile} />
          <Stack.Screen name="Storage" component={Storage} />
          <Stack.Screen name="Backup" component={Backup} />
          <Stack.Screen name="AISettings" component={AISettingsScreen} />
          <Stack.Screen name="Appearance" component={Appearance} />
          <Stack.Screen name="Signature" component={Signature} />
          <Stack.Screen name="LetterEditor" component={LetterEditor} />
          <Stack.Screen name="Letter" component={LetterScreen} />
          <Stack.Screen name="Quotes" component={Quotes} />
          <Stack.Screen name="Conflicts" component={Conflicts} />
          <Stack.Screen name="RecoveryCode" component={RecoveryCode} />
        </Stack.Navigator>
      </NavigationContainer>
    </SyncStatusContext.Provider>
  );
}
function BoundaryFallback({
  error,
  onRetry,
}: {
  error: string;
  onRetry: () => void;
}) {
  const c = paletteOf(useColorScheme() === "dark");
  return (
    <View
      style={{
        padding: 32,
        flex: 1,
        justifyContent: "center",
        backgroundColor: c.paper,
      }}
    >
      <NativeText style={{ color: c.ink }}>
        页面暂时无法打开，已保存的资料仍在本机。
      </NativeText>
      <NativeText style={{ color: c.muted }}>{error}</NativeText>
      <Pressable
        accessibilityRole="button"
        onPress={onRetry}
        style={{ padding: 20 }}
      >
        <NativeText style={{ color: c.accent }}>重试</NativeText>
      </Pressable>
    </View>
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
        <BoundaryFallback
          error={this.state.error}
          onRetry={() => this.setState({ error: "" })}
        />
      );
    return this.props.children;
  }
}
export default function App() {
  const [store, setStore] = useState<LocalStore | null>(null),
    [error, setError] = useState("");
  const boot = paletteOf(useColorScheme() === "dark");
  const initialize = useCallback(async () => {
    setError("");
    try {
      // 先开库（里面做改名迁移），再建目录：反过来会先把新名字的目录建出来，
      // 改名那一步就以为新目录已经有人了，直接跳过。
      const opened = await openLocalStore();
      ensureDirectories();
      setStore(opened);
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
      let files = existing ? [existing] : [];
      if (!files.length) {
        // 分卷备份要把几卷一起选中；单份备份多选一个就行。
        const selected = await DocumentPicker.getDocumentAsync({
          type: "*/*",
          copyToCacheDirectory: true,
          multiple: true,
        });
        if (selected.canceled) return;
        files = selected.assets.map((asset) => new File(asset.uri));
      }
      const selectedFiles = files;
      const library = await inspectBackup(selectedFiles);
      Alert.alert(
        "从备份恢复？",
        `这份备份里有 ${Object.keys(library.records).length} 段时光、${Object.keys(library.albums).length} 本相册。原有文件会保留，恢复后以这份备份继续使用。`,
        [
          { text: "取消", style: "cancel" },
          {
            text: "恢复备份",
            onPress: () => {
              setRecovering(true);
              void recoverStartupBackup(selectedFiles)
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
    if (!error || store) return;
    let cancelled = false;
    void (async () => {
      // 清单备份（.xmbm）与旧的整份 .xmb 都算候选，最新的在前。
      const candidates = retainedBackups();
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
                backgroundColor: boot.paper,
              }}
            >
              {error ? (
                <>
                  <NativeText style={{ color: boot.ink }}>
                    本机资料暂时无法打开
                  </NativeText>
                  <NativeText style={{ color: boot.muted }}>{error}</NativeText>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      void initialize();
                    }}
                    style={{ padding: 20 }}
                  >
                    <NativeText style={{ color: boot.accent }}>
                      重试读取
                    </NativeText>
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
                      <NativeText style={{ color: boot.accent }}>
                        从最近的本机备份恢复
                      </NativeText>
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
                    <NativeText style={{ color: boot.accent }}>
                      {recovering ? "正在恢复…" : "从完整备份恢复"}
                    </NativeText>
                  </Pressable>
                </>
              ) : (
                <ActivityIndicator color={boot.accent} />
              )}
            </View>
          )}
        </Boundary>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
