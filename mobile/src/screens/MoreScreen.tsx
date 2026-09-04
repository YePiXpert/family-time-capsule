import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useApp } from "../state/AppContext";
import type { AppNavigation } from "../navigation/types";
import { colors, sharedStyles } from "../theme";

const nativeEntries = [
  ["家人", "People", "人物主页、共同记忆与独立讲述"],
  ["故事", "Stories", "阅读、编辑和发布家庭故事"],
  ["口述史", "Requests", "发起问题并查看回答状态"],
  ["时间胶囊", "Capsules", "创建、封存和到期打开"],
  ["家庭投递箱", "ContributionPortals", "创建安全链接并查看访客提交"],
  ["导入会话", "ImportSessions", "查看、继续或取消批量导入"],
  ["每周回顾", "WeeklyReview", "整理本周素材与家人声音"],
] as const;

const webEntries = [
  ["完整恢复与远程备份", "/settings/backup", "恢复、WebDAV 与 S3 等高风险配置"],
  ["大型 PDF / EPUB 排版", "/books", "在大屏完成年度成书排版"],
  ["账号与安全管理", "/settings/accounts", "管理账号、邀请和高风险安全设置"],
  ["复杂审计查看", "/settings", "查看完整操作审计"],
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
    {nativeEntries.map(([label, route, hint]) => <Pressable key={label} onPress={() => navigation.navigate(route)} style={({ pressed }) => [styles.row, pressed && sharedStyles.pressed]}><View style={styles.grow}><Text style={styles.title}>{label}</Text><Text style={styles.hint}>{hint}</Text></View><Text style={styles.arrow}>›</Text></Pressable>)}
    <Text style={sharedStyles.eyebrow}>仅在 Web 完成的高级操作</Text>
    {webEntries.map(([label, path, hint]) => <Pressable key={label} onPress={() => void openWeb(path)} style={({ pressed }) => [styles.row, pressed && sharedStyles.pressed]}><View style={styles.grow}><Text style={styles.title}>{label}</Text><Text style={styles.hint}>{hint}</Text></View><Text style={styles.arrow}>›</Text></Pressable>)}
    <Pressable onPress={() => navigation.navigate("Settings")} style={({ pressed }) => [styles.row, pressed && sharedStyles.pressed]}><View style={styles.grow}><Text style={styles.title}>设置</Text><Text style={styles.hint}>服务器、同步与本机数据</Text></View><Text style={styles.arrow}>›</Text></Pressable>
    <View style={sharedStyles.notice}><Text style={sharedStyles.noticeText}>家人、故事、胶囊、口述史、投递箱和导入会话均以原生页面为日常主路径。只有恢复、远程备份、成书排版、账号安全和复杂审计继续使用 Web。</Text></View>
  </ScrollView>;
}

const styles = StyleSheet.create({
  row: { minHeight: 68, flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.card, borderColor: colors.line, borderWidth: 1, borderRadius: 15, paddingHorizontal: 15, paddingVertical: 10 },
  grow: { flex: 1, gap: 3 },
  title: { color: colors.ink, fontSize: 16, fontWeight: "800" },
  hint: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  arrow: { color: colors.coral, fontSize: 28 },
});
