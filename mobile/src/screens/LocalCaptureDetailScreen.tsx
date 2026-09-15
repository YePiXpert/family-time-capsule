import { MemoryReading } from "../components/MemoryReading";
import { Disclosure } from "../components/Disclosure";
import { dateLabel } from "../utils/format";
import { Text } from "../components/typography";
import { useCallback, useMemo, useRef, useState } from "react";
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
import { useAppData, useAppActions } from "../state/AppContext";
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
  const { credentials, outbox, userId, family } = useAppData();
  const { runSync } = useAppActions();
  const sourceScope = credentials?.instanceId && userId && family?.id
    ? JSON.stringify([credentials.serverUrl, credentials.instanceId, userId, family.id]) : null;
  const connection = JSON.stringify([credentials?.serverUrl ?? null, credentials?.token ?? null]);
  const [readerIdentity, setReaderIdentity] = useState({ connection, scope: sourceScope, epoch: 0 });
  let readerEpoch = readerIdentity.epoch;
  if (readerIdentity.connection !== connection || readerIdentity.scope !== sourceScope) {
    // Restored credentials resolve their identity later on weak networks. That first
    // resolution may add a remote receipt without closing an owned local original.
    // Every actual connection change or loss/change of a known identity closes it.
    if (readerIdentity.connection !== connection || readerIdentity.scope !== null) readerEpoch++;
    setReaderIdentity({ connection, scope: sourceScope, epoch: readerEpoch });
  }
  const confirm = useConfirmSheet();
  const alert = useAlertSheet();
  const [detail, setDetail] = useState<LocalCaptureDetail | null>(null);
  const [loadedScope, setLoadedScope] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const requestRevision = useRef(0);

  const load = useCallback(async () => {
    const request = ++requestRevision.current;
    setLoading(true);
    try {
      const next = await getLocalCaptureDetail(captureId, sourceScope);
      if (request !== requestRevision.current) return;
      setDetail(next);
      setLoadedScope(sourceScope);
    } finally {
      if (request === requestRevision.current) setLoading(false);
    }
  }, [captureId, sourceScope]);

  useFocusEffect(useCallback(() => { void load(); return () => { requestRevision.current++; }; }, [load]));

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
          remoteAssetId: loadedScope === sourceScope ? detail.remoteAssetId : undefined,
        }
      : null;

  return (
    <ScrollView contentContainerStyle={s.content} style={s.screen}>
      <MemoryReading title={detail.title} body={detail.kind === "text_capture" ? detail.text : null}
        date={dateLabel(detail.occurredAt, family?.timezone)}
        status={detail.kind === "media_capture" && !fileExists ? "原件暂时无法读取" : `已保存在本机 · ${SYNC_STATE_LABELS[detail.syncState]}`}
        media={fileExists && asset && detail.mediaType !== "document" ? <NativeMediaReader key={JSON.stringify([captureId, readerEpoch])} assets={[asset]} credentials={asset.remoteAssetId ? credentials : null} /> : null} />
      {outboxItem && outboxItem.attemptCount > 0 ? (
        <View style={s.warning}>
          <Text style={s.warningText}>上传未成功：{outboxItem.lastError}（已尝试 {outboxItem.attemptCount} 次）。原件始终保留在本机。</Text>
          {credentials ? <Pressable onPress={() => void runSync()} style={styles.retry}><Text style={styles.retryText}>重试上传</Text></Pressable> : null}
        </View>
      ) : null}

      {detail.kind === "text_capture" && detail.text === null ? <View style={s.notice}>
        <Text style={s.noticeText}>这份文字已送达家庭收件箱；全文在收件箱中查看与整理。</Text>
      </View> : null}
      {detail.kind === "media_capture" && !fileExists ? <View style={s.warning}>
        <Text style={s.warningText}>本机原件文件已不存在。可以重新导入原件，或展开下方操作移除这条记录。</Text>
      </View> : null}
      {fileExists && detail.mediaType === "document" ? <Text style={s.body}>可以展开下方操作，导出文档后阅读。</Text> : null}
      <Disclosure title="原件与本机记录">
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
          accessibilityRole="button"
          style={s.secondaryButton}
        >
          <Text style={s.secondaryText}>导出这份原件</Text>
        </Pressable>
      ) : null}
      <Pressable accessibilityRole="button" onPress={removeRecord} style={styles.remove}>
        <Text style={styles.removeText}>从本机时间轴移除此记录</Text>
      </Pressable>
      </Disclosure>
    </ScrollView>
  );
}

function createStyles(palette: JournalPalette) {
  return StyleSheet.create({
  retry: { minHeight: 44, justifyContent: "center" },
  retryText: { color: palette.coralDark, fontSize: 13, fontWeight: "800" },
  remove: { minHeight: 48, alignItems: "center", justifyContent: "center" },
  removeText: { color: palette.error, fontSize: 14, fontWeight: "800" },
  });
}
