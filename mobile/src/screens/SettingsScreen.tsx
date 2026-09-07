import { useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { useApp } from "../state/AppContext";
import { ServerConnectionForm } from "../components/ServerConnectionForm";
import { exportRescuePackage, restoreRescuePackage } from "../rescue/device";
import { colors, sharedStyles } from "../theme";
import type { MediaCapturePayload, OutboxItem } from "../types";
import { dateLabel } from "../utils/format";
import { AiSettingsSection } from "../ai/AiSettingsSection";

export function SettingsScreen() {
  const {
    credentials, family, viewer, online, syncing, outbox, lastSyncAt,
    connect, disconnect, clearLocal, runSync, reloadLocal, dismissMessage,
    keepOutboxItemLocal, deleteOutboxCapture, syncConsent,
  } = useApp();
  const [rescueBusy, setRescueBusy] = useState(false);
  const failed = outbox.filter((item) => item.attemptCount > 0);

  const exportRescue = async () => {
    setRescueBusy(true);
    try {
      const summary = await exportRescuePackage();
      Alert.alert("救援包已生成", summary);
    } catch (error) {
      Alert.alert("导出未完成", error instanceof Error ? error.message : "请稍后重试。");
    } finally {
      setRescueBusy(false);
    }
  };

  const importRescue = async () => {
    const picked = await DocumentPicker.getDocumentAsync({
      type: "application/zip",
      copyToCacheDirectory: true,
    });
    if (picked.canceled || picked.assets.length === 0) return;
    const uri = picked.assets[0]!.uri;
    setRescueBusy(true);
    try {
      const result = await restoreRescuePackage(uri);
      await reloadLocal();
      dismissMessage();
      Alert.alert(
        "恢复完成",
        `导入 ${result.imported} 条，跳过已存在 ${result.skipped} 条` +
          (result.missingFiles > 0 ? `，${result.missingFiles} 条缺少文件未写入` : "") +
          "。恢复的记录默认仅保存在本机，不会自动上传。",
      );
    } catch (error) {
      Alert.alert("恢复未执行", error instanceof Error ? error.message : "请稍后重试。");
    } finally {
      setRescueBusy(false);
    }
  };

  const confirmKeepLocal = (item: OutboxItem) => {
    Alert.alert(
      "改为仅保留本机？",
      "这条记录不再等待上传；记录和原件都保留在本机。",
      [
        { text: "取消", style: "cancel" },
        { text: "仅保留本机", onPress: () => void keepOutboxItemLocal(item.id) },
      ],
    );
  };

  const confirmDelete = (item: OutboxItem) => {
    Alert.alert(
      "删除这条本机记录？",
      item.kind === "media_capture"
        ? "记录和本机原件文件都会被永久删除，不可恢复。服务器资料不受影响。"
        : "这条文字记录会被永久删除，不可恢复。",
      [
        { text: "取消", style: "cancel" },
        {
          text: "永久删除",
          style: "destructive",
          onPress: () => void deleteOutboxCapture(item),
        },
      ],
    );
  };

  return <ScrollView contentContainerStyle={sharedStyles.content} style={sharedStyles.screen}>
    <Text style={sharedStyles.eyebrow}>设备与同步</Text><Text style={sharedStyles.title}>{family?.name ?? "家庭时间胶囊"}</Text>
    <View style={sharedStyles.card}>
      <Row label="模式" value={credentials ? "本机 + 自托管同步" : "仅本机"} />
      {credentials ? <><Row label="账号" value={viewer?.name ?? "等待同步"} /><Row label="服务器" value={credentials.serverUrl} /></> : null}
      <Row label="上传授权" value={!credentials ? "未启用" : syncConsent === null ? "未授权（不上传）" : syncConsent.scope === "all" ? "已同意全部" : syncConsent.scope === "selected" ? `仅所选 ${syncConsent.ids.length} 条` : "仅保留本机"} />
      <Row label="网络" value={!credentials ? "未启用" : online === false ? "离线" : "在线"} />
      <Row label="等待补传" value={`${outbox.length} 条`} />
      <Row label="上次同步" value={lastSyncAt ? dateLabel(lastSyncAt) : "尚未完成"} />
    </View>
    <View style={sharedStyles.notice}><Text style={sharedStyles.noticeText}>时间轴与成员存于本机 SQLite；待上传原件与离线封面位于 App 私有目录；断开服务器不会删除它们。取消上传、暂停或仅保留本机都不会删除原件。</Text></View>
    {credentials ? <>
      <Pressable disabled={syncing} onPress={() => void runSync()} style={sharedStyles.secondaryButton}><Text style={sharedStyles.secondaryText}>{syncing ? "同步中…" : "立即同步"}</Text></Pressable>
      <Pressable onPress={() => Alert.alert("断开家庭服务器？", "本机记录和已下载资料都会保留。", [{ text: "取消", style: "cancel" }, { text: "确认断开", onPress: () => void disconnect() }])} style={styles.textButton}><Text style={styles.danger}>断开家庭服务器</Text></Pressable>
    </> : <ServerConnectionForm onLogin={connect} />}

    {failed.length > 0 ? (
      <View style={sharedStyles.warning}>
        <Text style={styles.warningTitle}>{failed.length} 条补传失败</Text>
        {failed.map((item) => (
          <View key={item.id} style={styles.failedItem}>
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={styles.item}>
                {item.kind === "media_capture" ? (item.payload as MediaCapturePayload).fileName : (item.payload as { text: string }).text}
              </Text>
              <Text style={sharedStyles.warningText}>{item.lastError} · 已尝试 {item.attemptCount} 次</Text>
            </View>
            <Pressable onPress={() => confirmKeepLocal(item)} style={styles.smallAction}><Text style={styles.smallActionText}>保留本机</Text></Pressable>
            <Pressable onPress={() => confirmDelete(item)} style={styles.smallActionDanger}><Text style={styles.smallActionText}>删除</Text></Pressable>
          </View>
        ))}
        <Text style={styles.failedNote}>“保留本机”只停止等待上传，不删除原件；“删除”才是不可恢复的操作。</Text>
      </View>
    ) : null}

    <AiSettingsSection />
    <Text style={sharedStyles.eyebrow}>本机救援包</Text>
    <View style={sharedStyles.card}>
      <Text style={sharedStyles.body}>把尚未同步的本机记录（文字全文、原件与校验清单）导出为一个 ZIP，通过系统分享保存到 App 之外。它只包含你自己的本机资料，不含任何登录凭据，也不是完整家庭备份。</Text>
      <Pressable disabled={rescueBusy} onPress={() => void exportRescue()} style={sharedStyles.secondaryButton}><Text style={sharedStyles.secondaryText}>导出本机救援包</Text></Pressable>
      <Pressable disabled={rescueBusy} onPress={() => void importRescue()} style={sharedStyles.secondaryButton}><Text style={sharedStyles.secondaryText}>从救援包恢复</Text></Pressable>
    </View>

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
  failedItem: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 },
  smallAction: { borderColor: colors.sage, borderRadius: 10, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 8, minHeight: 48, justifyContent: "center" },
  smallActionDanger: { borderColor: "#D9AAA1", borderRadius: 10, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 8, minHeight: 48, justifyContent: "center" },
  smallActionText: { color: colors.coralDark, fontSize: 12, fontWeight: "800" },
  failedNote: { color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 8 },
  clear: { minHeight: 48, alignItems: "center", justifyContent: "center", borderColor: "#D9AAA1", borderRadius: 13, borderWidth: 1, marginTop: 8 },
});
