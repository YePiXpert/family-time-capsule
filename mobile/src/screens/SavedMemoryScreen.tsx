import { useCallback, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import { MemoryReading } from "../components/MemoryReading";
import { Text } from "../components/typography";
import { Button } from "../components/ui";
import { randomUUID } from "expo-crypto";
import { listLocalDrafts, saveLocalDraft, type LocalDraft } from "../drafts/store";
import { draftReadingScope, savedDraftContent } from "../drafts/reading";
import { NativeMediaReader, type NativeReaderAsset } from "../media/NativeMediaReader";
import type { RootStackParamList } from "../navigation/types";
import { useAppData, useAppActions, useSyncStatus } from "../state/AppContext";
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
  const { credentials, family, viewer, people, syncConsent } = useAppData();
  const { syncing } = useSyncStatus();
  const { queued, reloadLocal } = useAppActions();
  const [marking, setMarking] = useState(false);
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

  const markFirst = async () => {
    if (!scope || scope !== route.params.scope || marking || syncing) return;
    setMarking(true);
    try {
      const live = (await listLocalDrafts(scope)).find(draft => draft.id === route.params.draftId);
      const saved = live && savedDraftContent(live);
      if (!live || !saved) throw new Error("记录已变化，请重新打开后标记。");
      const milestoneType = saved.milestoneType === "first_time" ? null : "first_time" as const;
      await saveLocalDraft({ ...live, mutationId: randomUUID(), revision: live.revision + 1, updatedAt: new Date().toISOString(),
        content: { ...live.content, milestoneType }, ...(live.savedContent ? { savedContent: { ...live.savedContent, milestoneType } } : {}) }, live.revision);
      await load(); await reloadLocal(); void queued().catch(reason => setError(reason instanceof Error ? reason.message : "标记已保存在本机。"));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "标记没有保存，请重试。"); }
    finally { setMarking(false); }
  };

  if (!scope || scope !== route.params.scope) return <View style={s.empty}><Text style={s.emptyTitle}>请回到保存这条记录的家庭</Text><Text style={s.emptyText}>当前账号的记录可以在成长页查看。</Text></View>;
  if (loading && !record) return <View style={s.empty}><ActivityIndicator color={s.colors.coral} /></View>;
  if (record?.draft.status === "published" && record.draft.memoryEventId) return <MemoryScreen navigation={navigation as unknown as NativeStackScreenProps<RootStackParamList, "Memory">["navigation"]} route={{ key: route.key, name: "Memory", params: { id: record.draft.memoryEventId } }} />;
  const content = record && savedDraftContent(record.draft);
  const acknowledged = record?.draft.syncedRevision === record?.draft.revision;
  const coverItem = content?.items.find(item => item.id === content.coverItemId);
  const previewIndex = Math.max(0, record?.assets.findIndex(asset => asset.id === (coverItem?.localCaptureRef ?? coverItem?.assetId)) ?? 0);
  const authorized = credentials && syncConsent && syncConsent.serverUrl === credentials.serverUrl && syncConsent.instanceId === credentials.instanceId && syncConsent.familyId === family?.id && syncConsent.userId === viewer?.id && (syncConsent.scope === "all" || syncConsent.ids.includes(record?.draft.id ?? ""));
  const status = acknowledged ? record?.draft.syncIntent === "review" ? "已提交，等待家人确认" : "已保存到家庭" : record?.draft.savedContent ? "已保存在本机 · 有未完成的补记" : authorized ? "已保存在本机 · 等待同步" : "已保存在本机";
  return <ScrollView contentContainerStyle={s.content} style={s.screen}>
    {record && content ? <>
      <MemoryReading title={content.title || content.text.trim().slice(0, 60) || "一段成长记录"}
        body={content.text}
        date={dateLabel(content.occurredAt ?? record.draft.updatedAt, family?.timezone, content.occurredAt ? content.occurredAtPrecision : "unknown")}
        visibility={content.visibility === "private" ? "仅自己可见" : content.visibility === "members" ? "同步后 · 指定成员可见" : "同步后 · 全家可见"}
        status={status}
        media={record.assets.length ? <NativeMediaReader credentials={credentials} assets={record.assets} previewIndex={previewIndex} /> : null}>
        {content.locationText ? <Text style={s.intro}>{content.locationText}</Text> : null}
        {content.participantIds.length ? <Text style={s.body}>{content.participantIds.map(id => people?.find(person => person.id === id)?.displayName ?? "家人").join(" · ")}</Text> : null}
      </MemoryReading>
      {record.missing ? <View style={s.warning}><Text style={s.warningText}>{record.missing} 份素材暂时无法读取，已有文字和其他素材仍可查看。请重试或补记时重新添加。</Text><Button title="重新读取素材" onPress={() => void load()} /></View> : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {!credentials || viewer?.canCapture ? <Button full={false} testID="record-edit" title={record.draft.savedContent && !acknowledged ? "继续编辑" : "编辑"} disabled={syncing} onPress={() => navigation.navigate("Capture", { scope, target: { kind: "local", draftId: record.draft.id, editSaved: true } })} /> : null}
      {!credentials || viewer?.canCapture ? <Pressable testID="record-first" accessibilityRole="button" accessibilityLabel="第一次" accessibilityState={{ selected: content.milestoneType === "first_time", disabled: syncing || marking }} disabled={syncing || marking} onPress={() => void markFirst()} style={content.milestoneType === "first_time" ? s.primaryButton : s.secondaryButton}><Text style={content.milestoneType === "first_time" ? s.primaryText : s.secondaryText}>第一次</Text></Pressable> : null}
      <Button full={false} title="加入相册" variant="secondary" onPress={() => navigation.navigate("Collections", { scope, refs: [{ kind: "localDraft", scope, id: record.draft.id }] })} />
      </View>
    </> : null}
    {error ? <View style={s.warning}><Text accessibilityRole="alert" style={s.error}>{error}</Text><Button title="重试" onPress={() => void load()} /></View> : null}
  </ScrollView>;
}
