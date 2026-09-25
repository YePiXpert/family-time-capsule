import { useCallback, useEffect, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { Alert, Pressable, StyleSheet, Switch, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as LocalAuthentication from "expo-local-authentication";
import { useLibrary, useStore, useSyncStatus } from "./context";
import { useNav } from "./navigation";
import { getToken } from "../family/session";
import { ageLine, birthdayLabel, toDayKey } from "./dates";
import { preserveMedia } from "./files";
import { daysSinceExport } from "./backup";
import { APP_NAME, CHILD_FALLBACK } from "./brand";
import { JournalIcon } from "../components/JournalIcon";
import {
  BY_PRESETS,
  sealInitial,
  stampUnsigned,
  unsignedRecords,
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
