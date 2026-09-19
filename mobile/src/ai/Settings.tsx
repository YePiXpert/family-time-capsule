import { useEffect, useState } from "react";
import { Alert, Platform } from "react-native";
import {
  Button,
  Card,
  ErrorText,
  Field,
  Page,
  Text,
  messageOf,
  useStyles,
} from "../local/ui";
import {
  AIError,
  api,
  changePassword,
  disconnect,
  getToken,
  login,
  serviceStatus,
  setupService,
} from "./client";
import type { Member, Overview, Usage, AISettings } from "./types";
function MemberRow({
  member,
  reload,
  run,
}: {
  member: Member & { usage: Usage };
  reload: () => Promise<void>;
  run: (fn: () => Promise<void>) => void;
}) {
  const s = useStyles(),
    [photos, setPhotos] = useState(String(member.photo_limit)),
    [writes, setWrites] = useState(String(member.write_limit)),
    [loginName, setLoginName] = useState(member.username ?? ""),
    [loginPw, setLoginPw] = useState("");
  return (
    <Card>
      <Text>
        {member.name}
        {member.role === "owner" ? " · 主人" : ""}
        {member.enabled ? "" : " · 已停用"}
        {member.username ? "" : " · 未设登录"}
      </Text>
      <Text style={s.muted}>
        今日 {member.usage.photos} 张图片 / {member.usage.writes} 次文案
      </Text>
      <Field
        label="每日图片额度"
        value={photos}
        keyboardType="number-pad"
        onChangeText={setPhotos}
      />
      <Field
        label="每日文案额度"
        value={writes}
        keyboardType="number-pad"
        onChangeText={setWrites}
      />
      <Button
        title="保存额度"
        onPress={() =>
          run(async () => {
            await api(
              `/admin/members/${member.id}`,
              {
                enabled: !!member.enabled,
                photoLimit: Number(photos),
                writeLimit: Number(writes),
              },
              "PATCH",
            );
            await reload();
          })
        }
      />
      <Field
        label="登录名"
        autoCapitalize="none"
        autoCorrect={false}
        value={loginName}
        onChangeText={setLoginName}
      />
      <Field
        label="登录密码（至少 8 位）"
        secureTextEntry
        value={loginPw}
        onChangeText={setLoginPw}
      />
      <Button
        title="保存登录"
        disabled={loginName.trim().length < 2 || loginPw.length < 8}
        onPress={() =>
          run(async () => {
            await api(
              `/admin/members/${member.id}/login`,
              { username: loginName.trim(), password: loginPw },
              "PUT",
            );
            setLoginPw("");
            await reload();
          })
        }
      />
      {member.role !== "owner" && (
        <Button
          title={member.enabled ? "停用成员" : "启用成员"}
          onPress={() =>
            run(async () => {
              await api(
                `/admin/members/${member.id}`,
                {
                  enabled: !member.enabled,
                  photoLimit: member.photo_limit,
                  writeLimit: member.write_limit,
                },
                "PATCH",
              );
              await reload();
            })
          }
        />
      )}
    </Card>
  );
}
export function AISettingsScreen() {
  const s = useStyles(),
    [me, setMe] = useState<{ member: Member; usage: Usage } | null>(null),
    [overview, setOverview] = useState<Overview | null>(null),
    [settings, setSettings] = useState<AISettings | null>(null),
    [initialized, setInitialized] = useState<boolean | null>(null),
    [username, setUsername] = useState(""),
    [password, setPassword] = useState(""),
    [deviceName, setDeviceName] = useState(
      Platform.OS === "ios" ? "我的 iPhone" : "我的 Android",
    ),
    [currentPw, setCurrentPw] = useState(""),
    [nextPw, setNextPw] = useState(""),
    [newUsername, setNewUsername] = useState(""),
    [newPassword, setNewPassword] = useState(""),
    [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const refresh = async () => {
    if (!(await getToken())) {
      setMe(null);
      setOverview(null);
      setInitialized((await serviceStatus()).initialized);
      return;
    }
    setInitialized(null);
    let member: { member: Member; usage: Usage };
    try {
      member = await api<{ member: Member; usage: Usage }>("/me");
    } catch (e) {
      if (!(e instanceof AIError && e.code === "AUTH_REQUIRED")) throw e;
      // 令牌已被服务端作废（重置或撤销）：清掉它并回到登录表单，
      // 否则按钮永远禁用，用户被困在死胡同；网络故障仍照常报错。
      await disconnect();
      setMe(null);
      setOverview(null);
      setInitialized((await serviceStatus()).initialized);
      return;
    }
    setMe(member);
    if (member.member.role === "owner") {
      const data = await api<Overview>("/admin/overview");
      setOverview(data);
      setSettings(data.settings);
    }
  };
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    let mounted = true;
    void getToken()
      .then(() => {
        if (mounted) return refresh();
      })
      .catch((e) => {
        if (mounted) setError(messageOf(e));
      });
    return () => {
      mounted = false;
    };
  }, []); // This page is opened explicitly; normal journal screens never connect.
  return (
    <Page>
      <Text style={s.title}>AI 设置</Text>
      <Text style={s.muted}>
        使用 DeepSeek Flash High
        整理照片和写记录。原图和成长记录继续保存在本机。
      </Text>
      {me ? (
        <>
          <Text>
            {me.member.name} · {me.member.role === "owner" ? "主人" : "已加入"}
          </Text>
          <Text>
            今日已用：{me.usage.photos}/{me.member.photo_limit} 张图片，
            {me.usage.writes}/{me.member.write_limit} 次文案
          </Text>
          <Text style={s.muted}>
            额度每天 UTC 00:00 重置；生成文案使用的图片也计入分析额度。
          </Text>
          <Button
            title="退出登录"
            disabled={busy}
            onPress={() =>
              Alert.alert(
                "退出登录？",
                "只影响这台设备上的 AI 功能，本机照片与记录保留。重新登录即可再次使用。",
                [
                  { text: "取消", style: "cancel" },
                  {
                    text: "退出",
                    onPress: () => {
                      void run(async () => {
                        await disconnect();
                        await refresh();
                      });
                    },
                  },
                ],
              )
            }
          />
          <Text style={s.title}>修改密码</Text>
          <Field
            label="当前密码"
            secureTextEntry
            value={currentPw}
            onChangeText={setCurrentPw}
          />
          <Field
            label="新密码（至少 8 位）"
            secureTextEntry
            value={nextPw}
            onChangeText={setNextPw}
          />
          <Button
            title="修改密码"
            disabled={busy || nextPw.length < 8}
            onPress={() => {
              void run(async () => {
                await changePassword(currentPw, nextPw);
                setCurrentPw("");
                setNextPw("");
                setNotice("密码已更新，下次登录用新密码。");
              });
            }}
          />
        </>
      ) : (
        <>
          {initialized === false && (
            <Text style={s.muted}>
              这台服务还没有账号：现在创建的是主人账号，只此一次；
              之后家人用主人创建的账号登录。
            </Text>
          )}
          <Field
            label="用户名"
            autoCapitalize="none"
            autoCorrect={false}
            value={username}
            onChangeText={setUsername}
          />
          <Field
            label="密码（至少 8 位）"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />
          <Field
            label="这台设备的名字"
            value={deviceName}
            onChangeText={setDeviceName}
          />
          <Button
            title={initialized === false ? "创建主人账号" : "登录"}
            primary
            disabled={
              busy ||
              initialized === null ||
              !username.trim() ||
              password.length < 8 ||
              !deviceName.trim()
            }
            onPress={() => {
              void run(async () => {
                if (initialized === false)
                  await setupService(username, password, deviceName);
                else await login(username, password, deviceName);
                setPassword("");
                await refresh();
              });
            }}
          />
        </>
      )}
      <Button
        title={busy ? "正在读取…" : "刷新状态"}
        disabled={busy}
        onPress={() => {
          void run(refresh);
        }}
      />
      <ErrorText message={error} />
      {!!notice && <Text style={s.muted}>{notice}</Text>}
      {overview && settings && (
        <>
          <Text style={s.title}>主人管理</Text>
          <Text>
            全局今日：{overview.usage.photos} 张图片 · {overview.usage.writes}{" "}
            次文案 · {overview.usage.tokens} tokens
          </Text>
          <Text style={s.muted}>用量由 CPA 返回，不等同于实际账单。</Text>
          <Button
            title={settings.paused ? "AI 已暂停，点击恢复" : "暂停全部 AI"}
            selected={settings.paused}
            disabled={busy}
            onPress={() => {
              void run(async () => {
                await api(
                  "/admin/settings",
                  { ...settings, paused: !settings.paused },
                  "PUT",
                );
                await refresh();
              });
            }}
          />
          <Field
            label="全局每日图片额度"
            value={String(settings.globalPhotos)}
            keyboardType="number-pad"
            onChangeText={(v) =>
              setSettings({ ...settings, globalPhotos: Number(v) })
            }
          />
          <Field
            label="全局每日文案额度"
            value={String(settings.globalWrites)}
            keyboardType="number-pad"
            onChangeText={(v) =>
              setSettings({ ...settings, globalWrites: Number(v) })
            }
          />
          <Button
            title="保存全局设置"
            disabled={busy}
            onPress={() => {
              void run(async () => {
                await api("/admin/settings", settings, "PUT");
                await refresh();
              });
            }}
          />
          <Text style={s.title}>创建家人账号</Text>
          <Field
            label="用户名"
            autoCapitalize="none"
            autoCorrect={false}
            value={newUsername}
            onChangeText={setNewUsername}
          />
          <Field
            label="初始密码（至少 8 位）"
            secureTextEntry
            value={newPassword}
            onChangeText={setNewPassword}
          />
          <Button
            title="创建账号"
            disabled={
              busy || newUsername.trim().length < 2 || newPassword.length < 8
            }
            onPress={() => {
              void run(async () => {
                const created = newUsername.trim();
                await api("/admin/members", {
                  username: created,
                  password: newPassword,
                });
                setNewUsername("");
                setNewPassword("");
                setNotice(`已创建「${created}」，把用户名和初始密码告诉家人即可。`);
                await refresh();
              });
            }}
          />
          {overview.members.map((member) => (
            <MemberRow
              key={member.id}
              member={member}
              reload={refresh}
              run={(fn) => {
                if (!busy) void run(fn);
              }}
            />
          ))}
          <Text style={s.title}>已加入的设备</Text>
          {overview.devices.map((device) => (
            <Card key={device.id}>
              <Text>
                {overview.members.find((m) => m.id === device.member_id)?.name}{" "}
                · {device.name}
              </Text>
              <Text style={s.muted}>
                {device.revoked ? "已撤销" : "可使用 AI"}
              </Text>
              {!device.revoked && device.id !== me?.member.deviceId && (
                <Button
                  title="撤销设备"
                  disabled={busy}
                  onPress={() =>
                    Alert.alert(
                      "撤销这台设备？",
                      "只关闭它的 AI 访问，本机记录不受影响。",
                      [
                        { text: "取消", style: "cancel" },
                        {
                          text: "撤销",
                          style: "destructive",
                          onPress: () => {
                            void run(async () => {
                              await api(
                                `/admin/devices/${device.id}`,
                                undefined,
                                "DELETE",
                              );
                              await refresh();
                            });
                          },
                        },
                      ],
                    )
                  }
                />
              )}
            </Card>
          ))}
        </>
      )}
    </Page>
  );
}
