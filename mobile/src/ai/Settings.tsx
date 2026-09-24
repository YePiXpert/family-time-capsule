import { useEffect, useState } from "react";
import { Alert } from "react-native";
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
import { AIError, api, getToken } from "./client";
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
    <Card>
      <Text>
        {member.name}
        {member.role === "admin" ? " · 管理者" : ""}
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
      {member.role !== "admin" && (
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
    [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const refresh = async () => {
    if (!(await getToken())) {
      setMe(null);
      setOverview(null);
      return;
    }
    let member: { member: Member; usage: Usage };
    try {
      member = await api<{ member: Member; usage: Usage }>("/me");
    } catch (e) {
      if (!(e instanceof AIError && e.code === "AUTH_REQUIRED")) throw e;
      // 这台手机已被停用：AI 用不了，去「家庭与设备」重新加入；网络故障仍照常报错。
      setMe(null);
      setOverview(null);
      return;
    }
    setMe(member);
    if (member.member.role === "admin") {
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
    <Page title="AI 设置">
      <Text style={s.muted}>
        加入家庭后，AI 可以帮你润色文字、追问细节。AI 只处理你当次交给它的文字或声音。
      </Text>
      {me ? (
        <>
          <Text>
            {me.member.name} · {me.member.role === "admin" ? "管理者" : "家人"}
          </Text>
          <Text>
            今日已用：{me.usage.photos}/{me.member.photo_limit} 张图片，
            {me.usage.writes}/{me.member.write_limit} 次文案
          </Text>
          <Text style={s.muted}>
            额度每天 UTC 00:00 重置；生成文案使用的图片也计入分析额度。
          </Text>
        </>
      ) : (
        <Text style={s.muted}>
          这台手机还没加入家庭。到「我的 → 家庭与设备」加入后，就能用 AI。
        </Text>
      )}
      <Button
        title={busy ? "正在读取…" : "刷新状态"}
        kind="text"
        disabled={busy}
        onPress={() => {
          void run(refresh);
        }}
      />
      <ErrorText message={error} />
      {!!notice && <Text style={s.muted}>{notice}</Text>}
      {overview && settings && (
        <>
          <Text style={s.heading}>管理</Text>
          <Text>
            全局今日：{overview.usage.photos} 张图片 · {overview.usage.writes}{" "}
            次文案 · {overview.usage.tokens} tokens
          </Text>
          <Text style={s.muted}>用量以服务端统计为准，不等同于实际账单。</Text>
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
          <Text style={s.heading}>已加入的设备</Text>
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
      <Text style={s.footnote}>由小米 MiMo 2.6 Pro 提供</Text>
    </Page>
  );
}
