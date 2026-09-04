import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useApp } from "../state/AppContext";
import { ServerConnectionForm } from "../components/ServerConnectionForm";
import { colors, sharedStyles } from "../theme";
import type { MediaCapturePayload } from "../types";
import { dateLabel } from "../utils/format";

export function SettingsScreen() {
  const { credentials, family, viewer, online, syncing, outbox, lastSyncAt, connect, disconnect, clearLocal, discardFailed, runSync } = useApp();
  const failed = outbox.filter((item) => item.attemptCount > 0);
  return <ScrollView contentContainerStyle={sharedStyles.content} style={sharedStyles.screen}>
    <Text style={sharedStyles.eyebrow}>设备与同步</Text><Text style={sharedStyles.title}>{family?.name ?? "家庭时间胶囊"}</Text>
    <View style={sharedStyles.card}>
      <Row label="模式" value={credentials ? "本机 + 自托管同步" : "仅本机"} />
      {credentials ? <><Row label="账号" value={viewer?.name ?? "等待同步"} /><Row label="服务器" value={credentials.serverUrl} /></> : null}
      <Row label="网络" value={!credentials ? "未启用" : online === false ? "离线" : "在线"} />
      <Row label="等待补传" value={`${outbox.length} 条`} />
      <Row label="上次同步" value={lastSyncAt ? dateLabel(lastSyncAt) : "尚未完成"} />
    </View>
    <View style={sharedStyles.notice}><Text style={sharedStyles.noticeText}>时间轴与成员存于本机 SQLite；待上传原件与离线封面位于 App 私有目录；断开服务器不会删除它们。</Text></View>
    {credentials ? <>
      <Pressable disabled={syncing} onPress={() => void runSync()} style={sharedStyles.secondaryButton}><Text style={sharedStyles.secondaryText}>{syncing ? "同步中…" : "立即同步"}</Text></Pressable>
      <Pressable onPress={() => Alert.alert("断开家庭服务器？", "本机记录和已下载资料都会保留。", [{ text: "取消", style: "cancel" }, { text: "确认断开", onPress: () => void disconnect() }])} style={styles.textButton}><Text style={styles.danger}>断开家庭服务器</Text></Pressable>
    </> : <ServerConnectionForm onLogin={connect} />}
    {failed.length > 0 ? <View style={sharedStyles.warning}><Text style={styles.warningTitle}>{failed.length} 条补传失败</Text>{failed.slice(0, 5).map((item) => <View key={item.id}><Text numberOfLines={1} style={styles.item}>{item.kind === "media_capture" ? (item.payload as MediaCapturePayload).fileName : (item.payload as { text: string }).text}</Text><Text style={sharedStyles.warningText}>{item.lastError} · 已尝试 {item.attemptCount} 次</Text></View>)}<Pressable onPress={() => Alert.alert("放弃失败待办？", "尚未上传的本机内容会被永久删除。", [{ text: "取消", style: "cancel" }, { text: "确认放弃", style: "destructive", onPress: () => void discardFailed() }])} style={styles.textButton}><Text style={styles.danger}>放弃这些失败待办</Text></Pressable></View> : null}
    <Pressable onPress={() => Alert.alert("清除本机全部数据？", "本机记录、原件、离线缓存与登录凭据都会永久删除；服务器资料不受影响。", [{ text: "取消", style: "cancel" }, { text: "确认清除", style: "destructive", onPress: () => void clearLocal() }])} style={styles.clear}><Text style={styles.danger}>清除本机全部数据</Text></Pressable>
  </ScrollView>;
}

function Row({ label, value }: { label: string; value: string }) {
  return <View style={styles.row}><Text style={styles.label}>{label}</Text><Text numberOfLines={2} style={styles.value}>{value}</Text></View>;
}

const styles = StyleSheet.create({
  row: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16, borderBottomColor: colors.line, borderBottomWidth: StyleSheet.hairlineWidth },
  label: { color: colors.muted, fontSize: 13 },
  value: { flex: 1, color: colors.ink, fontSize: 13, fontWeight: "700", textAlign: "right" },
  textButton: { minHeight: 48, alignItems: "center", justifyContent: "center" },
  danger: { color: colors.error, fontSize: 14, fontWeight: "800" },
  warningTitle: { color: colors.warning, fontSize: 16, fontWeight: "800" },
  item: { color: colors.ink, fontSize: 13, fontWeight: "700", marginTop: 8 },
  clear: { minHeight: 48, alignItems: "center", justifyContent: "center", borderColor: "#D9AAA1", borderRadius: 13, borderWidth: 1, marginTop: 8 },
});
