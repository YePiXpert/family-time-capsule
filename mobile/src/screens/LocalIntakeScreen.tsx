import { Text } from "../components/typography";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { FlatList, View } from "react-native";
import * as Crypto from "expo-crypto";
import { chooseLocalIntake, getLocalIntake, type IntakeDetail } from "../native/intake-store";
import { listLocalDrafts, type LocalDraft } from "../drafts/store";
import { createPhotoSelection, reconcilePhotoSelection, type ImportPickItem, type ImportPhotoSelection } from "../imports/photo-selection";
import { loadPhotoSelection, savePhotoSelection } from "../imports/photo-selection-store";
import { ImportPhotoPicker } from "../components/ImportPhotoPicker";
import { Button } from "../components/ui";
import { Disclosure } from "../components/Disclosure";
import { resolveNativeCaptureAccess } from "../authz/product-access";
import { useAppData, useAppActions } from "../state/AppContext";
import type { RootStackParamList } from "../navigation/types";
import { useSharedStyles } from "../theme";

type IntakeView = { key: string; detail: IntakeDetail | null; drafts: LocalDraft[]; linkedDraft: LocalDraft | null; items: ImportPickItem[]; selection: ImportPhotoSelection | null };
type SelectionSession = { key: string; scope: string; id: string; revision: number; current: ImportPhotoSelection; sequence: number; persisted: number; running: boolean; error: Error | null };

function pickerItems(detail: IntakeDetail): ImportPickItem[] {
  return detail.items.flatMap<ImportPickItem>(item => {
    const original = item.original;
    if (item.error || !original) return [];
    if (original.kind === "text_capture") return [{ id: item.captureId, title: original.title || original.text?.slice(0, 40) || "收到的文字", type: "text" as const, capturedAt: null }];
    if (!original.localUri || !original.mediaType) return [];
    return [{ id: item.captureId, title: original.fileName || original.title, type: original.mediaType, localUri: original.localUri, mimeType: original.mimeType ?? undefined,
      // occurredAt is the intake ordering time; it cannot establish a photo group.
      capturedAt: null }];
  });
}

type IntakeScreenProps = NativeStackScreenProps<RootStackParamList, "LocalIntake">;

export function LocalIntakeScreen(props: IntakeScreenProps) {
  const { credentials, userId, family, viewer } = useAppData();
  // Cached identity can address this account's local work while offline. Only
  // the live account check below may authorize sending originals to a server.
  const knownIdentity = !credentials || Boolean(credentials.instanceId && viewer?.id && family?.id && (!userId || viewer.id === userId));
  const verified = Boolean(credentials?.instanceId && userId && family?.id && viewer?.id === userId);
  const scope = credentials?.instanceId && viewer?.id && family?.id && knownIdentity ? JSON.stringify([credentials.serverUrl, credentials.instanceId, viewer.id, family.id]) : "local";
  return <LocalIntakeSession key={JSON.stringify([scope, props.route.params.id])} {...props} scope={scope} knownIdentity={knownIdentity} verified={verified} />;
}

