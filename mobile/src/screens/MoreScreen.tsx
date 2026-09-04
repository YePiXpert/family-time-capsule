import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useApp } from "../state/AppContext";
import type { AppNavigation } from "../navigation/types";
import { colors, sharedStyles } from "../theme";

const webEntries = [
  ["家人", "/family", "查看人物主页与共同记忆"],
  ["故事", "/stories", "阅读和整理家庭故事"],
  ["口述史", "/requests", "待回答与已收到的讲述"],
  ["时间胶囊", "/capsules", "查看封存与开启状态"],
  ["书籍与备份", "/settings", "制作书籍、导出与恢复"],
  ["回收站", "/trash", "恢复最近移除的内容"],
] as const;

export function MoreScreen() {
  const navigation = useNavigation<AppNavigation>();
  const { credentials } = useApp();
  const openWeb = async (path: string) => {
    if (!credentials) {
      navigation.navigate("Settings");
      return;
    }
    try {
      await Linking.openURL(`${credentials.serverUrl}${path}`);
    } catch {
      Alert.alert("无法打开", "请检查服务器地址或系统浏览器设置。");
    }
  };
  return <ScrollView contentContainerStyle={sharedStyles.content} style={sharedStyles.screen}>
    <Text style={sharedStyles.eyebrow}>家庭档案的其他部分</Text><Text style={sharedStyles.title}>更多</Text>
    <Pressable onPress={() => navigation.navigate("Search")} style={({ pressed }) => [styles.row, pressed && sharedStyles.pressed]}><View style={styles.grow}><Text style={styles.title}>搜索</Text><Text style={styles.hint}>在原生 App 中查找记忆与讲述</Text></View><Text style={styles.arrow}>›</Text></Pressable>
    {webEntries.map(([label, path, hint]) => <Pressable key={label} onPress={() => void openWeb(path)} style={({ pressed }) => [styles.row, pressed && sharedStyles.pressed]}><View style={styles.grow}><Text style={styles.title}>{label}</Text><Text style={styles.hint}>{hint}</Text></View><Text style={styles.arrow}>›</Text></Pressable>)}
    <Pressable onPress={() => navigation.navigate("Settings")} style={({ pressed }) => [styles.row, pressed && sharedStyles.pressed]}><View style={styles.grow}><Text style={styles.title}>设置</Text><Text style={styles.hint}>服务器、同步与本机数据</Text></View><Text style={styles.arrow}>›</Text></Pressable>
    <View style={sharedStyles.notice}><Text style={sharedStyles.noticeText}>故事、胶囊、书籍和高级备份沿用自托管 Web 的完整能力；打开后可能需要在浏览器登录。</Text></View>
  </ScrollView>;
}

const styles = StyleSheet.create({
  row: { minHeight: 68, flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.card, borderColor: colors.line, borderWidth: 1, borderRadius: 15, paddingHorizontal: 15, paddingVertical: 10 },
  grow: { flex: 1, gap: 3 },
  title: { color: colors.ink, fontSize: 16, fontWeight: "800" },
  hint: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  arrow: { color: colors.coral, fontSize: 28 },
});
