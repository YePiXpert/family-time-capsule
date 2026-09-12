import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Modal, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ApiError, requestMobileJson } from "../api/client";
import type { LibraryDetail } from "../assets/types";
import { ImportPhotoPicker } from "../components/ImportPhotoPicker";
import { Text } from "../components/typography";
import { Button } from "../components/ui";
import { NativeMediaReader } from "../media/NativeMediaReader";
import { memoryEditScope } from "../memories/edit-model";
import { NativeLibraryActions } from "../screens/AssetLibraryScreen";
import { useAppData } from "../state/AppContext";
import { useSharedStyles } from "../theme";
import { createPhotoSelection, reconcilePhotoSelection, type ImportPhotoSelection, type ImportPickItem } from "./photo-selection";
import { loadPhotoSelection, savePhotoSelection } from "./photo-selection-store";

export function RemoteImportPicker({ sessionId, title, onClose }: { sessionId: string; title: string; onClose: () => void }) {
  const { credentials, viewer, family } = useAppData();
  const scope = memoryEditScope(credentials, viewer?.id, family?.id);
  return <Modal visible animationType="none" onRequestClose={onClose}>
    <Picker key={JSON.stringify([scope, credentials?.token, sessionId])} scope={scope} sessionId={sessionId} title={title} onClose={onClose} />
  </Modal>;
}

