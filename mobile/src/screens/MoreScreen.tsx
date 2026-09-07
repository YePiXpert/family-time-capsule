import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useApp } from "../state/AppContext";
import type { AppNavigation } from "../navigation/types";
import { colors, sharedStyles } from "../theme";
import { DisplayModeCard } from "../components/DisplayModeCard";

const nativeEntries = [
  ["离线收藏", "ReadingDownloads", "下载相册和作品，断网阅读并管理容量"],
  ["家庭书架", "Books", "选材、阅读并调整可持续编辑的作品"],
  ["故事", "Stories", "阅读、编辑和发布家庭故事"],
  ["口述史", "Requests", "发起问题并查看回答状态"],
  ["时间胶囊", "Capsules", "创建、封存和到期打开"],
  ["家庭投递箱", "ContributionPortals", "创建安全链接并查看访客提交"],
  ["收到的内容", "ImportSessions", "继续系统分享、文件导入，加入草稿或仅存资料库"],
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
  const { credentials, viewer, displayMode } = useApp();
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
  // 大字简洁显示：只保留日常入口与显示切换；高级页面路由不变，切回标准显示即可使用。
  if (displayMode === "simple") {
    return <ScrollView contentContainerStyle={sharedStyles.content} style={sharedStyles.screen}>
      <Text style={sharedStyles.eyebrow}>我的</Text><Text style={sharedStyles.title}>我的</Text>
      <DisplayModeCard />
      <Pressable accessibilityRole="button" accessibilityLabel="照片和回忆" onPress={() => navigation.navigate("Timeline")} style={({ pressed }) => [styles.row, pressed && sharedStyles.pressed]}><View style={styles.grow}><Text style={styles.title}>照片和回忆</Text><Text style={styles.hint}>按时间看家里的照片</Text></View><Text style={styles.arrow}>›</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="家人" onPress={() => navigation.navigate("People")} style={({ pressed }) => [styles.row, pressed && sharedStyles.pressed]}><View style={styles.grow}><Text style={styles.title}>家人</Text><Text style={styles.hint}>看看每位家人</Text></View><Text style={styles.arrow}>›</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="设置" onPress={() => navigation.navigate("Settings")} style={({ pressed }) => [styles.row, pressed && sharedStyles.pressed]}><View style={styles.grow}><Text style={styles.title}>设置</Text><Text style={styles.hint}>连接家庭服务器</Text></View><Text style={styles.arrow}>›</Text></Pressable>
    </ScrollView>;
  }
  return <ScrollView contentContainerStyle={sharedStyles.content} style={sharedStyles.screen}>
    <Text style={sharedStyles.eyebrow}>家庭档案的其他部分</Text><Text style={sharedStyles.title}>更多</Text>
    <DisplayModeCard />
    <Pressable accessibilityRole="button" accessibilityLabel="搜索" onPress={() => navigation.navigate("Search")} style={({ pressed }) => [styles.row, pressed && sharedStyles.pressed]}><View style={styles.grow}><Text style={styles.title}>搜索</Text><Text style={styles.hint}>在原生 App 中查找记忆与讲述</Text></View><Text style={styles.arrow}>›</Text></Pressable>
    {credentials && viewer?.role === "admin" ? <Pressable accessibilityRole="button" accessibilityLabel="邀请家人加入" onPress={() => navigation.navigate("InviteFamily")} style={({ pressed }) => [styles.row, pressed && sharedStyles.pressed]}><View style={styles.grow}><Text style={styles.title}>邀请家人加入</Text><Text style={styles.hint}>生成二维码或一次性链接，家人用自己的账号加入</Text></View><Text style={styles.arrow}>›</Text></Pressable> : null}
    {nativeEntries.map(([label, route, hint]) => <Pressable key={label} accessibilityRole="button" accessibilityLabel={label} onPress={() => navigation.navigate(route)} style={({ pressed }) => [styles.row, pressed && sharedStyles.pressed]}><View style={styles.grow}><Text style={styles.title}>{label}</Text><Text style={styles.hint}>{hint}</Text></View><Text style={styles.arrow}>›</Text></Pressable>)}
    <Text style={sharedStyles.eyebrow}>仅在 Web 完成的高级操作</Text>
    {webEntries.map(([label, path, hint]) => <Pressable key={label} accessibilityRole="button" accessibilityLabel={label} onPress={() => void openWeb(path)} style={({ pressed }) => [styles.row, pressed && sharedStyles.pressed]}><View style={styles.grow}><Text style={styles.title}>{label}</Text><Text style={styles.hint}>{hint}</Text></View><Text style={styles.arrow}>›</Text></Pressable>)}
    <Pressable accessibilityRole="button" accessibilityLabel="设置" onPress={() => navigation.navigate("Settings")} style={({ pressed }) => [styles.row, pressed && sharedStyles.pressed]}><View style={styles.grow}><Text style={styles.title}>设置</Text><Text style={styles.hint}>服务器、同步与本机数据</Text></View><Text style={styles.arrow}>›</Text></Pressable>
    <View style={sharedStyles.notice}><Text style={sharedStyles.noticeText}>家人、故事、胶囊、口述史、投递箱和导入会话均以原生页面为日常主路径。只有恢复、远程备份、精细成书排版、账号安全和复杂审计继续使用 Web。</Text></View>
  </ScrollView>;
}

const styles = StyleSheet.create({
  row: { minHeight: 68, flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.card, borderColor: colors.line, borderWidth: 1, borderRadius: 15, paddingHorizontal: 15, paddingVertical: 10 },
  grow: { flex: 1, gap: 3 },
  title: { color: colors.ink, fontSize: 16, fontWeight: "800" },
  hint: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  arrow: { color: colors.coral, fontSize: 28 },
});
