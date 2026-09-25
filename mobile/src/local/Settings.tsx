import { useEffect, useRef, useState } from "react";
import { Alert, Pressable, Switch, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import * as LocalAuthentication from "expo-local-authentication";
import { File } from "expo-file-system";
import { useLibrary, useStore, useSyncStatus } from "./context";
import { useNav } from "./navigation";
import { getToken } from "../family/session";
import { ageLine, birthdayLabel, dateTimeLabel, toDayKey } from "./dates";
import { preserveMedia } from "./files";
import {
  BackupStopped,
  collectBlobs,
  createBackup,
  daysSinceExport,
  inspectBackup,
  listLocalBackups,
  restoreBackup,
  shareBackup,
} from "./backup";
import { planExport, purgeExports, writeVolume } from "./backup-export";
import { collectUnusedMedia } from "./services";
import {
  ArchiveStopped,
  createArchive,
  shareArchive,
  type ArchiveProgress,
} from "./archive";
import { healthFile } from "./health-file";
import { isLocalBusy, isSyncRunning, markLocalBusy } from "../sync/status";
import { conflictMediaIds } from "../sync/conflicts";
import {
  forgetMergeHistory,
  readConflicts,
  subscribeSyncFiles,
} from "../sync/state";
import { changeAvgMs } from "./health";
import { APP_NAME, CHILD_FALLBACK } from "./brand";
import { JournalIcon } from "../components/JournalIcon";
import {
  BY_PRESETS,
  referencedMedia,
  sealInitial,
  stampUnsigned,
  unsignedRecords,
  yearKey,
} from "./model";
import {
  Button,
  Card,
  ErrorText,
  Field,
  Ornament,
  Page,
  SectionHeader,
  SettingsGroup,
  SettingsRow,
  SignatureButton,
  Stamp,
  Text,
  dateLabel,
  messageOf,
  serif,
  useStyles,
  useTheme,
} from "./ui";
import { Photo } from "./Media";
/** 「我的」入口页：顶部宝宝档案卡，下面分组设置行，副题把最要紧的状态带出来，不用点进去看。 */
export function Settings() {
  const sync = useSyncStatus();
  const state = useLibrary(),
    nav = useNav(),
    s = useStyles(),
    { colors } = useTheme();
  const [aiState, setAiState] = useState<string | undefined>(undefined);
  useEffect(() => {
    let live = true;
    // 只看本机有没有家庭令牌，不联网：离线打开「我的」也不该转圈或报错。
    getToken()
      .then((token) => {
        if (live) setAiState(token ? "已加入家庭" : "还没加入家庭");
      })
      .catch(() => {
        if (live) setAiState("还没加入家庭");
      });
    return () => {
      live = false;
    };
  }, []);
  const name = state.profile.name.trim() || CHILD_FALLBACK,
    birthday = birthdayLabel(state.profile.birthday),
    age = ageLine(state.profile.birthday),
    exportedDays = daysSinceExport(state),
    bytes = Object.values(state.media).reduce((n, m) => n + m.bytes, 0),
    theme = { auto: "跟随系统", light: "浅色", dark: "深色" }[
      state.settings.theme
    ];
  const initial = sealInitial(name);
  return (
    <Page title="我的">
      {/* 按压透明度落在卡片里面：卡片在 iOS 是液态玻璃，祖先一变透明玻璃就不画了。 */}
      <Card style={{ padding: 0 }}>
        <Pressable
          testID="settings-profile"
          accessibilityRole="button"
          accessibilityLabel={`${name}的资料`}
          accessibilityValue={{
            text: birthday ? (age ?? `生日 ${birthday}`) : "还没填生日",
          }}
          onPress={() => nav.navigate("Profile")}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            padding: 16,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Stamp size={56} inset={4}>
            <Text
              style={{
                fontFamily: serif,
                fontSize: 24,
                lineHeight: 30,
                color: colors.accent,
                fontWeight: "600",
              }}
            >
              {initial}
            </Text>
          </Stamp>
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Text
              style={{
                fontFamily: serif,
                fontSize: 20,
                lineHeight: 26,
                fontWeight: "600",
                letterSpacing: 0.3,
              }}
            >
              {name}
            </Text>
            <Text style={s.muted}>
              {birthday ? (age ?? `生日 ${birthday}`) : "还没填生日，点这里补上"}
            </Text>
          </View>
          <JournalIcon name="chevron-right" color={colors.muted} size={18} />
        </Pressable>
      </Card>
      {/* 五行设置收在一张纸卡里，不分组、不挂区标题：几张一行的小卡叠起来像一摞盒子。 */}
      <SettingsGroup>
        <SettingsRow
          icon="edit"
          label="我的落款"
          subtitle={
            state.settings.by ? `—— ${state.settings.by}` : "还没定，记一刻时会问"
          }
          onPress={() => nav.navigate("Signature")}
        />
        <SettingsRow
          icon="archive"
          label="备份与恢复"
          subtitle={
            sync.conflicts > 0
              ? `有 ${sync.conflicts} 段两台手机都改过`
              : sync.running
                ? "正在同步…"
                : sync.lastError
                  ? "上次同步没成功，点开看看"
                  : sync.joined
                    ? sync.lastSyncAt
                      ? `上次同步 ${dateTimeLabel(sync.lastSyncAt)}`
                      : "已加入家人一起写，还没同步过"
                    : exportedDays === null
                      ? "还没导出过备份"
                      : exportedDays === 0
                        ? "今天导出过"
                        : `上次导出 ${exportedDays} 天前`
          }
          onPress={() => nav.navigate("Backup")}
        />
        <SettingsRow
          icon="phone"
          label="本机存储"
          subtitle={`照片和录音占用 ${(bytes / 1048576).toFixed(1)} MB`}
          onPress={() => nav.navigate("Storage")}
        />
        <SettingsRow
          icon="person"
          label="家庭与设备"
          subtitle={aiState}
          testID="settings-family"
          onPress={() => nav.navigate("Family")}
        />
        <SettingsRow
          icon="appearance"
          label="外观设置"
          subtitle={state.settings.largeText ? `${theme} · 更大文字` : theme}
          onPress={() => nav.navigate("Appearance")}
          last
        />
      </SettingsGroup>
      {/* 页尾像书的版权页：一枚装饰线，下面一行书名与那句诗。 */}
      <View style={{ gap: 8, paddingTop: 8 }}>
        <Ornament />
        <Text style={[s.footnote, { textAlign: "center" }]}>
          {APP_NAME} · 入淮清洛渐漫漫
        </Text>
      </View>
    </Page>
  );
}
/** 「我的落款」：这台手机默认的称呼，新草稿自动带上；顺手把以前没落款的也写上。 */
export function Signature() {
  const state = useLibrary(),
    store = useStore(),
    s = useStyles();
  const [error, setError] = useState("");
  const [stamped, setStamped] = useState<number | null>(null);
  const by = state.settings.by;
  const unsigned = unsignedRecords(state).length;
  const used = new Map<string, number>();
  for (const r of Object.values(state.records))
    if (r.by) used.set(r.by, (used.get(r.by) ?? 0) + 1);
  const options = [
    ...new Set([
      ...[...used.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh"))
        .map(([name]) => name),
      ...BY_PRESETS,
    ]),
  ];
  return (
    <Page title="我的落款">
      <Text style={s.muted}>
        用这台手机记下的每一段时光，都会署上这个称呼。家人一起写时，她长大后就能认出哪一段是谁写的。
      </Text>
      <Card>
        <SignatureButton
          value={by}
          options={options}
          initiallyOpen
          testID="settings-by"
          onChange={(next) => {
            setStamped(null);
            void store
              .change((lib) => {
                const settings = { ...lib.settings };
                if (next) settings.by = next;
                else delete settings.by;
                lib.settings = settings;
              })
              .catch((e) => setError(messageOf(e)));
          }}
        />
      </Card>
      {by && unsigned > 0 && (
        <Card>
          <Text>{`以前的 ${unsigned} 段时光还没有落款。`}</Text>
          <Text style={s.muted}>{`都是${by}写的话，一次写上；不是的就别点。`}</Text>
          <Button
            title={`都写上「${by}」`}
            testID="settings-by-stamp"
            onPress={() => {
              void store
                .change((lib) => {
                  setStamped(stampUnsigned(lib, by));
                  lib.nudgeClosedAt = { ...lib.nudgeClosedAt, by: new Date().toISOString() };
                })
                .catch((e) => setError(messageOf(e)));
            }}
          />
        </Card>
      )}
      {stamped !== null && (
        <Text style={s.muted}>{`已给 ${stamped} 段时光写上落款。`}</Text>
      )}
      <ErrorText message={error} />
    </Page>
  );
}
export function Profile() {
  const state = useLibrary(),
    store = useStore(),
    s = useStyles();
  const [name, setName] = useState(state.profile.name),
    [fullName, setFullName] = useState(state.profile.fullName ?? ""),
    [motto, setMotto] = useState(state.profile.motto ?? ""),
    [birthday, setBirthday] = useState(state.profile.birthday),
    [message, setMessage] = useState("");
  return (
    <Page title="宝宝资料">
      <Text style={s.muted}>资料可以随时补充，不影响记录。</Text>
      {state.profile.avatarId && (
        <Photo media={state.media[state.profile.avatarId]} />
      )}
      <Button
        title="选择头像"
        onPress={() => {
          void (async () => {
            const p = await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (!p.granted) throw new Error("请允许选择照片。");
            const r = await ImagePicker.launchImageLibraryAsync({
              mediaTypes: ["images"],
            });
            if (r.canceled) return;
            const a = r.assets[0]!;
            const m = await preserveMedia(
              a.uri,
              a.fileName ?? "头像.jpg",
              "image",
            );
            await store.change((s) => {
              s.media[m.id] = m;
              s.profile.avatarId = m.id;
            });
          })().catch((e) => setMessage(messageOf(e)));
        }}
      />
      <Field label="宝宝昵称" value={name} onChangeText={setName} />
      <Field
        label="本名（可选）"
        value={fullName}
        onChangeText={setFullName}
        testID="profile-full-name"
      />
      <Field
        label="生日（可选，格式 2025-01-01）"
        value={birthday}
        onChangeText={setBirthday}
        keyboardType="numbers-and-punctuation"
      />
      <Field
        label="名字的来历（可选，一句话）"
        value={motto}
        onChangeText={setMotto}
        multiline
        testID="profile-motto"
        style={{ minHeight: 96, textAlignVertical: "top" }}
      />
      <Text style={s.muted}>写下这个名字从哪里来。会印在扉页上。</Text>
      <Text accessibilityLiveRegion="polite">{message}</Text>
      <Button
        title="保存资料"
        primary
        onPress={() => {
          const trimmedFullName = fullName.trim();
          const trimmedMotto = motto.trim();
          if (trimmedFullName.length > 20) {
            setMessage("本名最多 20 个字。");
            return;
          }
          if (trimmedMotto.length > 60) {
            setMessage("名字的来历最多 60 个字。");
            return;
          }
          if (
            birthday &&
            (!/^\d{4}-\d{2}-\d{2}$/.test(birthday) ||
              !Number.isFinite(Date.parse(birthday)) ||
              new Date(birthday).toISOString().slice(0, 10) !== birthday ||
              birthday > toDayKey(new Date()))
          ) {
            setMessage("请填写有效的出生日期。");
            return;
          }
          void store
            .change((s) => {
              s.profile.name = name.trim();
              if (trimmedFullName) s.profile.fullName = trimmedFullName;
              else delete s.profile.fullName;
              if (trimmedMotto) s.profile.motto = trimmedMotto;
              else delete s.profile.motto;
              s.profile.birthday = birthday;
            })
            .then(() => setMessage("资料已保存"))
            .catch((e) => setMessage(messageOf(e)));
        }}
      />
    </Page>
  );
}
export function Appearance() {
  const state = useLibrary(),
    store = useStore(),
    s = useStyles();
  const { colors } = useTheme();
  const [error, setError] = useState("");
  const [lockAvailable, setLockAvailable] = useState(false);
  useEffect(() => {
    void (async () => {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      setLockAvailable(Boolean(hasHardware && enrolled));
    })();
  }, []);
  return (
    <Page title="外观设置">
      <SectionHeader title="主题" />
      <View style={s.row}>
        {(["auto", "light", "dark"] as const).map((theme, i) => (
          <Button
            key={theme}
            compact
            title={["跟随系统", "浅色", "深色"][i]!}
            selected={state.settings.theme === theme}
            onPress={() => {
              void store
                .change((s) => {
                  s.settings.theme = theme;
                })
                .catch((e) => setError(messageOf(e)));
            }}
          />
        ))}
      </View>
      <View style={s.between}>
        <Text>更大文字</Text>
        <Switch
          accessibilityLabel="更大文字"
          value={state.settings.largeText}
          trackColor={{ false: colors.line, true: colors.accentSoft }}
          thumbColor={state.settings.largeText ? colors.accent : undefined}
          onValueChange={(value) => {
            void store
              .change((s) => {
                s.settings.largeText = value;
              })
              .catch((e) => setError(messageOf(e)));
          }}
        />
      </View>
      <SectionHeader title="隐私" />
      <View style={s.between}>
        <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
          <Text>应用锁</Text>
          <Text style={s.muted}>
            {lockAvailable
              ? "打开应用或回到前台时，需要指纹、面容或锁屏密码。"
              : "先在系统设置里录入指纹、面容或设置锁屏密码，再开启。"}
          </Text>
        </View>
        <Switch
          accessibilityLabel="应用锁"
          testID="lock-toggle"
          value={state.settings.lockEnabled === true}
          disabled={!lockAvailable}
          trackColor={{ false: colors.line, true: colors.accentSoft }}
          thumbColor={
            state.settings.lockEnabled === true ? colors.accent : undefined
          }
          onValueChange={(value) => {
            void store
              .change((s) => {
                s.settings.lockEnabled = value;
              })
              .catch((e) => setError(messageOf(e)));
          }}
        />
      </View>
      <ErrorText message={error} />
    </Page>
  );
}
export function Storage() {
  const state = useLibrary(),
    store = useStore(),
    s = useStyles();
  const [message, setMessage] = useState(""),
    [healthOpen, setHealthOpen] = useState(false);
  // 冲突留底版引用的照片清理时会留下，计数也要一样算，不然按钮永远剩几个、清了却是 0 MB。
  const [kept, setKept] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    let alive = true;
    const load = () => {
      void readConflicts()
        .then((conflicts) => {
          if (alive) setKept(conflictMediaIds(conflicts));
        })
        .catch(() => {});
    };
    load();
    const off = subscribeSyncFiles(load);
    return () => {
      alive = false;
      off();
    };
  }, []);
  const health = healthFile().get();
  const refs = referencedMedia(state);
  const bytes = Object.values(state.media).reduce((n, m) => n + m.bytes, 0),
    unused = Object.values(state.media).filter(
      (m) => !refs.has(m.id) && !kept.has(m.id),
    );
  return (
    <Page title="本机存储">
      <Text>
        {Object.keys(state.records).length} 段时光 ·{" "}
        {Object.keys(state.albums).length} 本相册 ·{" "}
        {Object.keys(state.drafts).length} 份草稿
      </Text>
      <Text>照片和录音占用 {(bytes / 1048576).toFixed(1)} MB</Text>
      <Text style={s.muted}>
        卸载应用会删掉本机的一切，请定期到「备份与恢复」导出备份。
      </Text>
      <Button
        title={`清理没用到的照片和录音（${unused.length} 个）`}
        disabled={!unused.length}
        onPress={() =>
          Alert.alert(
            "清理没用到的照片和录音？",
            "只清理没有被任何时光、草稿或头像用到的；正在用的、两台手机都改过时留底那一版的都会留下。",
            [
              { text: "取消", style: "cancel" },
              {
                text: "清理",
                onPress: () => {
                  void readConflicts()
                    .then((conflicts) =>
                      collectUnusedMedia(store, conflictMediaIds(conflicts)),
                    )
                    .then((n) =>
                      setMessage(`已清理 ${(n / 1048576).toFixed(1)} MB`),
                    )
                    .catch((e) => setMessage(messageOf(e)));
                },
              },
            ],
          )
        }
      />
      <Text accessibilityLiveRegion="polite">{message}</Text>
      <View style={{ alignItems: "flex-start" }}>
        <Button
          title={healthOpen ? "收起本机健康" : "查看本机健康"}
          kind="text"
          compact
          selected={healthOpen}
          onPress={() => setHealthOpen(!healthOpen)}
        />
      </View>
      {healthOpen && (
        <Card>
          <Text style={s.heading}>本机健康</Text>
          <Text style={s.muted}>
            启动 {health.launches} 次 · 最近一次 {health.lastLaunchMs} 毫秒
          </Text>
          <Text style={s.muted}>
            写库 {health.changeCount} 次 · 平均 {changeAvgMs(health).toFixed(1)}{" "}
            毫秒 · 最长 {health.changeMaxMs} 毫秒
          </Text>
          <Text style={s.muted}>
            {health.diskFailures
              ? `写盘失败 ${health.diskFailures} 次 · 最近：${health.lastDiskError ?? "无摘要"}`
              : "写盘失败 0 次"}
          </Text>
          <Text style={s.muted}>
            最近备份：
            {state.lastExportAt ? dateLabel(state.lastExportAt) : "尚未导出过"}
          </Text>
          <Text style={s.muted}>这些数字只保存在本机，不会上传。</Text>
        </Card>
      )}
    </Page>
  );
}
/** 一份库里有多少东西，给恢复前的确认弹窗用。 */
function librarySummary(lib: {
  records: object;
  albums: object;
  media: object;
}) {
  return `${Object.keys(lib.records).length} 段时光、${Object.keys(lib.albums).length} 本相册、${Object.keys(lib.media).length} 个附件`;
}
export function Backup() {
  const sync = useSyncStatus();
  const state = useLibrary(),
    store = useStore(),
    s = useStyles();
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [stopper, setStopper] = useState<AbortController | null>(null),
    // 列表只在一次操作结束或删除后重读：读每份清单的 meta 不是免费的。
    [backups, setBackups] = useState(() => listLocalBackups());
  const exportedDays = daysSinceExport(state);
  const [archiving, setArchiving] = useState(false);
  const locked = busy || sync.running || archiving;
  const refreshList = () => setBackups(listLocalBackups());
  const perform = async (fn: () => Promise<void>) => {
    // 确认框可能在同步开始前打开，真正执行时再检查一次。
    if (isSyncRunning()) {
      setMessage("正在与家人同步，等它完成再试。");
      return;
    }
    if (isLocalBusy()) {
      setMessage("上一个操作还没结束，等它完成再试。");
      return;
    }
    markLocalBusy(true);
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
    } catch (e) {
      if (e instanceof BackupStopped) setMessage(e.message);
      else setError(messageOf(e));
    } finally {
      markLocalBusy(false);
      setBusy(false);
      setStopper(null);
      refreshList();
    }
  };
  const stoppable = () => {
    const controller = new AbortController();
    setStopper(controller);
    return controller.signal;
  };
  /** 把一份清单备份从 blob 库拼成 .xmb 交给系统分享面板；分卷时一卷一卷来。 */
  const exportManifest = async (manifest: File, signal: AbortSignal) => {
    purgeExports();
    try {
      const plan = planExport(manifest);
      for (let i = 0; i < plan.volumes.length; i++) {
        const volume = await writeVolume(plan, i, setMessage, signal);
        setMessage(
          plan.volumes.length === 1
            ? "请把备份保存到应用之外…"
            : `请保存第 ${i + 1} 卷／共 ${plan.volumes.length} 卷…`,
        );
        await shareBackup(volume);
        volume.delete();
      }
    } finally {
      purgeExports();
    }
  };
  const restore = async (files: File[], title: string, done: string) => {
    const inside = await inspectBackup(files);
    Alert.alert(
      title,
      `会换成这份备份里的 ${librarySummary(inside)}；现在的内容会先备份一份。`,
      [
        { text: "取消", style: "cancel" },
        {
          text: "恢复并替换",
          style: "destructive",
          onPress: () => {
            void perform(async () => {
              await restoreBackup(
                store,
                files,
                setMessage,
                undefined,
                conflictMediaIds(await readConflicts()),
              );
              // 一起写的手机：下一轮把全家的清单重读一遍，把备份之后家人的改动并回来。
              await forgetMergeHistory();
              setMessage(done);
            });
          },
        },
      ],
    );
  };
  return (
    <Page title="备份与恢复">
      <Card>
        <Text style={s.heading}>导出与恢复</Text>
        <Text style={s.muted}>
          一份备份装下她的资料、每一段时光、草稿、照片、录音和相册。
        </Text>
        <View style={s.row}>
          <Button
            title="导出完整备份"
            testID="backup-export"
            primary
            disabled={locked}
            onPress={() => {
              void perform(async () => {
                const signal = stoppable();
                // 备份只读快照，不占写队列、不虚增 revision；照片进本机 blob 库后再拼成 .xmb。
                const manifest = await createBackup(
                  store.get(),
                  setMessage,
                  signal,
                );
                await exportManifest(manifest, signal);
                await store.change((s) => {
                  s.lastExportAt = new Date().toISOString();
                });
                setMessage("备份已生成，请确认它已保存到应用之外。");
              });
            }}
          />
          <Button
            title="从备份恢复"
            testID="backup-restore"
            disabled={locked}
            onPress={() => {
              void perform(async () => {
                const picked = await DocumentPicker.getDocumentAsync({
                  type: "*/*",
                  copyToCacheDirectory: true,
                  multiple: true,
                });
                if (picked.canceled) return;
                await restore(
                  picked.assets.map((asset) => new File(asset.uri)),
                  "替换现在的内容？",
                  "恢复完成。恢复前的内容也留了一份在下面。",
                );
              });
            }}
          />
          {stopper && (
            <Button
              title="停止"
              testID="backup-stop"
              kind="text"
              compact
              onPress={() => stopper.abort()}
            />
          )}
        </View>
        <ErrorText message={error} />
        {/* 平时是上次导出的时间，导出与恢复的进度、结果都在这一行上播报。 */}
        <Text accessibilityLiveRegion="polite">
          {(sync.running && !busy ? "正在与家人同步，稍等一下。" : message) ||
            (busy
              ? "正在检查文件…"
              : exportedDays === null
                ? "还没导出过备份。"
                : exportedDays === 0
                  ? "今天导出过。"
                  : `上次导出是 ${exportedDays} 天前。`)}
        </Text>
        <Text style={s.footnote}>
          备份是 .xmb 文件，请保存到应用之外，比如网盘、电脑或家人的手机；超过 2
          GB 会分成几卷，恢复时把几卷一起选中。
        </Text>
      </Card>
      {backups.length > 0 && (
        <Card>
          <Text style={s.heading}>本机保留的备份</Text>
          <Text style={s.muted}>
            最近三份留在应用里，照片只存一份；卸载应用会一起消失，所以还是要另存到应用之外。
          </Text>
          {backups.map(({ file, label, bytes, manifestOnly }) => (
            <View key={file.name} style={{ gap: 4 }}>
              <Text>
                {label ?? file.name} · {(bytes / 1048576).toFixed(1)} MB
              </Text>
              <View style={s.row}>
                <Button
                  title="恢复这份备份"
                  kind="text"
                  compact
                  disabled={locked}
                  onPress={() => {
                    void perform(() => restore([file], "恢复这份备份？", "恢复完成。"));
                  }}
                />
                <Button
                  title="另存"
                  kind="text"
                  compact
                  disabled={locked}
                  onPress={() => {
                    void perform(async () => {
                      if (manifestOnly) await exportManifest(file, stoppable());
                      else await shareBackup(file);
                      setMessage("请确认它已保存到应用之外。");
                    });
                  }}
                />
                <Button
                  title="删除这份备份"
                  kind="text"
                  compact
                  danger
                  disabled={locked}
                  onPress={() =>
                    Alert.alert(
                      "删除这份备份？",
                      "只删除应用内保留的这一份；已保存到应用之外的备份不受影响。",
                      [
                        { text: "取消", style: "cancel" },
                        {
                          text: "删除",
                          style: "destructive",
                          onPress: () => {
                            void perform(async () => {
                              file.delete();
                              // 没人引用的照片字节随手收掉；任何一份清单读不出就先不收。
                              collectBlobs();
                              setMessage("这份本机备份已删除。");
                            });
                          },
                        },
                      ],
                    )
                  }
                />
              </View>
            </View>
          ))}
        </Card>
      )}
      <ArchiveCard busy={locked} onRunningChange={setArchiving} />
    </Page>
  );
}

