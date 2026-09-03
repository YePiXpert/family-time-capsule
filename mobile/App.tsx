import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import * as Crypto from "expo-crypto";
import * as ImagePicker from "expo-image-picker";
import * as Network from "expo-network";
import { signIn, signOut } from "./src/api/client";
import {
  clearCredentials,
  loadCredentials,
  saveCredentials,
} from "./src/auth/credentials";
import {
  clearLocalArchive,
  enqueueMediaCapture,
  enqueueTextCapture,
  getCachedFamily,
  getCachedViewer,
  getMeta,
  initializeLocalStore,
  listOutbox,
  listTimeline,
  removeOutboxItem,
} from "./src/storage/database";
import {
  clearLocalFiles,
  preservePickedMedia,
  removeLocalFile,
} from "./src/storage/files";
import { syncArchive } from "./src/sync/sync";
import type {
  Credentials,
  Family,
  LocalTimelineEvent,
  MediaCapturePayload,
  OutboxItem,
  Viewer,
} from "./src/types";

const COLORS = {
  ink: "#2F241F",
  muted: "#786B64",
  paper: "#FFF9F2",
  card: "#FFFFFF",
  line: "#EADDD0",
  coral: "#C9634D",
  coralDark: "#994734",
  sage: "#577566",
  softSage: "#E8F0EB",
  softCoral: "#F8E9E3",
  warning: "#9A651C",
};

type Tab = "timeline" | "capture" | "settings";

function dateLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

function ageLabel(ageDays: number | null): string | null {
  if (ageDays === null || ageDays < 0) return null;
  if (ageDays < 31) return `${ageDays} 天`;
  if (ageDays < 730) return `${Math.floor(ageDays / 30.4375)} 个月`;
  const years = Math.floor(ageDays / 365.2425);
  const months = Math.floor((ageDays - years * 365.2425) / 30.4375);
  return `${years} 岁${months > 0 ? ` ${months} 个月` : ""}`;
}

function ServerConnectionForm({
  onLogin,
}: {
  onLogin: (credentials: Credentials) => Promise<void>;
}) {
  const [serverUrl, setServerUrl] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!serverUrl.trim() || !email.trim() || !password) {
      setError("请填写服务器地址、邮箱和密码。");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await onLogin(await signIn(serverUrl, email, password));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "登录失败。");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.connectionSection}>
      <Text style={styles.connectionTitle}>连接家庭服务器（可选）</Text>
      <Text style={styles.connectionText}>
        不连接也可一直在本机记录。连接后才会上传待同步内容并下载家庭时间轴。
      </Text>
      <View style={styles.formCard}>
        <Text style={styles.label}>家庭服务器</Text>
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          onChangeText={setServerUrl}
          placeholder="https://capsule.example.com"
          placeholderTextColor="#A99A92"
          style={styles.input}
          value={serverUrl}
        />
        <Text style={styles.label}>邮箱</Text>
        <TextInput
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          onChangeText={setEmail}
          placeholder="name@example.com"
          placeholderTextColor="#A99A92"
          style={styles.input}
          value={email}
        />
        <Text style={styles.label}>密码</Text>
        <TextInput
          autoCapitalize="none"
          autoComplete="current-password"
          onChangeText={setPassword}
          placeholder="家庭服务器密码"
          placeholderTextColor="#A99A92"
          secureTextEntry
          style={styles.input}
          value={password}
        />
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        <Pressable
          disabled={submitting}
          onPress={submit}
          style={({ pressed }) => [
            styles.primaryButton,
            pressed && styles.pressed,
            submitting && styles.disabled,
          ]}
        >
          {submitting ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.primaryButtonText}>连接并同步</Text>
          )}
        </Pressable>
      </View>
      <Text style={styles.securityNote}>
        凭据只保存在系统 Keychain/Keystore；生产服务器请使用 HTTPS。
      </Text>
    </View>
  );
}

