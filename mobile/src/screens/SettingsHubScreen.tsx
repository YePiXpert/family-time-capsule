import { AiSettingsSection } from "../ai/AiSettingsSection";
import { Text } from "../components/typography";
import { useState } from "react";
import { Alert, Linking, Pressable, ScrollView, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { AppNavigation } from "../navigation/types";
import { useApp } from "../state/AppContext";
import { Disclosure } from "../components/Disclosure";
import { DisplayModeCard } from "../components/DisplayModeCard";
import { sharedStyles as s } from "../theme";

export function SettingsHubScreen() {
  const navigation = useNavigation<AppNavigation>();
  const { credentials, viewer, family } = useApp();
  const [section, setSection] = useState("");
  const group = (name: string) => ({ title: name, open: section === name, onToggle: () => setSection(value => value === name ? "" : name) });
  const web = async (path: string) => {
    if (!credentials) { navigation.navigate("DeviceSettings"); return; }
    try { await Linking.openURL(`${credentials.serverUrl}${path}`); }
    catch { Alert.alert("无法打开", "请检查网络或浏览器设置。"); }
  };
  const button = (label: string, action: () => void) => <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={action} style={s.secondaryButton}><Text style={s.secondaryText}>{label}</Text></Pressable>;
  const manager = viewer?.role === "owner" || viewer?.role === "admin";
  return <ScrollView style={s.screen} contentContainerStyle={s.content}>
    <Text style={s.title}>{family?.name ?? "设置"}</Text>
    <Disclosure {...group("家人和账号")}>
      {button("家人", () => navigation.navigate("People"))}
      {credentials && manager ? <>{button("邀请家人加入", () => navigation.navigate("InviteFamily"))}{button("管理账号", () => void web("/settings/accounts"))}</> : null}
      {button("账号安全", () => void web("/settings/security"))}
    </Disclosure>
    <Disclosure {...group("存储与同步")}>
      {button("设备与同步", () => navigation.navigate("DeviceSettings"))}
      {button("资料库", () => navigation.navigate("AssetLibrary"))}
      {button("导入进度", () => navigation.navigate("ImportSessions"))}
      {button("离线下载", () => navigation.navigate("ReadingDownloads"))}
    </Disclosure>
    <Disclosure {...group("备份与恢复")}>
      {button("本机备份与恢复", () => navigation.navigate("DeviceSettings"))}
      {manager ? button("家庭备份与恢复", () => void web("/settings/backup")) : null}
    </Disclosure>
    <Disclosure {...group("显示与辅助")}>
      <DisplayModeCard />
      {credentials && manager ? <Disclosure title="AI 整理与隐私"><AiSettingsSection /></Disclosure> : null}
    </Disclosure>
    <View><Text style={s.body}>{viewer?.name ?? "本机记录"}</Text></View>
  </ScrollView>;
}
