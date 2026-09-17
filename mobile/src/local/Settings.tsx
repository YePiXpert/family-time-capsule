import { useState } from "react";
import { Alert, ScrollView, Switch, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { useLibrary, useStore } from "./context";
import { useNav } from "./navigation";
import { backupDirectory, preserveMedia } from "./files";
import {
  createBackup,
  daysSinceExport,
  inspectBackup,
  restoreBackup,
  shareBackup,
} from "./backup";
import { collectUnusedMedia } from "./services";
import { referencedMedia } from "./model";
import {
  Button,
  ErrorText,
  Field,
  Page,
  Text,
  messageOf,
  useStyles,
} from "./ui";
import { Photo } from "./Media";
export function Settings() {
  const state = useLibrary(),
    nav = useNav(),
    s = useStyles();
  return (
    <Page scroll={false}>
      <ScrollView contentContainerStyle={s.content}>
        <Text style={s.title}>我的</Text>
        <Text style={s.muted}>
          {state.profile.name || "小美成长记"} · 留住每一个值得记住的日子
        </Text>
        <View style={s.section}>
          <Button
            title="宝宝资料"
            icon="person"
            onPress={() => nav.navigate("Profile")}
          />
          <Button
            title="本机存储"
            icon="file"
            onPress={() => nav.navigate("Storage")}
          />
          <Button
            title="备份与恢复"
            icon="download"
            onPress={() => nav.navigate("Backup")}
          />
          <Button
            title="AI 设置"
            icon="settings"
            onPress={() => nav.navigate("AISettings")}
          />
          <Button
            title="外观设置"
            icon="settings"
            onPress={() => nav.navigate("Appearance")}
          />
        </View>
      </ScrollView>
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
    <Page>
      <Text style={s.title}>宝宝资料</Text>
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
  const [error, setError] = useState("");
  return (
    <Page>
      <Text style={s.title}>外观设置</Text>
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
          onValueChange={(value) => {
            void store
              .change((s) => {
                s.settings.largeText = value;
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
  const refs = referencedMedia(state);
  const bytes = Object.values(state.media).reduce((n, m) => n + m.bytes, 0),
    unused = Object.values(state.media).filter((m) => !refs.has(m.id));
  return (
    <Page>
      <Text style={s.title}>本机存储</Text>
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
  return (
    <Page>
      <Text style={s.title}>备份与恢复</Text>
      <Text>
        备份包含宝宝资料、记录、草稿、素材和相册。请选择应用之外的位置保存。
      </Text>
      <Text style={s.muted}>
        上次导出：
        {exportedDays === null
          ? "尚未导出过"
          : exportedDays === 0
            ? "今天"
            : `${exportedDays} 天前`}
      </Text>
      <Text style={s.muted}>
        备份文件为 .xmb 格式。导出面板关闭后，请确认文件已保存到选定位置。
      </Text>
      <ErrorText message={error} />
      <Text accessibilityLiveRegion="polite">
        {busy ? "正在校验和处理文件，请稍候…" : message}
      </Text>
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
            setMessage("备份已生成。请确认已保存到应用之外的位置。");
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
            const file = new File(picked.assets[0]!.uri),
              state = await inspectBackup(file);
            Alert.alert(
              "替换当前本机内容？",
              `备份包含 ${Object.keys(state.records).length} 条记录、${Object.keys(state.albums).length} 本相册、${Object.keys(state.media).length} 份素材。恢复前会保留当前内容的备份。`,
              [
                { text: "取消", style: "cancel" },
                {
                  text: "恢复并替换",
                  style: "destructive",
                  onPress: () => {
                    void perform(async () => {
                      await restoreBackup(store, file);
                      setMessage("恢复完成。恢复前的备份可在下方另行导出。");
                    });
                  },
                },
              ],
            );
          });
        }}
      />
      {backups.length > 0 && <Text style={s.heading}>本机保留的备份</Text>}
      {backups.map((file) => (
        <View key={file.name} style={s.section}>
          <Text style={s.muted}>{file.name}</Text>
          <Text>{(file.size / 1048576).toFixed(1)} MB</Text>
          <Button
            title="另存到应用之外"
            disabled={busy}
            onPress={() => {
              void perform(async () => {
                await shareBackup(file);
                setMessage("请确认已保存到应用之外的位置。");
              });
            }}
          />
          <Button
            title="恢复这份备份"
            disabled={busy}
            onPress={() => {
              void perform(async () => {
                const state = await inspectBackup(file);
                Alert.alert(
                  "恢复这份备份？",
                  `将替换当前内容，恢复 ${Object.keys(state.records).length} 条记录。当前内容会先备份。`,
                  [
                    { text: "取消", style: "cancel" },
                    {
                      text: "恢复并替换",
                      onPress: () => {
                        void perform(async () => {
                          await restoreBackup(store, file);
                          setMessage("恢复完成。");
                        });
                      },
                    },
                  ],
                );
              });
            }}
          />
          <Button
            title="删除这份备份"
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
      ))}
    </Page>
  );
}
