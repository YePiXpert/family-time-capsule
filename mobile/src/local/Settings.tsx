import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { Alert, Pressable, StyleSheet, Switch, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import * as LocalAuthentication from "expo-local-authentication";
import { File } from "expo-file-system";
import { useLibrary, useStore, useSyncStatus } from "./context";
import { useNav } from "./navigation";
import { getToken } from "../family/session";
import { ageLine, birthdayLabel, toDayKey } from "./dates";
import { preserveMedia } from "./files";
import {
  BackupStopped,
  collectBlobs,
  createBackup,
  daysSinceExport,
  discardPickedCopies,
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
import { backupLine, familyLine } from "./settings-lines";
/**
 * 「设置」：顶部一行轻页头（名字圆章、昵称、月龄，点开是宝宝资料），下面一张实色列表只有四行——
 * 记录落款（原地展开）、家庭与同步、数据与备份、外观与隐私。副题把最要紧的状态带出来，不用点进去看。
 */
export function Settings() {
  const sync = useSyncStatus();
  const state = useLibrary(),
    store = useStore(),
    nav = useNav(),
    s = useStyles(),
    { colors } = useTheme();
  const [signedIn, setSignedIn] = useState<boolean | undefined>(undefined);
  const [error, setError] = useState("");
  const [stamped, setStamped] = useState<number | null>(null);
  // 每次回到这一页都重读：从家庭页加入或退出回来，副题要跟着变。
  useFocusEffect(
    useCallback(() => {
      let live = true;
      // 只看本机有没有家庭令牌，不联网：离线打开「设置」也不该转圈或报错。
      getToken()
        .then((token) => {
          if (live) setSignedIn(!!token);
        })
        .catch(() => {
          if (live) setSignedIn(false);
        });
      return () => {
        live = false;
      };
    }, []),
  );
  const name = state.profile.name.trim() || CHILD_FALLBACK,
    birthday = birthdayLabel(state.profile.birthday),
    age = ageLine(state.profile.birthday),
    exportedDays = daysSinceExport(state),
    bytes = Object.values(state.media).reduce((n, m) => n + m.bytes, 0),
    theme = { auto: "跟随系统", light: "浅色", dark: "深色" }[
      state.settings.theme
    ];
  const initial = sealInitial(name);
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
  const stampAll = (value: string) =>
    Alert.alert(
      `都写上「${value}」？`,
      `以前没落款的 ${unsigned} 段时光会署上「${value}」。有不是${value}写的，就先别补，到那一段里单独改。`,
      [
        { text: "取消", style: "cancel" },
        {
          text: "都写上",
          onPress: () => {
            void store
              .change((lib) => {
                setStamped(stampUnsigned(lib, value));
                lib.nudgeClosedAt = {
                  ...lib.nudgeClosedAt,
                  by: new Date().toISOString(),
                };
              })
              .catch((e) => setError(messageOf(e)));
          },
        },
      ],
    );
  return (
    <Page title="设置">
      {/* 轻页头：不垫卡，名字圆章与昵称直接落在纸上。 */}
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
          paddingVertical: 4,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <Stamp size={48} inset={4}>
          <Text
            style={{
              fontFamily: serif,
              fontSize: 21,
              lineHeight: 27,
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
      <SettingsGroup>
        {/* 落款原地展开：点「—— 妈妈」铺开称呼，选一个就收起。补旧记录是下面一行次要文字按钮。 */}
        <View
          style={{
            paddingVertical: 6,
            gap: 4,
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: colors.line,
          }}
        >
          <SignatureButton
            value={by}
            options={options}
            testID="settings-by"
            leading={
              <View
                style={{ flexDirection: "row", alignItems: "center", gap: 12 }}
              >
                <View style={{ width: 28, alignItems: "center" }}>
                  <JournalIcon name="edit" color={colors.muted} size={22} />
                </View>
                <Text>记录落款</Text>
              </View>
            }
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
          {!!by && unsigned > 0 && (
            <View style={{ alignItems: "flex-start", paddingLeft: 40 }}>
              <Button
                title={`以前 ${unsigned} 段还没落款`}
                kind="text"
                compact
                testID="settings-by-stamp"
                onPress={() => stampAll(by)}
              />
            </View>
          )}
          {stamped !== null && (
            <Text
              accessibilityLiveRegion="polite"
              style={[s.muted, { paddingLeft: 40 }]}
            >
              {`已给 ${stamped} 段时光写上落款。`}
            </Text>
          )}
          <ErrorText message={error} />
        </View>
        <SettingsRow
          icon="person"
          label="家庭与同步"
          subtitle={familyLine(signedIn, sync)}
          testID="settings-family"
          onPress={() => nav.navigate("Family")}
        />
        <SettingsRow
          icon="archive"
          label="数据与备份"
          subtitle={backupLine(exportedDays, bytes)}
          testID="settings-backup"
          onPress={() => nav.navigate("Backup")}
        />
        <SettingsRow
          icon="appearance"
          label="外观与隐私"
          subtitle={[
            theme,
            state.settings.largeText ? "更大文字" : "",
            state.settings.lockEnabled ? "应用锁" : "",
          ]
            .filter(Boolean)
            .join(" · ")}
          testID="settings-appearance"
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
/** 「外观与隐私」：主题、更大文字、应用锁，各在一张实色纸卡里。 */
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
    <Page title="外观与隐私">
      {/* 区标题与它那张卡挨着，像 SettingsGroup。 */}
      <View style={{ gap: 4 }}>
        <SectionHeader title="外观" />
        <Card>
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
          <View
            style={[
              s.between,
              {
                borderTopWidth: StyleSheet.hairlineWidth,
                borderTopColor: colors.line,
                paddingTop: 12,
              },
            ]}
          >
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
        </Card>
      </View>
      <View style={{ gap: 4 }}>
        <SectionHeader title="隐私" />
        <Card>
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
        </Card>
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
        卸载应用会删掉本机的一切，请定期到「数据与备份」保存完整备份。
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
/**
 * 完整备份与恢复共用的操作：一次只跑一个（本机备份、恢复、归档与同步共用互斥），
 * 进度、结果与错误落在调用页自己的状态行上。
 */
function useBackupActions() {
  const sync = useSyncStatus();
  const store = useStore();
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [stopper, setStopper] = useState<AbortController | null>(null),
    // 列表只在一次操作结束或删除后重读：读每份清单的 meta 不是免费的。
    [backups, setBackups] = useState(() => listLocalBackups());
  const locked = busy || sync.running;
  const refreshList = () => setBackups(listLocalBackups());
  // 从恢复页回来时恢复记录可能多了一份（恢复前自动留的）：回到页面就重读。
  useFocusEffect(useCallback(() => setBackups(listLocalBackups()), []));
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
      let previous: File | undefined;
      for (let i = 0; i < plan.volumes.length; i++) {
        const volume = await writeVolume(plan, i, setMessage, signal);
        // 分享面板关上不等于分享目标读完了（网盘可能在后台慢慢传）：上一卷等下一卷写好再清，
        // 最后一卷和可阅读副本一样留在缓存里，下一次导出前清掉。
        previous?.delete();
        previous = volume;
        setMessage(
          plan.volumes.length === 1
            ? "请把备份保存到应用之外…"
            : `请保存第 ${i + 1} 卷／共 ${plan.volumes.length} 卷…`,
        );
        await shareBackup(volume);
      }
    } catch (e) {
      purgeExports();
      throw e;
    }
  };
  const restore = async (files: File[], title: string, done: string) => {
    let inside;
    try {
      inside = await inspectBackup(files, false, stoppable());
    } catch (e) {
      discardPickedCopies(files);
      throw e;
    }
    Alert.alert(
      title,
      `会换成这份备份里的 ${librarySummary(inside)}；现在的内容会先备份一份。` +
        // 家人同步的三方合并里较新的一版会赢：恢复一份旧备份不能用来撤销已经同步过的改动。
        (sync.joined
          ? "\n\n这台手机已加入家庭：下次同步时，备份之后家里（包括这台手机）同步过的改动会并回来。"
          : ""),
      [
        {
          text: "取消",
          style: "cancel",
          onPress: () => discardPickedCopies(files),
        },
        {
          text: "恢复并替换",
          style: "destructive",
          onPress: () => {
            void perform(async () => {
              try {
                await restoreBackup(
                  store,
                  files,
                  setMessage,
                  stoppable(),
                  conflictMediaIds(await readConflicts()),
                );
              } finally {
                discardPickedCopies(files);
              }
              // 一起写的手机：下一轮把全家的清单重读一遍，把备份之后家人的改动并回来。
              await forgetMergeHistory();
              setMessage(done);
            });
          },
        },
      ],
    );
  };
  const stop = stopper && (
    <Button
      title="停止"
      testID="backup-stop"
      kind="text"
      compact
      onPress={() => stopper.abort()}
    />
  );
  return {
    busy,
    locked,
    message,
    setMessage,
    error,
    stop,
    backups,
    perform,
    stoppable,
    exportManifest,
    restore,
  };
}
/**
 * 「数据与备份」：首屏一张卡——状态行、「保存完整备份」、.xmb 脚注；
 * 下面三行进恢复备份、导出可阅读副本、本机存储。
 */
export function Backup() {
  const sync = useSyncStatus();
  const state = useLibrary(),
    store = useStore(),
    nav = useNav(),
    s = useStyles();
  const actions = useBackupActions();
  const { busy, message, setMessage, backups } = actions;
  // 系统分享面板取消了也照样返回：存没存到应用之外只有她知道，点了「已存好」才算一次完整备份。
  const [unconfirmed, setUnconfirmed] = useState(false);
  const exportedDays = daysSinceExport(state);
  const bytes = Object.values(state.media).reduce((n, m) => n + m.bytes, 0);
  return (
    <Page title="数据与备份">
      <Card>
        {/* 平时是上次保存的时间，保存的进度、结果都在这一行上播报。 */}
        <Text accessibilityLiveRegion="polite">
          {(sync.running && !busy ? "正在与家人同步，稍等一下。" : message) ||
            (busy
              ? "正在检查文件…"
              : exportedDays === null
                ? "还没保存过完整备份。"
                : exportedDays === 0
                  ? "今天保存过完整备份。"
                  : `上次完整备份是 ${exportedDays} 天前。`)}
        </Text>
        <Text style={s.muted}>
          一份完整备份装下她的资料、每一段时光、草稿、照片、录音和相册。
        </Text>
        <View style={s.row}>
          <Button
            title="保存完整备份"
            testID="backup-export"
            primary
            disabled={actions.locked}
            onPress={() => {
              setUnconfirmed(false);
              void actions.perform(async () => {
                const signal = actions.stoppable();
                // 备份只读快照，不占写队列、不虚增 revision；照片进本机 blob 库后再拼成 .xmb。
                const manifest = await createBackup(
                  store.get(),
                  setMessage,
                  signal,
                );
                await actions.exportManifest(manifest, signal);
                setUnconfirmed(true);
                setMessage(
                  "备份已生成。存到网盘、电脑或家人的手机以后点「已存好」；刚才取消了就再保存一次。",
                );
              });
            }}
          />
          {unconfirmed && !busy && (
            <Button
              title="已存好"
              testID="backup-confirm-saved"
              kind="text"
              compact
              onPress={() => {
                void store
                  .change((s) => {
                    s.lastExportAt = new Date().toISOString();
                  })
                  .then(() => {
                    setUnconfirmed(false);
                    setMessage("记下了：今天保存过完整备份。");
                  })
                  .catch((e) => setMessage(messageOf(e)));
              }}
            />
          )}
          {actions.stop}
        </View>
        <ErrorText message={actions.error} />
        <Text style={s.footnote}>
          备份是 .xmb 文件，请保存到应用之外，比如网盘、电脑或家人的手机；超过 2
          GB 会分成几卷。
        </Text>
      </Card>
      <SettingsGroup>
        <SettingsRow
          icon="archive"
          label="恢复备份"
          subtitle={
            backups.length > 0
              ? `从文件恢复，或用本机的 ${backups.length} 份恢复记录`
              : "从保存在应用之外的备份文件恢复"
          }
          testID="backup-restore-open"
          onPress={() => nav.navigate("Restore")}
        />
        <SettingsRow
          icon="book"
          label="导出可阅读副本"
          subtitle="网页、文字和原图，没有这个 App 也能看"
          testID="archive-open"
          onPress={() => nav.navigate("ReadableCopy")}
        />
        <SettingsRow
          icon="phone"
          label="本机存储"
          subtitle={`照片和录音占用 ${(bytes / 1048576).toFixed(1)} MB`}
          testID="storage-open"
          onPress={() => nav.navigate("Storage")}
          last
        />
      </SettingsGroup>
    </Page>
  );
}
/** 「恢复备份」：先从文件恢复；本机恢复记录（最近三份）在下面，可恢复、另存到应用之外、删除。 */
export function Restore() {
  const sync = useSyncStatus();
  const s = useStyles(),
    { colors } = useTheme();
  const actions = useBackupActions();
  const { busy, locked, message, setMessage, backups, perform, restore } =
    actions;
  return (
    <Page title="恢复备份">
      <Card>
        <Text style={s.muted}>
          恢复会把现在的内容换成备份里的；换之前先在本机留一份现在的，列在下面。
        </Text>
        <View style={s.row}>
          <Button
            title="从文件恢复"
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
          {actions.stop}
        </View>
        <ErrorText message={actions.error} />
        {/* 恢复与另存的进度、结果都在这一行上播报。 */}
        {!!(message || busy || sync.running) && (
          <Text accessibilityLiveRegion="polite">
            {(sync.running && !busy ? "正在与家人同步，稍等一下。" : message) ||
              "正在检查文件…"}
          </Text>
        )}
        <Text style={s.footnote}>分成几卷的备份，恢复时把几卷一起选中。</Text>
      </Card>
      {backups.length > 0 && (
        <Card>
          <Text style={s.heading}>本机恢复记录</Text>
          <Text style={s.muted}>
            最近三份留在应用里，照片只存一份；卸载应用会一起消失，所以还是要另存到应用之外。
          </Text>
          {backups.map(({ file, label, bytes, manifestOnly }) => (
            <View
              key={file.name}
              style={{
                gap: 4,
                paddingTop: 12,
                borderTopWidth: StyleSheet.hairlineWidth,
                borderTopColor: colors.line,
              }}
            >
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
                    void perform(() =>
                      restore([file], "恢复这份备份？", "恢复完成。"),
                    );
                  }}
                />
                <Button
                  title="另存到应用之外"
                  kind="text"
                  compact
                  disabled={locked}
                  onPress={() => {
                    void perform(async () => {
                      if (manifestOnly)
                        await actions.exportManifest(file, actions.stoppable());
                      else await shareBackup(file);
                      setMessage("请确认它已保存到应用之外。");
                    });
                  }}
                />
                <Button
                  title="删除"
                  kind="text"
                  compact
                  danger
                  disabled={locked}
                  onPress={() =>
                    Alert.alert(
                      "删除这份恢复记录？",
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
                              setMessage("这份恢复记录已删除。");
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
    </Page>
  );
}

/**
 * 「导出可阅读副本」（开放归档）：普通文件夹压缩包，没有这个 App 也能看。
 * 按钮上面先说清信是明文、未拆封的信默认不放；进度与停止都在这一页，不弹窗。
 */
export function ReadableCopy() {
  const sync = useSyncStatus();
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
        "副本已生成。请确认已保存到应用之外的位置；在电脑上解压后打开 index.html。",
      );
    } catch (e) {
      if (e instanceof ArchiveStopped) setMessage(e.message);
      else setError(messageOf(e));
    } finally {
      markLocalBusy(false);
      controller.current = null;
      setProgress(null);
    }
  };
  return (
    <Page title="导出可阅读副本">
      <Card testID="archive-card">
        <Text style={s.muted}>
          导出成普通文件夹压缩包：原图、Markdown 文字与一个离线网页，没有这个
          App 也能看。它不能用来恢复，恢复请用完整备份。
        </Text>
        <Text>副本里的信是明文保存的，谁拿到压缩包都能读。</Text>
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
                  ? `正在导出 ${progress.done}/${progress.total} 个附件`
                  : "正在准备…"
                : "导出可阅读副本"
            }
            icon="download"
            primary
            testID="archive-export"
            disabled={sync.running || archiving}
            onPress={() => {
              void exportArchive();
            }}
          />
          {archiving && (
            <Button
              title="停止"
              compact
              kind="text"
              testID="archive-stop"
              onPress={() => controller.current?.abort()}
            />
          )}
        </View>
      </Card>
    </Page>
  );
}
