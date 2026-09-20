import { useEffect, useRef, useState } from "react";
import { Alert, Switch, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import * as LocalAuthentication from "expo-local-authentication";
import { File } from "expo-file-system";
import { useLibrary, useStore } from "./context";
import { useNav } from "./navigation";
import { getToken } from "../ai/client";
import { birthdayLabel } from "./dates";
import { backupDirectory, preserveMedia } from "./files";
import {
  backupStampLabel,
  createBackup,
  daysSinceExport,
  inspectBackup,
  restoreBackup,
  shareBackup,
} from "./backup";
import { collectUnusedMedia } from "./services";
import {
  ArchiveStopped,
  createArchive,
  shareArchive,
  type ArchiveProgress,
} from "./archive";
import { healthFile } from "./health-file";
import { changeAvgMs } from "./health";
import { APP_NAME } from "./brand";
import { referencedMedia, yearKey } from "./model";
import {
  Button,
  Card,
  ErrorText,
  Field,
  Page,
  SettingsGroup,
  SettingsRow,
  Text,
  dateLabel,
  messageOf,
  useStyles,
  useTheme,
} from "./ui";
import { Photo } from "./Media";
/** 「我的」入口页：分组设置行，副题把最要紧的状态带出来，不用点进去看。 */
export function Settings() {
  const state = useLibrary(),
    nav = useNav(),
    s = useStyles();
  const [aiState, setAiState] = useState<string | undefined>(undefined);
  useEffect(() => {
    let live = true;
    // 只看本机有没有登录令牌，不联网：离线打开「我的」也不该转圈或报错。
    getToken()
      .then((token) => {
        if (live) setAiState(token ? "已登录" : "未登录");
      })
      .catch(() => {
        if (live) setAiState("未登录");
      });
    return () => {
      live = false;
    };
  }, []);
  const name = state.profile.name || "宝宝",
    birthday = birthdayLabel(state.profile.birthday),
    exportedDays = daysSinceExport(state),
    bytes = Object.values(state.media).reduce((n, m) => n + m.bytes, 0),
    theme = { auto: "跟随系统", light: "浅色", dark: "深色" }[
      state.settings.theme
    ];
  return (
    <Page title="我的">
      <Text style={s.muted}>{APP_NAME} · 留住每一个值得记住的日子</Text>
      <SettingsGroup>
        <SettingsRow
          icon="person"
          label={`${name}的资料`}
          subtitle={birthday ? `生日 ${birthday}` : "还没填生日"}
          onPress={() => nav.navigate("Profile")}
          last
        />
      </SettingsGroup>
      <SettingsGroup title="资料">
        <SettingsRow
          icon="download"
          label="备份与恢复"
          subtitle={
            exportedDays === null
              ? "还没导出过备份"
              : exportedDays === 0
                ? "今天导出过"
                : `上次导出 ${exportedDays} 天前`
          }
          onPress={() => nav.navigate("Backup")}
        />
        <SettingsRow
          icon="file"
          label="本机存储"
          subtitle={`照片和录音占用 ${(bytes / 1048576).toFixed(1)} MB`}
          onPress={() => nav.navigate("Storage")}
          last
        />
      </SettingsGroup>
      <SettingsGroup title="家人与 AI">
        <SettingsRow
          icon="sparkle"
          label="AI 设置"
          subtitle={aiState}
          onPress={() => nav.navigate("AISettings")}
          last
        />
      </SettingsGroup>
      <SettingsGroup title="应用">
        <SettingsRow
          icon="settings"
          label="外观设置"
          subtitle={state.settings.largeText ? `${theme} · 更大文字` : theme}
          onPress={() => nav.navigate("Appearance")}
          last
        />
      </SettingsGroup>
    </Page>
  );
}
export function Profile() {
  const state = useLibrary(),
    store = useStore(),
    s = useStyles();
  const [name, setName] = useState(state.profile.name),
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
        label="生日（可选，格式 2025-01-01）"
        value={birthday}
        onChangeText={setBirthday}
        keyboardType="numbers-and-punctuation"
      />
      <Text accessibilityLiveRegion="polite">{message}</Text>
      <Button
        title="保存资料"
        primary
        onPress={() => {
          if (
            birthday &&
            (!/^\d{4}-\d{2}-\d{2}$/.test(birthday) ||
              !Number.isFinite(Date.parse(birthday)) ||
              new Date(birthday).toISOString().slice(0, 10) !== birthday ||
              birthday > new Date().toISOString().slice(0, 10))
          ) {
            setMessage("请填写有效的出生日期。");
            return;
          }
          void store
            .change((s) => {
              s.profile.name = name.trim();
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
      {(["auto", "light", "dark"] as const).map((theme, i) => (
        <Button
          key={theme}
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
      <Text style={s.heading}>隐私</Text>
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
  const [message, setMessage] = useState("");
  const health = healthFile().get();
  const refs = referencedMedia(state);
  const bytes = Object.values(state.media).reduce((n, m) => n + m.bytes, 0),
    unused = Object.values(state.media).filter((m) => !refs.has(m.id));
  return (
    <Page title="本机存储">
      <Text>
        {Object.keys(state.records).length} 条记录 ·{" "}
        {Object.keys(state.albums).length} 本相册
      </Text>
      <Text>{Object.keys(state.drafts).length} 份未完成记录</Text>
      <Text>素材占用 {(bytes / 1048576).toFixed(1)} MB</Text>
      <Text style={s.muted}>
        清理只处理没有被记录、草稿或头像使用的素材。卸载应用会删除本机内容，请定期导出备份。
      </Text>
      <Text>{message}</Text>
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
      <Button
        title={`清理未使用素材（${unused.length} 份）`}
        disabled={!unused.length}
        onPress={() =>
          Alert.alert(
            "清理未使用素材？",
            "正在使用的照片、录音和视频都会保留。",
            [
              { text: "取消", style: "cancel" },
              {
                text: "清理",
                onPress: () => {
                  void collectUnusedMedia(store)
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
  const state = useLibrary(),
    store = useStore(),
    s = useStyles();
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const exportedDays = daysSinceExport(state);
  const perform = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };
  const backups = backupDirectory.exists
    ? backupDirectory
        .list()
        .filter((f): f is File => f instanceof File && f.name.endsWith(".xmb"))
        .sort((a, b) => b.name.localeCompare(a.name))
    : [];
  const restore = (file: File, title: string, done: string) =>
    perform(async () => {
      const inside = await inspectBackup(file);
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
                await restoreBackup(store, file, setMessage);
                setMessage(done);
              });
            },
          },
        ],
      );
    });
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
            disabled={busy}
            onPress={() => {
              void perform(async () => {
                // 备份只读快照，不占写队列、不虚增 revision。
                const file = await createBackup(store.get());
                await shareBackup(file);
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
            disabled={busy}
            onPress={() => {
              void perform(async () => {
                const picked = await DocumentPicker.getDocumentAsync({
                  type: "*/*",
                  copyToCacheDirectory: true,
                });
                if (picked.canceled) return;
                await restore(
                  new File(picked.assets[0]!.uri),
                  "替换现在的内容？",
                  "恢复完成。恢复前的内容也留了一份在下面。",
                );
              });
            }}
          />
        </View>
        <ErrorText message={error} />
        {/* 平时是上次导出的时间，导出与恢复的进度、结果都在这一行上播报。 */}
        <Text accessibilityLiveRegion="polite">
          {message ||
            (busy
              ? "正在检查文件…"
              : exportedDays === null
                ? "还没导出过备份。"
                : exportedDays === 0
                  ? "今天导出过。"
                  : `上次导出是 ${exportedDays} 天前。`)}
        </Text>
        <Text style={s.footnote}>
          备份是 .xmb 文件，请保存到应用之外，比如网盘、电脑或家人的手机。
        </Text>
      </Card>
      {backups.length > 0 && (
        <Card>
          <Text style={s.heading}>本机保留的备份</Text>
          <Text style={s.muted}>
            最近三份留在应用里；卸载应用会一起消失，所以还是要另存到应用之外。
          </Text>
          {backups.map((file) => (
            <View key={file.name} style={{ gap: 4 }}>
              <Text>
                {backupStampLabel(file.name) ?? file.name} ·{" "}
                {(file.size / 1048576).toFixed(1)} MB
              </Text>
              <View style={s.row}>
                <Button
                  title="恢复这份备份"
                  kind="text"
                  compact
                  disabled={busy}
                  onPress={() => {
                    void restore(file, "恢复这份备份？", "恢复完成。");
                  }}
                />
                <Button
                  title="另存"
                  kind="text"
                  compact
                  disabled={busy}
                  onPress={() => {
                    void perform(async () => {
                      await shareBackup(file);
                      setMessage("请确认它已保存到应用之外。");
                    });
                  }}
                />
                <Button
                  title="删除这份备份"
                  kind="text"
                  compact
                  danger
                  disabled={busy}
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
                            file.delete();
                            setMessage("这份本机备份已删除。");
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
      <ArchiveCard busy={busy} />
    </Page>
  );
}

/** 开放归档：普通文件夹压缩包，没有这个 App 也能看。进度与停止都在这张卡里，不弹窗。 */
function ArchiveCard({ busy }: { busy: boolean }) {
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
