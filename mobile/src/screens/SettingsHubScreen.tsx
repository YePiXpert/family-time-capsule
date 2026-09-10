import { AiSettingsSection } from "../ai/AiSettingsSection";
import { Text } from "../components/typography";
import { useState } from "react";
import { Alert, Linking, ScrollView, StyleSheet, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { AppNavigation } from "../navigation/types";
import { useApp } from "../state/AppContext";
import { Disclosure } from "../components/Disclosure";
import { DisplayModeCard } from "../components/DisplayModeCard";
import { Chip, ListGroup, ListRow } from "../components/ui";
import { useColorTheme, type ThemeMode } from "../theme";
import { journalRadius, journalSpace, journalType } from "../design/tokens";

const roleLabels: Record<string, string> = {
  owner: "家庭管理员",
  admin: "管理员",
  editor: "记录者",
  contributor: "记录者",
  viewer: "读者",
};

const themeModes: { key: ThemeMode; label: string }[] = [
  { key: "auto", label: "跟随系统" },
  { key: "light", label: "浅色" },
  { key: "dark", label: "深色" },
];

export function SettingsHubScreen() {
  const navigation = useNavigation<AppNavigation>();
  const insets = useSafeAreaInsets();
  const { colors } = useColorTheme();
  const { credentials, viewer, family, themeMode, setThemeMode } = useApp();
  const [section, setSection] = useState("");
  const group = (name: string) => ({ title: name, open: section === name, onToggle: () => setSection(value => value === name ? "" : name) });
  const web = async (path: string) => {
    if (!credentials) { navigation.navigate("DeviceSettings"); return; }
    try { await Linking.openURL(`${credentials.serverUrl}${path}`); }
    catch { Alert.alert("无法打开", "请检查网络或浏览器设置。"); }
  };
  const manager = viewer?.role === "owner" || viewer?.role === "admin";
  const initial = (viewer?.name ?? "我").trim().slice(0, 1) || "我";
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.paper }}
      contentContainerStyle={{ padding: journalSpace.page, paddingTop: insets.top + 20, paddingBottom: 210, gap: 18 }}
    >
      {/* 身份卡：家人先看到自己，再看到设置 */}
      <View style={styles.identity}>
        <View style={[styles.avatar, { backgroundColor: colors.softCoral }]}>
          <Text style={[styles.avatarText, { color: colors.coralDark }]}>{initial}</Text>
        </View>
        <View style={styles.identityText}>
          <Text accessibilityRole="header" style={[styles.name, { color: colors.ink }]}>{viewer?.name ?? "我的成长手帐"}</Text>
          <Text style={[styles.family, { color: colors.muted }]}>
            {[family?.name, viewer?.role ? roleLabels[viewer.role] ?? null : null].filter(Boolean).join(" · ") || "照片、声音和想留下的话，都好好保存。"}
          </Text>
        </View>
      </View>

      {/* 四组设置保持手风琴结构（NAV-11：大字模式下结构不变） */}
      <Disclosure {...group("家人和账号")}>
        <ListGroup>
          <ListRow icon="users" title="家人" detail="名字、生日和角色" onPress={() => navigation.navigate("People")} />
          {credentials && manager ? (
            <ListRow icon="plus" title="邀请家人加入" detail="生成邀请，让家人一起记录" onPress={() => navigation.navigate("InviteFamily")} />
          ) : null}
          {credentials && manager ? (
            <ListRow icon="person" title="管理账号" detail="在浏览器中打开" onPress={() => void web("/settings/accounts")} />
          ) : null}
          <ListRow icon="lock" title="账号安全" detail="通行密钥与登录保护" onPress={() => void web("/settings/security")} last />
        </ListGroup>
      </Disclosure>

      <Disclosure {...group("存储与同步")}>
        <ListGroup>
          <ListRow icon="settings" title="设备与同步" detail="上传状态、待传记录与本机空间" onPress={() => navigation.navigate("DeviceSettings")} />
          <ListRow icon="image" title="资料库" detail="全部照片、视频与声音原件" onPress={() => navigation.navigate("AssetLibrary")} />
          <ListRow icon="download" title="导入进度" onPress={() => navigation.navigate("ImportSessions")} />
          <ListRow icon="book" title="离线下载" detail="没网也能翻的内容" onPress={() => navigation.navigate("ReadingDownloads")} last />
        </ListGroup>
      </Disclosure>

      <Disclosure {...group("备份与恢复")}>
        <ListGroup>
          <ListRow icon="file" title="本机备份与恢复" onPress={() => navigation.navigate("DeviceSettings")} last={!manager} />
          {manager ? <ListRow icon="users" title="家庭备份与恢复" detail="在浏览器中打开" onPress={() => void web("/settings/backup")} last /> : null}
        </ListGroup>
      </Disclosure>

      <Disclosure {...group("显示与辅助")}>
        <View style={[styles.displayCard, { backgroundColor: colors.card, borderColor: colors.line }]}>
          <DisplayModeCard />
          <View style={styles.themeRow}>
            <Text style={[styles.themeLabel, { color: colors.ink }]}>外观</Text>
            <View style={styles.themeChips}>
              {themeModes.map(mode => (
                <Chip
                  key={mode.key}
                  accessibilityRole="button"
                  label={mode.label}
                  selected={(themeMode ?? "auto") === mode.key}
                  onPress={() => void setThemeMode(mode.key)}
                />
              ))}
            </View>
          </View>
        </View>
        {credentials && manager ? (
          <View style={{ marginTop: 12 }}>
            <Disclosure title="AI 整理与隐私"><AiSettingsSection /></Disclosure>
          </View>
        ) : null}
      </Disclosure>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  identity: { flexDirection: "row", alignItems: "center", gap: 14, paddingBottom: 6 },
  avatar: {
    width: 58,
    height: 58,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontSize: 24, fontWeight: "800" },
  identityText: { flex: 1, gap: 3 },
  name: { fontSize: journalType.heading + 2, fontWeight: "800" },
  family: { fontSize: journalType.label },
  displayCard: {
    borderRadius: journalRadius.card,
    borderWidth: 1,
    padding: 16,
    gap: 16,
  },
  themeRow: { gap: 10 },
  themeLabel: { fontSize: journalType.label, fontWeight: "600" },
  themeChips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});