/** 开放归档：普通文件夹压缩包，没有这个 App 也能看。进度与停止都在这张卡里，不弹窗。 */
function ArchiveCard({ busy, onRunningChange }: {
  busy: boolean;
  onRunningChange: (running: boolean) => void;
}) {
  const state = useLibrary(),
    store = useStore(),
    s = useStyles();
  const [year, setYear] = useState(""),
    [sealed, setSealed] = useState(false),
    [progress, setProgress] = useState<ArchiveProgress | null>(null),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const years = [
    ...new Set(Object.values(state.records).map((r) => yearKey(r.date))),
  ]
    .sort()
    .reverse();
  const archiving = !!progress;
  const exportArchive = async () => {
    if (isSyncRunning()) {
      setMessage("正在与家人同步，等它完成再试。");
      return;
    }
    if (isLocalBusy()) {
      setMessage("上一个操作还没结束，等它完成再试。");
      return;
    }
    markLocalBusy(true);
    onRunningChange(true);
    const abort = new AbortController();
    controller.current = abort;
    setError("");
    setMessage("");
    setProgress({ done: 0, total: 0, bytes: 0, totalBytes: 0 });
    try {
      // 归档读的是只读快照，与备份一样不占写队列。
      const { file } = await createArchive(
        store.get(),
        { year: year || undefined, includeSealedLetters: sealed },
        setProgress,
        abort.signal,
      );
      setProgress(null);
      await shareArchive(file);
      setMessage(
        "归档已生成。请确认已保存到应用之外的位置；在电脑上解压后打开 index.html。",
      );
    } catch (e) {
      if (e instanceof ArchiveStopped) setMessage(e.message);
      else setError(messageOf(e));
    } finally {
      markLocalBusy(false);
      onRunningChange(false);
      controller.current = null;
      setProgress(null);
    }
  };
  return (
    <Card testID="archive-card">
      <Text style={s.heading}>开放归档</Text>
      <Text style={s.muted}>
        导出成普通文件夹压缩包：原图、Markdown 文字与一个离线网页，没有这个 App
        也能看。归档里的信是明文保存的。
      </Text>
      {years.length > 1 && (
        <View style={s.row}>
          <Button
            compact
            title="全部"
            selected={!year}
            disabled={archiving}
            onPress={() => setYear("")}
          />
          {years.map((y) => (
            <Button
              key={y}
              compact
              title={`${y} 年`}
              selected={year === y}
              disabled={archiving}
              onPress={() => setYear(year === y ? "" : y)}
            />
          ))}
        </View>
      )}
      <View style={s.between}>
        <Text>包含未拆封的信</Text>
        <Switch
          value={sealed}
          disabled={archiving}
          onValueChange={setSealed}
          accessibilityLabel="包含未拆封的信"
        />
      </View>
      <ErrorText message={error} />
      {!!message && <Text accessibilityLiveRegion="polite">{message}</Text>}
      <View style={s.row}>
        <Button
          title={
            progress
              ? progress.total
                ? `正在归档 ${progress.done}/${progress.total} 个附件`
                : "正在准备归档…"
              : "导出开放归档"
          }
          icon="download"
          testID="archive-export"
          disabled={busy || archiving}
          onPress={() => {
            void exportArchive();
          }}
        />
        {archiving && (
          <Button
            title="停止"
            compact
            testID="archive-stop"
            onPress={() => controller.current?.abort()}
          />
        )}
      </View>
    </Card>
  );
}