function TimelineCard({ item }: { item: LocalTimelineEvent }) {
  const age = ageLabel(item.ageDays);
  return (
    <View style={styles.timelineCard}>
      {item.localCoverUri ? (
        <Image source={{ uri: item.localCoverUri }} style={styles.cover} />
      ) : (
        <View style={styles.coverPlaceholder}>
          <Text style={styles.coverPlaceholderText}>
            {item.assetCount > 0 ? `${item.assetCount} 份素材` : "一段回忆"}
          </Text>
        </View>
      )}
      <View style={styles.timelineBody}>
        {item.source === "local" ? (
          <Text style={styles.localBadge}>
            {item.syncState === "synced" ? "本机保存 · 已同步" : "本机保存 · 待同步"}
          </Text>
        ) : null}
        <Text style={styles.timelineDate}>{dateLabel(item.occurredAt)}</Text>
        <Text numberOfLines={2} style={styles.timelineTitle}>
          {item.title}
        </Text>
        <View style={styles.metaRow}>
          {age ? <Text style={styles.agePill}>{age}</Text> : null}
          {item.participantNames.length > 0 ? (
            <Text numberOfLines={1} style={styles.peopleText}>
              {item.participantNames.join(" · ")}
            </Text>
          ) : null}
        </View>
        {item.locationText ? (
          <Text numberOfLines={1} style={styles.locationText}>
            {item.locationText}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function TimelineScreen({
  events,
  refreshing,
  pendingCount,
  syncEnabled,
  onRefresh,
}: {
  events: LocalTimelineEvent[];
  refreshing: boolean;
  pendingCount: number;
  syncEnabled: boolean;
  onRefresh: () => void;
}) {
  return (
    <FlatList
      contentContainerStyle={events.length === 0 ? styles.emptyList : styles.list}
      data={events}
      keyExtractor={(item) => item.id}
      ListEmptyComponent={
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>本机还没有回忆</Text>
          <Text style={styles.emptyText}>
            {syncEnabled
              ? "下拉同步家庭时间轴，或先在“记录”里写下一刻。"
              : "先在“记录”里写下一刻；需要时可在设置中开启同步。"}
          </Text>
        </View>
      }
      ListHeaderComponent={
        pendingCount > 0 ? (
          <View style={styles.pendingBanner}>
            <Text style={styles.pendingBannerText}>
              {pendingCount} 条记录安全保存在本机，
              {syncEnabled ? "联网后自动补传" : "开启同步后再补传"}
            </Text>
          </View>
        ) : null
      }
      refreshControl={
        <RefreshControl
          onRefresh={onRefresh}
          refreshing={refreshing}
          tintColor={COLORS.coral}
        />
      }
      renderItem={({ item }) => <TimelineCard item={item} />}
    />
  );
}

function CaptureScreen({
  pendingCount,
  syncEnabled,
  onQueued,
}: {
  pendingCount: number;
  syncEnabled: boolean;
  onQueued: () => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const saveText = async () => {
    const value = text.trim();
    if (!value || value.length > 5000) {
      setMessage("请输入 1–5000 字。");
      return;
    }
    setSaving(true);
    try {
      await enqueueTextCapture(Crypto.randomUUID(), { text: value });
      setText("");
      setMessage(
        syncEnabled
          ? "已保存到本机，将同步到家庭收件箱。"
          : "已保存到本机；可稍后在设置中开启同步。",
      );
      try {
        await onQueued();
      } catch {
        setMessage("已保存到本机；状态暂未刷新，重开 App 后仍会保留。");
      }
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "无法保存这条文字。");
    } finally {
      setSaving(false);
    }
  };

  const pickMedia = async (source: "camera" | "library") => {
    setSaving(true);
    setMessage(null);
    let unqueuedLocalUri: string | null = null;
    try {
      if (source === "camera") {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          throw new Error("需要相机权限才能拍照；也可以继续从相册选择。");
        }
      }
      const result =
        source === "camera"
          ? await ImagePicker.launchCameraAsync({
              mediaTypes: ["images"],
              allowsEditing: false,
              quality: 1,
            })
          : await ImagePicker.launchImageLibraryAsync({
              mediaTypes: ["images", "videos"],
              allowsEditing: false,
              allowsMultipleSelection: false,
              quality: 1,
              preferredAssetRepresentationMode:
                ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current,
            });
      if (result.canceled) return;
      const id = Crypto.randomUUID();
      const selected = result.assets[0];
      if (!selected) throw new Error("没有读取到所选素材。");
      const payload = await preservePickedMedia(selected, id);
      unqueuedLocalUri = payload.localUri;
      await enqueueMediaCapture(id, payload);
      // From this point the durable outbox owns the private file. A later UI
      // refresh failure must never make us delete an upload that is queued.
      unqueuedLocalUri = null;
      setMessage(
        syncEnabled
          ? "原件已保存到 App 本地空间，将自动补传。"
          : "原件已保存到 App 本地空间；可稍后开启同步。",
      );
      try {
        await onQueued();
      } catch {
        setMessage("原件已保存到本机；状态暂未刷新，重开 App 后仍会保留。");
      }
    } catch (reason) {
      if (unqueuedLocalUri) removeLocalFile(unqueuedLocalUri);
      setMessage(reason instanceof Error ? reason.message : "无法保存所选素材。");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.captureContainer}>
      <Text style={styles.sectionEyebrow}>离线也不会丢</Text>
      <Text style={styles.sectionTitle}>记录此刻</Text>
      <Text style={styles.sectionIntro}>
        文字和原件始终先保存在设备内。开启同步后才会补传，失败也不会删除本机内容。
      </Text>
      <View style={styles.formCard}>
        <Text style={styles.label}>一句话、一段故事</Text>
        <TextInput
          multiline
          onChangeText={setText}
          placeholder="今天发生了什么？"
          placeholderTextColor="#A99A92"
          style={styles.textArea}
          textAlignVertical="top"
          value={text}
        />
        <Text style={styles.counter}>{text.length} / 5000</Text>
        <Pressable
          disabled={saving}
          onPress={saveText}
          style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
        >
          <Text style={styles.primaryButtonText}>保存文字</Text>
        </Pressable>
        <View style={styles.orRow}>
          <View style={styles.orLine} />
          <Text style={styles.orText}>或者</Text>
          <View style={styles.orLine} />
        </View>
        <Pressable
          disabled={saving}
          onPress={() => void pickMedia("camera")}
          style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
        >
          <Text style={styles.secondaryButtonText}>现在拍一张照片</Text>
        </Pressable>
        <Pressable
          disabled={saving}
          onPress={() => void pickMedia("library")}
          style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
        >
          <Text style={styles.secondaryButtonText}>从相册选择照片或视频</Text>
        </Pressable>
        {message ? <Text style={styles.successText}>{message}</Text> : null}
      </View>
      <View style={styles.localStatusCard}>
        <Text style={styles.localStatusNumber}>{pendingCount}</Text>
        <View style={styles.localStatusCopy}>
          <Text style={styles.localStatusTitle}>条等待同步</Text>
          <Text style={styles.localStatusText}>退出 App 或断网不会清空。</Text>
        </View>
      </View>
    </ScrollView>
  );
}

function SettingsScreen({
  credentials,
  family,
  viewer,
  lastSyncAt,
  online,
  pendingCount,
  failedItems,
  onSync,
  onDiscardFailed,
  onConnect,
  onDisconnect,
  onClearLocal,
}: {
  credentials: Credentials | null;
  family: Family | null;
  viewer: Viewer | null;
  lastSyncAt: string | null;
  online: boolean | null;
  pendingCount: number;
  failedItems: OutboxItem[];
  onSync: () => void;
  onDiscardFailed: () => void;
  onConnect: (credentials: Credentials) => Promise<void>;
  onDisconnect: () => void;
  onClearLocal: () => void;
}) {
  return (
    <ScrollView contentContainerStyle={styles.settingsContainer}>
      <Text style={styles.sectionEyebrow}>设备与同步</Text>
      <Text style={styles.sectionTitle}>{family?.name ?? "家庭时间胶囊"}</Text>
      <View style={styles.settingsCard}>
        <SettingRow label="模式" value={credentials ? "本机 + 同步" : "仅本机"} />
        {credentials ? (
          <>
            <SettingRow label="账号" value={viewer?.name ?? "等待同步"} />
            <SettingRow label="服务器" value={credentials.serverUrl} />
          </>
        ) : null}
        <SettingRow
          label="同步网络"
          value={!credentials ? "未启用" : online === false ? "离线" : "在线"}
        />
        <SettingRow label="等待补传" value={`${pendingCount} 条`} />
        <SettingRow
          label="上次同步"
          value={
            !credentials
              ? "未连接服务器"
              : lastSyncAt
                ? dateLabel(lastSyncAt)
                : "尚未完成"
          }
        />
      </View>
      <View style={styles.privacyCard}>
        <Text style={styles.privacyTitle}>本机保存了什么</Text>
        <Text style={styles.privacyText}>
          时间轴和成员元数据保存在 SQLite；离线封面及待上传原件保存在 App 私有目录；会话令牌保存在系统安全存储。构建产物不含真实家庭数据。
        </Text>
      </View>
      {credentials ? (
        <>
          <Pressable onPress={onSync} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>立即同步</Text>
          </Pressable>
          <Pressable
            onPress={() =>
              Alert.alert(
                "断开家庭服务器？",
                "本机记录和已下载的时间轴都会保留，之后可再次连接。",
                [
                  { text: "取消", style: "cancel" },
                  { text: "确认断开", onPress: onDisconnect },
                ],
              )
            }
            style={styles.logoutButton}
          >
            <Text style={styles.logoutText}>断开家庭服务器</Text>
          </Pressable>
        </>
      ) : (
        <ServerConnectionForm onLogin={onConnect} />
      )}
      {failedItems.length > 0 ? (
        <View style={styles.failedCard}>
          <Text style={styles.failedTitle}>
            {failedItems.length} 条待办上次补传失败
          </Text>
          {failedItems.slice(0, 3).map((item) => (
            <View key={item.id} style={styles.failedItem}>
              <Text numberOfLines={1} style={styles.failedItemName}>
                {item.kind === "media_capture"
                  ? (item.payload as MediaCapturePayload).fileName
                  : (item.payload as { text: string }).text}
              </Text>
              <Text numberOfLines={2} style={styles.failedItemError}>
                {item.lastError ?? "等待重试"} · 已尝试 {item.attemptCount} 次
              </Text>
            </View>
          ))}
          <Text style={styles.failedHint}>
            “立即同步”会重试；确认不再需要时可从本机放弃，服务器已有数据不会删除。
          </Text>
          <Pressable onPress={onDiscardFailed} style={styles.failedDiscardButton}>
            <Text style={styles.logoutText}>放弃这些失败待办</Text>
          </Pressable>
        </View>
      ) : null}
      <Pressable
        onPress={() =>
          Alert.alert(
            "清除本机全部数据？",
            "本机记录、原件、离线缓存和登录凭据都会永久删除；家庭服务器里的数据不会删除。",
            [
              { text: "取消", style: "cancel" },
              { text: "确认清除", style: "destructive", onPress: onClearLocal },
            ],
          )
        }
        style={styles.clearButton}
      >
        <Text style={styles.logoutText}>清除本机全部数据</Text>
      </Pressable>
    </ScrollView>
  );
}

function SettingRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.settingRow}>
      <Text style={styles.settingLabel}>{label}</Text>
      <Text numberOfLines={2} style={styles.settingValue}>
        {value}
      </Text>
    </View>
  );
}

