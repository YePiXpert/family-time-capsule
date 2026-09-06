import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Share,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import QRCode from "react-native-qrcode-svg";
import { createInvitation } from "../api/client";
import { useApp } from "../state/AppContext";
import { colors, sharedStyles } from "../theme";
import type { InvitationCreateResult } from "../types";

/**
 * 邀请家人加入（M2，仅管理员）：创建高熵一次性账号邀请，
 * 本地生成二维码（不调用第三方服务），提供系统分享与复制。
 * token 只在创建响应中出现一次，不写日志与常规存储。
 */

const ROLES: { key: "admin" | "editor" | "contributor" | "viewer"; label: string; hint: string }[] = [
  { key: "contributor", label: "记录者", hint: "记录与投稿，不整理收件箱" },
  { key: "editor", label: "编辑", hint: "整理记忆、故事与相册" },
  { key: "viewer", label: "只读家人", hint: "只查看家庭档案" },
  { key: "admin", label: "管理员", hint: "全部权限，慎用" },
];

export function InviteFamilyScreen() {
  const { credentials, people } = useApp();
  const [role, setRole] = useState<"admin" | "editor" | "contributor" | "viewer">("contributor");
  const [expiresInDays, setExpiresInDays] = useState(7);
  const [personId, setPersonId] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<InvitationCreateResult | null>(null);

  const link = credentials && result ? `${credentials.serverUrl}${result.invitePath}` : "";

  const submit = async () => {
    if (!credentials) {
      setError("尚未连接家庭空间。");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      setResult(
        await createInvitation(credentials, {
          role,
          expiresInDays,
          personId: personId || undefined,
        }),
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "创建邀请失败。");
    } finally {
      setCreating(false);
    }
  };

  const copy = async () => {
    if (!link) return;
    await Clipboard.setStringAsync(link);
    Alert.alert("已复制", "邀请链接已复制；请只发送给要邀请的家人。");
  };

  const share = async () => {
    if (!link) return;
    try {
      await Share.share({ message: link });
    } catch {
      // 用户取消分享时静默返回
    }
  };

  return (
    <ScrollView contentContainerStyle={sharedStyles.content} style={sharedStyles.screen}>
      <Text style={sharedStyles.eyebrow}>账号邀请</Text>
      <Text style={sharedStyles.title}>邀请家人加入</Text>
      <Text style={sharedStyles.intro}>
        生成一次性邀请链接或二维码。家人在 App 的“加入家人的家庭”中粘贴或扫码，即可用自己的账号加入本家庭。
      </Text>

      {result ? (
        <View style={sharedStyles.card}>
          <Text style={sharedStyles.cardTitle}>邀请已创建（只显示这一次）</Text>
          <View style={styles.qrWrap}>
            <QRCode size={200} value={link} />
          </View>
          <Text numberOfLines={3} selectable style={styles.link}>
            {link}
          </Text>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Pressable onPress={() => void copy()} style={[sharedStyles.secondaryButton, { flex: 1 }]}>
              <Text style={sharedStyles.secondaryText}>复制链接</Text>
            </Pressable>
            <Pressable onPress={() => void share()} style={[sharedStyles.secondaryButton, { flex: 1 }]}>
              <Text style={sharedStyles.secondaryText}>系统分享</Text>
            </Pressable>
          </View>
          <Text style={styles.note}>
            邀请 {expiresInDays} 天内有效，使用一次后失效；二维码在本机生成，不会发送给任何第三方。
          </Text>
          <Pressable
            onPress={() => {
              setResult(null);
              setPersonId("");
            }}
            style={sharedStyles.primaryButton}
          >
            <Text style={sharedStyles.primaryText}>再创建一个邀请</Text>
          </Pressable>
        </View>
      ) : (
        <View style={sharedStyles.card}>
          <Text style={sharedStyles.label}>家人在家庭中的身份</Text>
          {ROLES.map((entry) => (
            <Pressable
              key={entry.key}
              onPress={() => setRole(entry.key)}
              style={[styles.roleRow, role === entry.key && styles.roleRowActive]}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.roleLabel}>{entry.label}</Text>
                <Text style={styles.roleHint}>{entry.hint}</Text>
              </View>
              <Text style={styles.roleMark}>{role === entry.key ? "✓" : ""}</Text>
            </Pressable>
          ))}
          <Text style={sharedStyles.label}>有效期（天）</Text>
          <TextInput
            keyboardType="number-pad"
            onChangeText={(value) => {
              const parsed = Number.parseInt(value.replace(/[^0-9]/gu, ""), 10);
              setExpiresInDays(Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 30) : 1);
            }}
            style={sharedStyles.input}
            value={String(expiresInDays)}
          />
          {people.length > 0 ? (
            <>
              <Text style={sharedStyles.label}>关联已有家人档案（可选）</Text>
              {people.map((entry) => (
                <Pressable
                  key={entry.id}
                  onPress={() => setPersonId(personId === entry.id ? "" : entry.id)}
                  style={[styles.roleRow, personId === entry.id && styles.roleRowActive]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.roleLabel}>{entry.displayName}</Text>
                    <Text style={styles.roleHint}>{entry.relationToChild ?? "家庭成员"}</Text>
                  </View>
                  <Text style={styles.roleMark}>{personId === entry.id ? "✓" : ""}</Text>
                </Pressable>
              ))}
            </>
          ) : null}
          {error ? <Text style={sharedStyles.error}>{error}</Text> : null}
          <Pressable disabled={creating} onPress={() => void submit()} style={sharedStyles.primaryButton}>
            {creating ? <ActivityIndicator color="#FFFFFF" /> : <Text style={sharedStyles.primaryText}>创建邀请</Text>}
          </Pressable>
        </View>
      )}
    </ScrollView>
  );
}

const styles = {
  qrWrap: { alignItems: "center", paddingVertical: 12, backgroundColor: "#FFFFFF", borderRadius: 12 },
  link: { color: colors.ink, fontSize: 12, lineHeight: 18 },
  note: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  roleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderColor: colors.line,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  roleRowActive: { borderColor: colors.coral, backgroundColor: colors.softCoral },
  roleLabel: { color: colors.ink, fontSize: 15, fontWeight: "800" },
  roleHint: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  roleMark: { color: colors.coralDark, fontSize: 18, fontWeight: "900" },
} as const;