function Picker({ scope, sessionId, title, onClose }: { scope: string | null; sessionId: string; title: string; onClose: () => void }) {
  const s = useSharedStyles();
  const { credentials, viewer, online } = useAppData();
  const [items, setItems] = useState<ImportPickItem[]>([]);
  const [selection, setSelection] = useState<ImportPhotoSelection | null>(null);
  const [preview, setPreview] = useState<ImportPickItem | null>(null);
  const [finishedRequest, setFinishedRequest] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [pending, setPending] = useState(0);
  const [retry, setRetry] = useState(0);
  const revision = useRef(0);
  const changeVersion = useRef(0);
  const writes = useRef<Promise<unknown>>(Promise.resolve());
  const active = useRef(true);
  const storageId = `remote:${sessionId}`;
  const requestKey = JSON.stringify([scope, sessionId, online, retry]);
  const loading = finishedRequest !== requestKey;
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    void (async () => {
      if (!scope || !credentials) throw new Error("请先连接并核对当前家庭，再挑选服务器资料。");
      if (online === false) throw new Error("这批服务器原件需要联网读取。本机导入可以离线挑选。");
      const batch = await requestMobileJson(credentials, `/api/imports/${encodeURIComponent(sessionId)}`, { signal: controller.signal }) as {
        items?: { assetId?: unknown; status?: unknown }[];
      };
      if (!Array.isArray(batch.items) || batch.items.length > 5000) throw new Error("无法读取这批导入的原件清单。");
      const ids = [...new Set(batch.items.filter(item => item.status === "completed" && typeof item.assetId === "string" && /^[\w-]{1,128}$/u.test(item.assetId)).map(item => item.assetId as string))];
      const loaded: (ImportPickItem | null)[] = Array.from({ length: ids.length }, () => null);
      let cursor = 0, unavailable = 0;
      await Promise.all(Array.from({ length: Math.min(4, ids.length) }, async () => {
        while (cursor < ids.length && !controller.signal.aborted) {
          const index = cursor++, id = ids[index]!;
          try {
            const asset = await requestMobileJson(credentials, `/api/mobile/v1/assets/${encodeURIComponent(id)}`, { signal: controller.signal }) as LibraryDetail;
            if (asset.id !== id || !["image", "video", "audio", "document"].includes(asset.type) || typeof asset.title !== "string") throw new Error("原件信息不完整，请重新读取。");
            loaded[index] = { id, title: asset.title, type: asset.type, mimeType: asset.mimeType,
              capturedAt: asset.capturedAt && Number.isFinite(Date.parse(asset.capturedAt)) ? asset.capturedAt : null,
              thumbnailUri: asset.previewId ? `${credentials.serverUrl}/api/media/${encodeURIComponent(asset.previewId)}` : null };
          } catch (reason) {
            if (reason instanceof ApiError && [403, 404].includes(reason.status)) { unavailable++; continue; }
            throw reason;
          }
        }
      }));
      const available = loaded.filter((item): item is ImportPickItem => item !== null);
      const saved = await loadPhotoSelection(scope, storageId);
      if (!current) return;
      const next = saved ? reconcilePhotoSelection(saved, available) : createPhotoSelection(available);
      revision.current = saved?.revision ?? 0;
      setItems(available); setSelection(next);
      setError("");
      setWarning(unavailable ? `${unavailable} 份原件已不可见，其余资料仍可挑选。` : "");
    })().catch(reason => {
      if (current) { setSelection(null); setError(reason instanceof Error ? reason.message : "暂时无法读取导入资料。"); }
      controller.abort();
    }).finally(() => { if (current) setFinishedRequest(requestKey); });
    return () => { current = false; controller.abort(); };
  }, [credentials, online, scope, sessionId, storageId, requestKey]);

  const change = (next: ImportPhotoSelection) => {
    if (!scope) return;
    const version = ++changeVersion.current;
    setSelection(next); setPending(value => value + 1); setError("");
    writes.current = writes.current.catch(() => {}).then(async () => {
      const saved = await savePhotoSelection(scope, storageId, { ...next, revision: revision.current }, revision.current);
      revision.current = saved.revision;
      if (active.current && version === changeVersion.current) setSelection(saved);
    }).catch(reason => { if (active.current) setError(reason instanceof Error ? reason.message : "挑选尚未保存，请重试。"); })
      .finally(() => { if (active.current) setPending(value => value - 1); });
  };
  const header = <View style={{ gap: 12 }}>
    <Button title="返回导入详情" onPress={onClose} />
    <Text style={s.title}>{title}</Text>
    <Text style={s.body}>分组、代表图和勾选保存在这台设备。加入相册后仍按原件的读者权限显示。</Text>
    {warning ? <Text style={s.body}>{warning}</Text> : null}
    {error && !loading ? <Text accessibilityRole="alert" style={s.error}>{error}</Text> : null}
  </View>;
  const footer = selection ? <View style={{ gap: 12 }}>
    <Text style={s.body}>{pending ? "正在保存挑选…" : error ? "本机挑选尚未保存" : "挑选保留在本机 · 原件全部保留"}</Text>
    {error ? <Button title="重试保存挑选" onPress={() => change(selection)} disabled={pending > 0} /> : null}
    {!items.length ? <Text style={s.body}>这批导入还没有可挑选的已完成原件。稍后完成上传再打开。</Text> : null}
    {selection.selectedIds.length > 200 ? <Text style={s.body}>每次最多加入 200 份，可分次挑选。</Text> : !pending && !error && online !== false && viewer && selection.selectedIds.length > 0
      ? <NativeLibraryActions ids={selection.selectedIds} canWrite={viewer.canEditEvents} coverAssetId={selection.coverId} onNavigate={onClose} /> : null}
  </View> : null;
  return <SafeAreaView style={[s.screen, { flex: 1 }]}>
    {loading || !selection ? <View style={s.content}>{header}{loading ? <ActivityIndicator color={s.colors.coral} /> : <Button title="重新读取导入资料" onPress={() => setRetry(value => value + 1)} />}</View>
      : <ImportPhotoPicker items={items} selection={selection} onSelectionChange={change} credentials={credentials} header={header} footer={footer} onOpen={setPreview} />}
    {preview ? <Modal visible animationType="none" onRequestClose={() => setPreview(null)}><SafeAreaView style={[s.screen, { flex: 1 }]}>
      <ScrollView contentContainerStyle={s.content}><Button title="返回挑选" onPress={() => setPreview(null)} />
        <NativeMediaReader credentials={credentials} assets={[{ id: preview.id, type: preview.type === "text" ? "document" : preview.type, filename: preview.title, mimeType: preview.mimeType ?? "",
          thumbnailPath: credentials && preview.thumbnailUri?.startsWith(credentials.serverUrl) ? preview.thumbnailUri.slice(credentials.serverUrl.length) : undefined }]} />
      </ScrollView>
    </SafeAreaView></Modal> : null}
  </SafeAreaView>;
}