function MainApp({
  credentials,
  onCredentialsChanged,
}: {
  credentials: Credentials | null;
  onCredentialsChanged: (credentials: Credentials | null) => void;
}) {
  const network = Network.useNetworkState();
  const [tab, setTab] = useState<Tab>("timeline");
  const [events, setEvents] = useState<LocalTimelineEvent[]>([]);
  const [family, setFamily] = useState<Family | null>(null);
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [outboxItems, setOutboxItems] = useState<OutboxItem[]>([]);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const syncInFlight = useRef(false);

  const reloadLocal = useCallback(async () => {
    const [nextEvents, nextFamily, nextViewer, nextOutbox, nextSyncAt] =
      await Promise.all([
        listTimeline(),
        getCachedFamily(),
        getCachedViewer(),
        listOutbox(),
        getMeta("last_sync_at"),
      ]);
    setEvents(nextEvents);
    setFamily(nextFamily);
    setViewer(nextViewer);
    setOutboxItems(nextOutbox);
    setLastSyncAt(nextSyncAt);
  }, []);

  const runSync = useCallback(async () => {
    if (!credentials || syncInFlight.current) return;
    syncInFlight.current = true;
    setSyncing(true);
    setSyncMessage(null);
    try {
      const summary = await syncArchive(credentials);
      const uploaded =
        summary.uploadedCount > 0
          ? `，并补传 ${summary.uploadedCount} 条`
          : "";
      const retained =
        summary.failedCount > 0
          ? `；${summary.failedCount} 条未被服务器接受，仍保留在本机`
          : "";
      setSyncMessage(`已同步 ${summary.eventCount} 段回忆${uploaded}${retained}。`);
    } catch (reason) {
      setSyncMessage(
        reason instanceof Error ? reason.message : "同步失败，本地数据不受影响。",
      );
    } finally {
      try {
        await reloadLocal();
      } catch (reason) {
        setSyncMessage(
          reason instanceof Error
            ? `读取本机数据失败：${reason.message}`
            : "读取本机数据失败。",
        );
      } finally {
        setSyncing(false);
        syncInFlight.current = false;
      }
    }
  }, [credentials, reloadLocal]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void reloadLocal()
        .then(() => (credentials ? runSync() : undefined))
        .catch((reason) => {
          setSyncMessage(
            reason instanceof Error
              ? `读取本机数据失败：${reason.message}`
              : "读取本机数据失败。",
          );
        });
    }, 0);
    return () => clearTimeout(timer);
  }, [credentials, reloadLocal, runSync]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (credentials && state === "active") void runSync();
    });
    return () => subscription.remove();
  }, [credentials, runSync]);

  useEffect(() => {
    const subscription = Network.addNetworkStateListener((state) => {
      if (credentials && state.isConnected) void runSync();
    });
    return () => subscription.remove();
  }, [credentials, runSync]);

  const queued = async () => {
    await reloadLocal();
    if (credentials && network.isConnected !== false) await runSync();
  };

  const discardFailed = () => {
    const failed = outboxItems.filter((item) => item.attemptCount > 0);
    if (failed.length === 0) return;
    Alert.alert(
      `放弃 ${failed.length} 条本机待办？`,
      "尚未上传的文字或原件会从这台设备删除，且无法撤销；服务器中已经接收的数据不受影响。",
      [
        { text: "取消", style: "cancel" },
        {
          text: "确认放弃",
          style: "destructive",
          onPress: () => {
            void (async () => {
              for (const item of failed) {
                await removeOutboxItem(item.id);
                if (item.kind === "media_capture") {
                  removeLocalFile((item.payload as MediaCapturePayload).localUri);
                }
              }
              await reloadLocal();
            })().catch((reason) => {
              setSyncMessage(
                reason instanceof Error
                  ? `清理失败：${reason.message}`
                  : "清理失败，请重试。",
              );
            });
          },
        },
      ],
    );
  };

  const connect = async (next: Credentials) => {
    await saveCredentials(next);
    onCredentialsChanged(next);
  };

  const disconnect = async () => {
    if (credentials) await signOut(credentials);
    await clearCredentials();
    onCredentialsChanged(null);
    setSyncMessage("已断开服务器，本机数据保持不变。");
  };

  const clearLocal = async () => {
    if (credentials) await signOut(credentials);
    await Promise.all([clearCredentials(), clearLocalArchive()]);
    clearLocalFiles();
    onCredentialsChanged(null);
    await reloadLocal();
    setSyncMessage("本机数据已清除。");
  };

  return (
    <View style={styles.fill}>
      <View style={styles.appHeader}>
        <View>
          <Text style={styles.headerEyebrow}>家庭档案</Text>
          <Text numberOfLines={1} style={styles.headerTitle}>
            {family?.name ?? "时间胶囊"}
          </Text>
        </View>
        <Pressable
          onPress={() => (credentials ? void runSync() : setTab("settings"))}
          style={styles.syncChip}
        >
          {syncing ? (
            <ActivityIndicator color={COLORS.sage} size="small" />
          ) : (
            <View
              style={[
                styles.networkDot,
                network.isConnected === false && styles.networkDotOffline,
              ]}
            />
          )}
          <Text style={styles.syncChipText}>
            {!credentials
              ? "仅本机"
              : syncing
                ? "同步中"
                : network.isConnected === false
                  ? "离线"
                  : "已连接"}
          </Text>
        </Pressable>
      </View>
      {syncMessage ? (
        <Pressable onPress={() => setSyncMessage(null)} style={styles.syncMessage}>
          <Text numberOfLines={2} style={styles.syncMessageText}>
            {syncMessage}
          </Text>
        </Pressable>
      ) : null}
      <View style={styles.content}>
        {tab === "timeline" ? (
          <TimelineScreen
            events={events}
            onRefresh={() => void (credentials ? runSync() : reloadLocal())}
            pendingCount={outboxItems.length}
            refreshing={syncing}
            syncEnabled={credentials !== null}
          />
        ) : tab === "capture" ? (
          <CaptureScreen
            onQueued={queued}
            pendingCount={outboxItems.length}
            syncEnabled={credentials !== null}
          />
        ) : (
          <SettingsScreen
            credentials={credentials}
            family={family}
            failedItems={outboxItems.filter((item) => item.attemptCount > 0)}
            lastSyncAt={lastSyncAt}
            onClearLocal={() => void clearLocal()}
            onConnect={connect}
            onDisconnect={() => void disconnect()}
            onDiscardFailed={discardFailed}
            onSync={runSync}
            online={network.isConnected ?? null}
            pendingCount={outboxItems.length}
            viewer={viewer}
          />
        )}
      </View>
      <View style={styles.tabBar}>
        <TabButton active={tab === "timeline"} label="时间轴" onPress={() => setTab("timeline")} />
        <TabButton active={tab === "capture"} label="记录" onPress={() => setTab("capture")} />
        <TabButton active={tab === "settings"} label="设置" onPress={() => setTab("settings")} />
      </View>
    </View>
  );
}

