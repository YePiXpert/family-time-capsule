import { useCallback, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { ActivityIndicator, ScrollView, View } from "react-native";
import { MemoryReading } from "../components/MemoryReading";
import { Text } from "../components/typography";
import { Button } from "../components/ui";
import { listLocalDrafts, type LocalDraft } from "../drafts/store";
import { draftReadingScope, savedDraftContent } from "../drafts/reading";
import { NativeMediaReader, type NativeReaderAsset } from "../media/NativeMediaReader";
import type { RootStackParamList } from "../navigation/types";
import { useAppData, useSyncStatus } from "../state/AppContext";
import { useServerPermissionRevision } from "../storage/cache-lifecycle";
import { getLocalCaptureDetail } from "../storage/database";
import { localFileExists } from "../storage/files";
import { requestMobileJson } from "../api/client";
import { useSharedStyles } from "../theme";
import { dateLabel } from "../utils/format";
import { MemoryScreen } from "./MemoryScreen";

type Props = NativeStackScreenProps<RootStackParamList, "SavedMemory">;

export function SavedMemoryScreen(props: Props) {
  const { credentials, userId, viewer, family } = useAppData();
  const scope = draftReadingScope(credentials, userId, viewer?.id, family?.id);
  const permissionRevision = useServerPermissionRevision();
  return <SavedMemoryDetail key={JSON.stringify([scope, props.route.params.draftId, permissionRevision])} {...props} scope={scope} />;
}

function SavedMemoryDetail({ route, navigation, scope }: Props & { scope: string | null }) {
  const s = useSharedStyles();
  const { credentials, family, viewer, people } = useAppData();
  const { syncing } = useSyncStatus();
  const [record, setRecord] = useState<{ draft: LocalDraft; assets: NativeReaderAsset[]; missing: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);
  const load = useCallback(async () => {
    const version = ++request.current;
    if (!scope || scope !== route.params.scope) { setLoading(false); return; }
    setLoading(true); setError(null);
    try {
      const draft = (await listLocalDrafts(scope)).find(item => item.id === route.params.draftId);
      if (!draft || (draft.status !== "published" && !savedDraftContent(draft))) throw new Error("找不到已保存的记录，可以返回成长页查看或继续未完成的草稿。");
      if (draft.status === "published") {
        if (!draft.memoryEventId) throw new Error("这条记录的同步结果尚未完整，请返回成长页下拉同步后重试。");
        if (version === request.current) setRecord({ draft, assets: [], missing: 0 });
        return;
      }
      const content = savedDraftContent(draft)!;
      const media = await Promise.all(content.items.map(async item => {
        if (item.localCaptureRef) {
          const original = await getLocalCaptureDetail(item.localCaptureRef, scope);
          if (!original?.localUri || !localFileExists(original.localUri)) return null;
          return { id: original.captureId, type: original.mediaType ?? "document", filename: item.caption || original.fileName || original.title,
            mimeType: original.mimeType ?? "application/octet-stream", localUri: original.localUri, remoteAssetId: original.remoteAssetId } as NativeReaderAsset;
        }
        if (!credentials || !item.assetId) return null;
        try { return await requestMobileJson(credentials, `/api/media/${encodeURIComponent(item.assetId)}/metadata`) as NativeReaderAsset; }
        catch { return null; }
      }));
      if (version === request.current) setRecord({ draft, assets: media.filter((item): item is NativeReaderAsset => item !== null), missing: media.filter(item => item === null).length });
    } catch (reason) {
      if (version === request.current) { setRecord(null); setError(reason instanceof Error ? reason.message : "暂时无法读取这段回忆。"); }
    } finally { if (version === request.current) setLoading(false); }
  }, [scope, route.params.scope, route.params.draftId, credentials]);
  useFocusEffect(useCallback(() => { void load(); return () => { request.current++; }; }, [load]));

  if (!scope || scope !== route.params.scope) return <View style={s.empty}><Text style={s.emptyTitle}>请回到保存这条记录的家庭</Text><Text style={s.emptyText}>当前账号的记录可以在成长页查看。</Text></View>;
  if (loading && !record) return <View style={s.empty}><ActivityIndicator color={s.colors.coral} /></View>;
  if (record?.draft.status === "published" && record.draft.memoryEventId) return <MemoryScreen navigation={navigation as unknown as NativeStackScreenProps<RootStackParamList, "Memory">["navigation"]} route={{ key: route.key, name: "Memory", params: { id: record.draft.memoryEventId } }} />;
  const content = record && savedDraftContent(record.draft);
  const acknowledged = record?.draft.syncedRevision === record?.draft.revision;
  const status = acknowledged ? record?.draft.syncIntent === "review" ? "已提交，等待家人确认" : "已保存到家庭" : record?.draft.savedContent ? "已保存在本机 · 有未完成的补记" : "已保存在本机 · 等待同步";
  return <ScrollView contentContainerStyle={s.content} style={s.screen}>
    {record && content ? <>
      <MemoryReading title={content.title || content.text.trim().slice(0, 60) || "一段成长记录"}
        body={content.text}
        date={dateLabel(content.occurredAt ?? record.draft.updatedAt, family?.timezone, content.occurredAt ? content.occurredAtPrecision : "unknown")}
        visibility={content.visibility === "private" ? "仅自己可见" : content.visibility === "members" ? "指定成员可见" : "全家可见"}
        status={status}
        media={record.assets.length ? <NativeMediaReader credentials={credentials} assets={record.assets} /> : null}>
        {content.locationText ? <Text style={s.intro}>{content.locationText}</Text> : null}
        {content.participantIds.length ? <Text style={s.body}>{content.participantIds.map(id => people?.find(person => person.id === id)?.displayName ?? "家人").join(" · ")}</Text> : null}
      </MemoryReading>
      {record.missing ? <View style={s.warning}><Text style={s.warningText}>{record.missing} 份素材暂时无法读取，已有文字和其他素材仍可查看。请重试或补记时重新添加。</Text><Button title="重新读取素材" onPress={() => void load()} /></View> : null}
      {!credentials || viewer?.canCapture ? <Button title={record.draft.savedContent && !acknowledged ? "继续补记" : "补记"} disabled={syncing} onPress={() => navigation.popTo("MainTabs", { screen: "Capture", params: { localDraftId: record.draft.id, editSaved: true } })} /> : null}
    </> : null}
    {error ? <View style={s.warning}><Text accessibilityRole="alert" style={s.error}>{error}</Text><Button title="重试" onPress={() => void load()} /></View> : null}
  </ScrollView>;
}
