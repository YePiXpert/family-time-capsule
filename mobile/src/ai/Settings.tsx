import { useEffect, useState } from "react";
import { Alert, Platform, Share, View } from "react-native";
import {
  Button,
  ErrorText,
  Field,
  Page,
  Text,
  messageOf,
  useStyles,
} from "../local/ui";
import { api, disconnect, enroll, getToken } from "./client";
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
    [writes, setWrites] = useState(String(member.write_limit));
  return (
    <View style={s.section}>
      <Text>
        {member.name}
        {member.role === "owner" ? " · 主人" : ""}
        {member.enabled ? "" : " · 已停用"}
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
      {member.role !== "owner" && (
        <>
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
          {!!member.enabled && (
            <Button
              title="为此成员邀请另一台设备"
              onPress={() =>
                run(async () => {
                  const result = await api<{ code: string }>("/admin/invites", {
                    name: member.name,
                    memberId: member.id,
                  });
                  await Share.share({
                    message: `小美成长记 AI 邀请码：${result.code}\n在「我的 → AI 设置」加入。24 小时内有效，只能使用一次。`,
                  });
                })
              }
            />
          )}
        </>
      )}
    </View>
  );
}
export function AISettingsScreen() {
  const s = useStyles(),
    [me, setMe] = useState<{ member: Member; usage: Usage } | null>(null),
    [overview, setOverview] = useState<Overview | null>(null),
    [settings, setSettings] = useState<AISettings | null>(null),
    [code, setCode] = useState(""),
    [deviceName, setDeviceName] = useState(
      Platform.OS === "ios" ? "我的 iPhone" : "我的 Android",
    ),
    [inviteName, setInviteName] = useState(""),
    [inviteCode, setInviteCode] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const refresh = async () => {
    if (!(await getToken())) {
      setMe(null);
      setOverview(null);
      return;
    }
    const member = await api<{ member: Member; usage: Usage }>("/me");
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
            title="断开本机 AI 访问"
            disabled={busy}
            onPress={() =>
              Alert.alert(
                "断开 AI？",
                "本机照片与记录保留。再次使用需要新的邀请码。",
                [
                  { text: "取消", style: "cancel" },
                  {
                    text: "断开",
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
        </>
      ) : (
        <>
          <Field
            label="邀请码 / 主人激活码"
            autoCapitalize="none"
            autoCorrect={false}
            value={code}
            onChangeText={setCode}
            secureTextEntry
          />
          <Field
            label="这台设备的名字"
            value={deviceName}
            onChangeText={setDeviceName}
          />
          <Button
            title="加入 AI 服务"
            primary
            disabled={busy || !code.trim() || !deviceName.trim()}
            onPress={() => {
              void run(async () => {
                await enroll(code, deviceName);
                setCode("");
                await refresh();
              });
            }}
          />
          <Button
            title="清除失效凭证"
            disabled={busy}
            onPress={() => {
              void run(async () => {
                await disconnect();
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
      {overview && settings && (
        <>
          <Text style={s.title}>主人管理</Text>
          <Field
            label="新成员名字"
            value={inviteName}
            onChangeText={setInviteName}
          />
          <Button
            title="生成邀请码"
            disabled={busy || !inviteName.trim()}
            onPress={() => {
              void run(async () => {
                const result = await api<{ code: string }>("/admin/invites", {
                  name: inviteName,
                });
                setInviteCode(result.code);
                setInviteName("");
                await refresh();
              });
            }}
          />
          {!!inviteCode && (
            <View style={s.section}>
              <Text selectable>{inviteCode}</Text>
              <Text style={s.muted}>24 小时有效，使用一次后失效。</Text>
              <Button
                title="分享邀请码"
                onPress={() => {
                  void Share.share({
                    message: `小美成长记 AI 邀请码：${inviteCode}\n在「我的 → AI 设置」加入。24 小时内有效。`,
                  }).catch((e) => setError(messageOf(e)));
                }}
              />
            </View>
          )}
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
            <View key={device.id} style={s.section}>
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
            </View>
          ))}
        </>
      )}
    </Page>
  );
}