function TabButton({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={styles.tabButton}>
      <View style={[styles.tabIndicator, active && styles.tabIndicatorActive]} />
      <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{label}</Text>
    </Pressable>
  );
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [startupError, setStartupError] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<Credentials | null>(null);

  const initialize = useCallback(async () => {
    try {
      const [, stored] = await Promise.all([
        initializeLocalStore(),
        loadCredentials(),
      ]);
      setCredentials(stored);
    } catch (reason) {
      setStartupError(
        reason instanceof Error
          ? `无法打开本机资料：${reason.message}`
          : "无法打开本机资料。",
      );
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void initialize(), 0);
    return () => clearTimeout(timer);
  }, [initialize]);

  const retryInitialization = () => {
    setReady(false);
    setStartupError(null);
    void initialize();
  };

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <SafeAreaView edges={["top", "bottom"]} style={styles.safeArea}>
        {!ready ? (
          <View style={styles.center}>
            <ActivityIndicator color={COLORS.coral} size="large" />
          </View>
        ) : startupError ? (
          <View style={styles.startupError}>
            <Text style={styles.emptyTitle}>本机资料暂时无法打开</Text>
            <Text style={styles.errorText}>{startupError}</Text>
            <Pressable onPress={retryInitialization} style={styles.secondaryButton}>
              <Text style={styles.secondaryButtonText}>重试</Text>
            </Pressable>
          </View>
        ) : (
          <MainApp
            credentials={credentials}
            onCredentialsChanged={setCredentials}
          />
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  safeArea: { flex: 1, backgroundColor: COLORS.paper },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  startupError: {
    flex: 1,
    alignItems: "stretch",
    justifyContent: "center",
    padding: 28,
    gap: 16,
  },
  connectionSection: { gap: 10, marginTop: 4 },
  connectionTitle: { color: COLORS.ink, fontSize: 18, fontWeight: "800" },
  connectionText: { color: COLORS.muted, fontSize: 13, lineHeight: 20 },
  formCard: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.line,
    borderRadius: 22,
    borderWidth: 1,
    padding: 18,
    gap: 10,
  },
  label: { color: COLORS.ink, fontSize: 13, fontWeight: "700", marginTop: 4 },
  input: {
    backgroundColor: COLORS.paper,
    borderColor: COLORS.line,
    borderRadius: 13,
    borderWidth: 1,
    color: COLORS.ink,
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  textArea: {
    minHeight: 150,
    backgroundColor: COLORS.paper,
    borderColor: COLORS.line,
    borderRadius: 14,
    borderWidth: 1,
    color: COLORS.ink,
    fontSize: 17,
    lineHeight: 26,
    padding: 14,
  },
  counter: { color: COLORS.muted, fontSize: 12, textAlign: "right" },
  primaryButton: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 50,
    borderRadius: 14,
    backgroundColor: COLORS.coral,
    marginTop: 6,
    paddingHorizontal: 18,
  },
  primaryButtonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "800" },
  secondaryButton: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 50,
    borderColor: COLORS.coral,
    borderRadius: 14,
    borderWidth: 1.5,
    paddingHorizontal: 18,
  },
  secondaryButtonText: { color: COLORS.coralDark, fontSize: 15, fontWeight: "800" },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.55 },
  errorText: { color: "#A52C2C", fontSize: 13, lineHeight: 19 },
  successText: { color: COLORS.sage, fontSize: 13, lineHeight: 19, marginTop: 4 },
  securityNote: { color: COLORS.muted, fontSize: 12, lineHeight: 18, textAlign: "center" },
  appHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 13,
    borderBottomColor: COLORS.line,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerEyebrow: { color: COLORS.coral, fontSize: 11, fontWeight: "800", letterSpacing: 1.5 },
  headerTitle: { color: COLORS.ink, fontSize: 22, fontWeight: "800", maxWidth: 210 },
  syncChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    borderRadius: 18,
    backgroundColor: COLORS.softSage,
    paddingHorizontal: 11,
    paddingVertical: 8,
  },
  networkDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.sage },
  networkDotOffline: { backgroundColor: COLORS.warning },
  syncChipText: { color: COLORS.sage, fontSize: 12, fontWeight: "700" },
  syncMessage: { backgroundColor: COLORS.softSage, paddingHorizontal: 20, paddingVertical: 8 },
  syncMessageText: { color: COLORS.sage, fontSize: 12, lineHeight: 17 },
  content: { flex: 1 },
  list: { padding: 16, paddingBottom: 30, gap: 13 },
  emptyList: { flexGrow: 1, padding: 20 },
  timelineCard: {
    overflow: "hidden",
    backgroundColor: COLORS.card,
    borderColor: COLORS.line,
    borderRadius: 20,
    borderWidth: 1,
  },
  cover: { width: "100%", height: 190, backgroundColor: COLORS.softCoral },
  coverPlaceholder: {
    height: 90,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.softCoral,
  },
  coverPlaceholderText: { color: COLORS.coralDark, fontSize: 13, fontWeight: "700" },
  timelineBody: { padding: 16, gap: 6 },
  localBadge: { color: COLORS.sage, fontSize: 11, fontWeight: "800" },
  timelineDate: { color: COLORS.coral, fontSize: 12, fontWeight: "800" },
  timelineTitle: { color: COLORS.ink, fontSize: 20, lineHeight: 27, fontWeight: "800" },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 9, marginTop: 3 },
  agePill: {
    overflow: "hidden",
    color: COLORS.sage,
    fontSize: 11,
    fontWeight: "800",
    backgroundColor: COLORS.softSage,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  peopleText: { flex: 1, color: COLORS.muted, fontSize: 12 },
  locationText: { color: COLORS.muted, fontSize: 12 },
  pendingBanner: {
    backgroundColor: "#FFF1D9",
    borderRadius: 13,
    marginBottom: 2,
    padding: 12,
  },
  pendingBannerText: { color: COLORS.warning, fontSize: 13, lineHeight: 18, fontWeight: "600" },
  emptyState: { flex: 1, alignItems: "center", justifyContent: "center", padding: 35, gap: 8 },
  emptyTitle: { color: COLORS.ink, fontSize: 20, fontWeight: "800", textAlign: "center" },
  emptyText: { color: COLORS.muted, fontSize: 14, lineHeight: 21, textAlign: "center" },
  captureContainer: { padding: 20, paddingBottom: 40, gap: 12 },
  settingsContainer: { padding: 20, paddingBottom: 40, gap: 14 },
  sectionEyebrow: { color: COLORS.coral, fontSize: 12, fontWeight: "800", letterSpacing: 1.4 },
  sectionTitle: { color: COLORS.ink, fontSize: 28, fontWeight: "800" },
  sectionIntro: { color: COLORS.muted, fontSize: 14, lineHeight: 22, marginBottom: 4 },
  orRow: { flexDirection: "row", alignItems: "center", gap: 10, marginVertical: 2 },
  orLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: COLORS.line },
  orText: { color: COLORS.muted, fontSize: 12 },
  localStatusCard: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 18,
    backgroundColor: COLORS.softSage,
    padding: 17,
  },
  localStatusNumber: { color: COLORS.sage, fontSize: 32, fontWeight: "900", marginRight: 13 },
  localStatusCopy: { flex: 1 },
  localStatusTitle: { color: COLORS.ink, fontSize: 15, fontWeight: "800" },
  localStatusText: { color: COLORS.muted, fontSize: 12, marginTop: 3 },
  settingsCard: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.line,
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 17,
  },
  settingRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 16,
    borderBottomColor: COLORS.line,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 14,
  },
  settingLabel: { color: COLORS.muted, fontSize: 13 },
  settingValue: { flex: 1, color: COLORS.ink, fontSize: 13, fontWeight: "700", textAlign: "right" },
  privacyCard: { borderRadius: 18, backgroundColor: COLORS.softCoral, padding: 17, gap: 6 },
  privacyTitle: { color: COLORS.coralDark, fontSize: 15, fontWeight: "800" },
  privacyText: { color: COLORS.coralDark, fontSize: 13, lineHeight: 20 },
  failedCard: {
    borderColor: "#E6C68F",
    borderRadius: 18,
    borderWidth: 1,
    backgroundColor: "#FFF7E8",
    padding: 16,
    gap: 10,
  },
  failedTitle: { color: COLORS.warning, fontSize: 15, fontWeight: "800" },
  failedItem: { gap: 2 },
  failedItemName: { color: COLORS.ink, fontSize: 13, fontWeight: "700" },
  failedItemError: { color: COLORS.warning, fontSize: 12, lineHeight: 17 },
  failedHint: { color: COLORS.muted, fontSize: 12, lineHeight: 18 },
  failedDiscardButton: { alignItems: "center", paddingVertical: 7 },
  logoutButton: { alignItems: "center", padding: 14 },
  clearButton: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
    borderColor: "#D9AAA1",
    borderRadius: 14,
    borderWidth: 1,
    marginTop: 10,
    paddingHorizontal: 18,
  },
  logoutText: { color: "#A52C2C", fontSize: 14, fontWeight: "700" },
  tabBar: {
    flexDirection: "row",
    borderTopColor: COLORS.line,
    borderTopWidth: StyleSheet.hairlineWidth,
    backgroundColor: COLORS.card,
    minHeight: 58,
  },
  tabButton: { flex: 1, alignItems: "center", justifyContent: "center", gap: 6 },
  tabIndicator: { width: 24, height: 3, borderRadius: 2, backgroundColor: "transparent" },
  tabIndicatorActive: { backgroundColor: COLORS.coral },
  tabLabel: { color: COLORS.muted, fontSize: 12, fontWeight: "700" },
  tabLabelActive: { color: COLORS.coralDark },
});
