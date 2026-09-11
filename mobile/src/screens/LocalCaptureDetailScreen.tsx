import { Text } from "../components/typography";
import { useCallback, useMemo, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { exportOriginalCopy } from "../media/export-original";
import { NativeMediaReader, type NativeReaderAsset } from "../media/NativeMediaReader";
import { useAlertSheet, useConfirmSheet } from "../components/GlassSheet";
import {
  getLocalCaptureDetail,
  removeLocalCaptureRecord,
  type LocalCaptureDetail,
} from "../storage/database";
import { localFileExists } from "../storage/files";
import { useApp } from "../state/AppContext";
import { useSharedStyles } from "../theme";
import type { JournalPalette } from "../design/tokens";

/**
 * 本机记录详情（M3）：不联网、未上传、待整理都能直接打开本机内容。
 * - 图片/视频/音频复用 NativeMediaReader 的全屏阅读；
 * - 文字全文阅读；文档提供导出与说明；
 * - 文件缺失时如实报错并提供移除残留记录的恢复入口，不显示“已安全保存”；
 * - 标注来源边界与本机/同步/整理状态，三条状态互不冒充。
 */

const SYNC_STATE_LABELS: Record<LocalCaptureDetail["syncState"], string> = {
  pending: "等待上传",
  inbox: "已送达收件箱",
  archived: "已入档",
};

export function LocalCaptureDetailScreen({ route }: { route: { params: { captureId: string } } }) {
  const s = useSharedStyles();
  const styles = useMemo(() => createStyles(s.colors), [s.colors]);
  const captureId = route.params.captureId.replace(/^local:/u, "");
  const { credentials, outbox, runSync } = useApp();
  const confirm = useConfirmSheet();
  const alert = useAlertSheet();
  const [detail, setDetail] = useState<LocalCaptureDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setDetail(await getLocalCaptureDetail(captureId));
    } finally {
      setLoading(false);
    }
  }, [captureId]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const outboxItem = outbox.find((item) => item.id === captureId) ?? null;
  const fileExists = detail?.localUri ? localFileExists(detail.localUri) : null;

  const removeRecord = () => {
    void confirm({
      title: "移除这条本机记录？",
      message: fileExists
        ? "该操作只移除记录条目，不会删除本机原件文件。"
        : "本机原件文件已不存在；此操作只清除残留的记录条目。",
      confirmLabel: "确认移除",
      destructive: true,
    }).then(confirmed => {
      if (!confirmed) return;
      void removeLocalCaptureRecord(captureId).then(() => load()).catch(error => void alert({ title: "尚未移除", message: error instanceof Error ? error.message : "请重试。" }));
    });
  };

  if (loading && !detail) {
    return <View style={s.empty}><ActivityIndicator color={s.colors.coral} size="large" /></View>;
  }
  if (!detail) {
    return (
      <View style={s.empty}>
        <Text style={s.emptyTitle}>找不到这条本机记录</Text>
        <Text style={s.emptyText}>它可能已被整理入档。已入档的内容请打开对应的记忆查看。</Text>
      </View>
    );
  }

  const asset: NativeReaderAsset | null =
    detail.kind === "media_capture" && detail.localUri && fileExists
      ? {
          id: detail.captureId,
          type: detail.mediaType ?? "document",
          filename: detail.fileName ?? detail.title,
          mimeType: detail.mimeType ?? "application/octet-stream",
          localUri: detail.localUri,
        }
      : null;

  return (
    <ScrollView contentContainerStyle={s.content} style={s.screen}>
      <Text style={s.eyebrow}>本机记录</Text>
      <Text style={s.title}>{detail.title}</Text>
      <View style={styles.statusRow}>
        <View style={styles.chip}><Text style={styles.chipText}>已保存本机</Text></View>
        <View style={[styles.chip, styles.chipSync]}><Text style={styles.chipText}>{SYNC_STATE_LABELS[detail.syncState]}</Text></View>
        {detail.syncState === "inbox" ? <View style={[styles.chip, styles.chipReview]}><Text style={styles.chipText}>收件箱待整理</Text></View> : null}
        {detail.syncState === "archived" && detail.memoryEventId ? <View style={[styles.chip, styles.chipReview]}><Text style={styles.chipText}>已整理入档</Text></View> : null}
      </View>
      {outboxItem && outboxItem.attemptCount > 0 ? (
        <View style={s.warning}>
          <Text style={s.warningText}>上传未成功：{outboxItem.lastError}（已尝试 {outboxItem.attemptCount} 次）。原件始终保留在本机。</Text>
          {credentials ? <Pressable onPress={() => void runSync()} style={styles.retry}><Text style={styles.retryText}>重试上传</Text></Pressable> : null}
        </View>
      ) : null}

      {detail.kind === "text_capture" ? (
        detail.text !== null ? (
          <View style={s.card}>
            <Text selectable style={styles.fullText}>{detail.text}</Text>
          </View>
        ) : (
          <View style={s.notice}>
            <Text style={s.noticeText}>这份文字已送达家庭收件箱；全文在收件箱中查看与整理。</Text>
          </View>
        )
      ) : fileExists && asset ? (
        detail.mediaType === "document" ? (
          <View style={s.card}>
            <Text style={s.cardTitle}>{detail.fileName ?? detail.title}</Text>
            <Text style={s.body}>本机文档可直接导出到其他 App 打开。</Text>
          </View>
        ) : (
          <NativeMediaReader assets={[asset]} credentials={null} />
        )
      ) : (
        <View style={s.warning}>
          <Text style={s.warningText}>本机原件文件已不存在（可能被系统清理或其他 App 删除）。记录条目仍保留，不会伪装成保存成功。</Text>
        </View>
      )}

      {detail.localUri && fileExists ? (
        <Pressable
          onPress={() =>
            void exportOriginalCopy(
              {
                id: detail.captureId,
                type: detail.mediaType ?? "document",
                filename: detail.fileName ?? detail.title,
                mimeType: detail.mimeType ?? "application/octet-stream",
                localUri: detail.localUri!,
              },
              credentials,
            ).catch((error: unknown) =>
              void alert({ title: "导出失败", message: error instanceof Error ? error.message : "请稍后重试。" }),
            )
          }
          style={s.secondaryButton}
        >
          <Text style={s.secondaryText}>导出这份原件</Text>
        </Pressable>
      ) : null}
      <Pressable onPress={removeRecord} style={styles.remove}>
        <Text style={styles.removeText}>从本机时间轴移除此记录</Text>
      </Pressable>
      <Text style={styles.note}>保存、同步与整理是三件独立的事：未上传或待整理都不影响在这里阅读本机内容。</Text>
    </ScrollView>
  );
}

function createStyles(palette: JournalPalette) {
  return StyleSheet.create({
  statusRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { backgroundColor: palette.softSage, borderRadius: 10, paddingHorizontal: 9, paddingVertical: 4 },
  chipSync: { backgroundColor: palette.softCoral },
  chipReview: { backgroundColor: palette.warningSoft },
  chipText: { color: palette.sage, fontSize: 12, fontWeight: "800" },
  fullText: { color: palette.ink, fontSize: 16, lineHeight: 26 },
  retry: { minHeight: 44, justifyContent: "center" },
  retryText: { color: palette.coralDark, fontSize: 13, fontWeight: "800" },
  remove: { minHeight: 48, alignItems: "center", justifyContent: "center" },
  removeText: { color: palette.error, fontSize: 14, fontWeight: "800" },
  note: { color: palette.muted, fontSize: 12, lineHeight: 18, textAlign: "center" },
  });
}