/** Changing account or batch remounts the local UI; pending writes retain their original scope. */
function LocalIntakeSession({ route, navigation, scope, knownIdentity, verified }: IntakeScreenProps & { scope: string; knownIdentity: boolean; verified: boolean }) {
  const s = useSharedStyles();
  const { credentials, family, viewer, syncConsent, online } = useAppData();
  const { reloadLocal, runSync, grantSyncConsent } = useAppActions();
  const key = JSON.stringify([scope, route.params.id]);
  const keyRef = useRef(key);
  const sessionRef = useRef<SelectionSession | null>(null);
  const writes = useRef<Promise<void>>(Promise.resolve());
  const submitting = useRef(false);
  const operationRevision = useRef(0);
  const [state, setState] = useState<IntakeView | null>(null);
  const [error, setError] = useState<string | null>(null), [message, setMessage] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const [saveState, setSaveState] = useState<"saving" | "saved" | "failed" | "readonly">("readonly");
  const [draftLimit, setDraftLimit] = useState(8);
  useLayoutEffect(() => {
    keyRef.current = key;
    operationRevision.current++;
    return () => { keyRef.current = ""; };
  }, [key]);
  const view = state?.key === key ? state : null;
  const detail = view?.detail ?? null;
  const editable = knownIdentity && resolveNativeCaptureAccess(Boolean(credentials), viewer) !== "readonly";

  // Coalesce fast taps while one write is running; every write uses the last
  // committed revision. A failed write leaves the user's latest selection intact.
  const persist = useCallback((session: SelectionSession) => {
    if (session.running || session.error) return;
    session.running = true;
    if (sessionRef.current === session && keyRef.current === session.key) setSaveState("saving");
    writes.current = writes.current.catch(() => {}).then(async () => {
      while (session.persisted < session.sequence && !session.error) {
        const sequence = session.sequence;
        const candidate = { ...session.current, revision: session.revision };
        try {
          const saved = await savePhotoSelection(session.scope, session.id, candidate, session.revision);
          session.revision = saved.revision;
          session.persisted = sequence;
          if (session.sequence === sequence) session.current = saved;
          if (sessionRef.current === session && keyRef.current === session.key && session.sequence === sequence) {
            setState(current => current?.key === session.key ? { ...current, selection: saved } : current);
            setSaveState("saved");
          }
        } catch (reason) {
          session.error = reason instanceof Error ? reason : new Error("本机挑选暂存失败，请重试。");
          if (sessionRef.current === session && keyRef.current === session.key) { setSaveState("failed"); setError(session.error.message); }
        }
      }
    }).finally(() => { session.running = false; });
  }, []);

  const reload = useCallback(async (isCurrent: () => boolean = () => keyRef.current === key) => {
    await writes.current;
    const pending = sessionRef.current;
    if (pending?.key === key && pending.error) {
      if (isCurrent() && keyRef.current === key) { setError(pending.error.message); setSaveState("failed"); }
      return;
    }
    const [detail, drafts] = await Promise.all([getLocalIntake(route.params.id, scope), listLocalDrafts(scope)]);
    if (!isCurrent() || keyRef.current !== key) return;
    if (!detail) { sessionRef.current = null; setState({ key, detail: null, drafts, linkedDraft: null, items: [], selection: null }); return; }
    const items = pickerItems(detail);
    const originalDrafts = detail.choice.scope === "local" && scope !== "local" && detail.choice.draft_id ? await listLocalDrafts("local") : drafts;
    const linkedDraft = originalDrafts.find(draft => draft.id === detail.choice.draft_id) ?? null;
    try {
      const stored = await loadPhotoSelection(scope, detail.id);
      const inherited = !stored && scope !== "local" && detail.choice.scope === "local" ? await loadPhotoSelection("local", detail.id) : null;
      if (!isCurrent() || keyRef.current !== key) return;
      let selection = reconcilePhotoSelection(stored ?? inherited ?? createPhotoSelection(items), items);
      if (!stored && !inherited && linkedDraft) {
        const references = new Set(linkedDraft.content.items.flatMap(item => item.localCaptureRef ? [item.localCaptureRef] : []));
        const cover = linkedDraft.content.items.find(item => item.id === linkedDraft.content.coverItemId)?.localCaptureRef;
        selection = { ...selection, selectedIds: items.filter(item => item.type === "text" || references.has(item.id)).map(item => item.id), coverId: cover && items.some(item => item.id === cover && item.type === "image") ? cover : null };
      }
      selection = { ...selection, revision: stored?.revision ?? 0 };
      const changed = !stored || JSON.stringify(stored) !== JSON.stringify(selection);
      const session: SelectionSession = { key, scope, id: detail.id, revision: stored?.revision ?? 0, current: selection, sequence: changed ? 1 : 0, persisted: 0, running: false, error: null };
      sessionRef.current = session;
      setState({ key, detail, drafts, linkedDraft, items, selection });
      setError(null);
      setSaveState(editable ? changed ? "saving" : "saved" : "readonly");
      if (editable && changed) persist(session);
    } catch (reason) {
      if (!isCurrent() || keyRef.current !== key) return;
      // Never overwrite an unreadable saved selection with a fresh default.
      sessionRef.current = null;
      setState({ key, detail, drafts, linkedDraft, items, selection: null });
      setSaveState("failed");
      setError(reason instanceof Error ? reason.message : "暂时无法读取之前的挑选，请重新读取。");
    }
  }, [key, scope, route.params.id, editable, persist]);
  useFocusEffect(useCallback(() => {
    let active = true;
    void reload(() => active).catch(reason => { if (active && keyRef.current === key) setError(reason instanceof Error ? reason.message : "暂时无法读取本机收件。"); });
    return () => { active = false; };
  }, [key, reload]));

  const changeSelection = (selection: ImportPhotoSelection) => {
    const session = sessionRef.current;
    if (!editable || busy || !session || session.key !== key) return;
    session.current = selection;
    session.sequence++;
    setState(current => current?.key === key ? { ...current, selection } : current);
    if (!session.error) persist(session);
  };
  const retrySave = () => {
    const session = sessionRef.current;
    if (!session || session.key !== key) { void reload().catch(reason => setError(reason.message)); return; }
    session.error = null;
    setError(null);
    persist(session);
  };
  const flushSelection = async () => {
    const session = sessionRef.current;
    if (!session || session.key !== key) throw new Error("请先读取并保存这次挑选。");
    if (!session.error && session.persisted < session.sequence) persist(session);
    await writes.current;
    if (keyRef.current !== key || sessionRef.current !== session) throw new Error("当前账号或导入批次已变化，请重新打开。");
    if (session.error) throw session.error;
    if (session.persisted < session.sequence) throw new Error("挑选尚未保存，请稍后重试。");
    return session.current;
  };
  const choose = async (destination: "draft" | "library", draft?: LocalDraft, upload = false, refine = false) => {
    if (!detail || !editable || submitting.current) return;
    if (upload && (!credentials || !verified || online !== true)) { setError("请先联网并核对当前家庭，再上传原件。"); return; }
    const operation = ++operationRevision.current;
    const isCurrent = () => keyRef.current === key && operationRevision.current === operation;
    submitting.current = true; setBusy(true); setError(null);
    try {
      const selection = await flushSelection();
      const result = await chooseLocalIntake({ id: detail.id, scope, expectedRevision: detail.choice.revision, destination,
        ...(destination === "draft" ? { draftId: draft?.id ?? Crypto.randomUUID(), draftRevision: draft?.revision ?? 0,
          selectedCaptureIds: selection.selectedIds, coverCaptureId: selection.coverId, refine } : { queueUpload: upload }), mutationId: Crypto.randomUUID() });
      if (!isCurrent()) return;
      await reloadLocal();
      await reload();
      if (!isCurrent()) return;
      if (result.draftId) {
        navigation.navigate("MainTabs", { screen: "Capture", params: { localDraftId: result.draftId, requestKey: Date.now() } });
      } else if (upload && credentials && family) {
        setMessage("已确认上传本批原件，未选素材也仍保留。文字不会自动变成记忆。");
        if (result.uploadIds.length) {
          await grantSyncConsent(syncConsent?.scope === "all" ? "all" : "selected", [...new Set([...(syncConsent?.ids ?? []), ...result.uploadIds])]);
          if (isCurrent()) void runSync();
        }
      } else setMessage("本批全部原件已保留在本机资料库。没有开始上传，也没有创建记忆。");
    } catch (reason) {
      if (isCurrent()) setError(reason instanceof Error ? reason.message : "本机保存失败，请重试。");
    } finally { if (isCurrent()) { submitting.current = false; setBusy(false); } }
  };

  const lockedIds = useMemo(() => view?.detail?.choice.destination === "draft" ? view.items.filter(item => item.type === "text").map(item => item.id) : [], [view]);
  const ready = editable && Boolean(view?.selection) && saveState === "saved" && !busy;
  const linked = view?.linkedDraft;
  const editableDrafts = view?.drafts.filter(draft => draft.status === "editing") ?? [];
  const openOriginal = (item: ImportPickItem) => navigation.navigate("LocalCapture", { captureId: item.id });
  const header = <View style={{ gap: 10 }}>
    {detail ? <Text style={s.body}>{detail.items.length} 项原始收件 · {detail.choice.destination === "pending" ? "尚未选择去向" : detail.choice.destination === "draft" ? "已关联草稿" : "原件保留在资料库"}</Text> : null}
    {!knownIdentity ? <Text style={s.warningText}>当前账号与家庭尚未核对。本机内容可以查看；重新连接后再选择草稿或上传去向。</Text> : !editable ? <Text style={s.body}>当前账号只能阅读。原件与已有挑选仍保留在本机。</Text> : credentials && !verified ? <Text style={s.body}>正在使用此账号已保存的本机资料。挑选与草稿可以继续保存在本机；联网核对后才可上传原件。</Text> : null}
    {saveState !== "readonly" ? <Text accessibilityLiveRegion="polite" style={saveState === "failed" ? s.error : s.body}>{saveState === "saving" ? "正在暂存挑选…" : saveState === "saved" ? "挑选已暂存在本机" : "本次挑选尚未保存，输入仍保留"}</Text> : null}
    {error ? <Text accessibilityRole="alert" style={s.error}>{error}</Text> : null}
    {saveState === "failed" ? <Button title="重试保存挑选" disabled={!editable || busy} onPress={retrySave} /> : null}
    {message ? <Text accessibilityLiveRegion="polite" style={s.body}>{message}</Text> : null}
  </View>;
  const footer = <>
    {detail && view ? <>
      {detail.items.some(item => item.error || !view.items.some(available => available.id === item.captureId)) ? <View style={s.warning}>
        <Text style={s.warningText}>有 {detail.items.filter(item => item.error || !view.items.some(available => available.id === item.captureId)).length} 项未完整保全，未列入挑选。请从原应用重新分享；其他原件不受影响。</Text>
      </View> : null}
      {editable && (detail.choice.destination === "pending" || detail.choice.destination === "library") ? <>
        <Button title="将所选加入新草稿" variant="primary" disabled={!ready || !view.selection?.selectedIds.length} onPress={() => void choose("draft")} />
        {editableDrafts.length ? <Disclosure title={`将所选加入已有草稿 · ${editableDrafts.length} 份`}>
          <View style={{ gap: 8 }}>{editableDrafts.slice(0, draftLimit).map(draft => <Button key={draft.id} title={draft.content.title || draft.content.text.slice(0, 30) || "未命名的一件事"} disabled={!ready || !view.selection?.selectedIds.length} onPress={() => void choose("draft", draft)} />)}
            {editableDrafts.length > draftLimit ? <Button title="更多草稿" variant="ghost" onPress={() => setDraftLimit(limit => limit + 8)} /> : null}
          </View>
        </Disclosure> : null}
        {detail.choice.destination === "pending" ? <Button title="仅存本机资料库 · 保留全部原件" disabled={!ready} onPress={() => void choose("library")} /> : null}
        {credentials ? <Button title={`上传全部原件到家庭资料库 · ${family?.name ?? "当前家庭"}`} disabled={!ready || !verified || online !== true} onPress={() => void choose("library", undefined, true)} /> : null}
        <Text style={s.body}>加入草稿只保存所选引用；仅存资料库会保留本批全部原件。只有点按“上传全部原件”才会申请上传。</Text>
      </> : null}
      {detail.choice.destination === "draft" ? <>
        {linked && linked.scope === scope ? <>
          <Button title="应用挑选到草稿" variant="primary" disabled={!ready || linked.status !== "editing"} onPress={() => void choose("draft", linked, false, true)} />
          {linked.status !== "editing" ? <Text style={s.body}>关联草稿当前不可编辑。先在记录页继续编辑，再应用挑选。</Text> : <Text style={s.body}>只调整本批素材的引用与封面；其他素材和正文保持不变。Live Photo 两个原件需要一起保留或移除。</Text>}
          <Button title="查看关联草稿" disabled={busy || !knownIdentity} onPress={() => navigation.navigate("MainTabs", { screen: "Capture", params: { localDraftId: linked.id, requestKey: Date.now() } })} />
        </> : <>
          {linked?.content.text ? <View style={s.card}><Text style={s.cardTitle}>原本机草稿</Text><Text style={s.body}>{linked.content.text}</Text></View> : null}
          <Text style={s.body}>这批素材关联的本机草稿尚未绑定当前家庭。原件和正文仍保留，请在记录页核对去向后继续。</Text>
          <Button title="到记录页核对本机草稿" disabled={busy || !knownIdentity} onPress={() => navigation.navigate("MainTabs", { screen: "Capture" })} />
        </>}
      </> : null}
    </> : null}
  </>;

  if (view?.selection) return <ImportPhotoPicker key={key} items={view.items} selection={view.selection} onSelectionChange={changeSelection} disabled={!editable || busy} lockedIds={lockedIds} onOpen={openOriginal} header={header} footer={footer} />;
  return <FlatList style={s.screen} contentContainerStyle={s.content} data={view?.items ?? []} keyExtractor={item => item.id} ListHeaderComponent={<View style={{ gap: 12 }}>{header}<Text style={s.body}>{view ? view.detail ? "挑选暂时无法读取，原件仍可查看。" : "找不到这份收件，或它属于其他账号。请核对原来的连接。" : "正在读取本机收件…"}</Text><Button title="重新读取" onPress={() => void reload().catch(reason => setError(reason.message))} /></View>} renderItem={({ item }) => <Button title={`查看原件：${item.title}`} onPress={() => openOriginal(item)} />} />;
}
