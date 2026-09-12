import { useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { Text, TextInput } from "../components/typography";
import { randomUUID } from "expo-crypto";
import { ApiError, patchMobileMemory, requestMobileJson, shareMobileMemory } from "../api/client";
import { PrecisionDateTimeField } from "../components/PrecisionDateTimeField";
import { parseDraftReaders, type DraftReader } from "../drafts/readers";
import { useAppActions, useAppData } from "../state/AppContext";
import type { MemorySharingPatch, MobileMemory } from "../types";
import { useSharedStyles } from "../theme";
import { isOccurredAtPrecision } from "../utils/occurred-precision";
import { memoryEditContent, memoryEditScope, sameMemoryEdit, type LocalMemoryEdit, type MemoryEditContent } from "./edit-model";
import { changeMemoryEdit } from "./edit-store";
import { useMemoryEdit } from "./use-memory-edit";
import { dateLabel } from "../utils/format";

function EditorButton({ label, onPress, pending }: { label: string; onPress: () => void; pending: boolean }) {
  const s = useSharedStyles();
  return <Pressable accessibilityRole="button" disabled={pending} onPress={onPress} style={s.secondaryButton}><Text style={s.secondaryText}>{label}</Text></Pressable>;
}

type Sharing = { visibility: MemorySharingPatch["visibility"]; readers: string[]; revision: number };
export function MemoryEditor({ memory, onSaved }: { memory: MobileMemory; onSaved: () => Promise<void> }) {
  const s = useSharedStyles();
  const { credentials, family, people, online, viewer } = useAppData();
  const { queued, reloadLocal } = useAppActions();
  const scope = memoryEditScope(credentials, viewer?.id, family?.id);
  const { edit, loading: restoring, error: restoreError } = useMemoryEdit(scope, memory.id);
  const [content, setContent] = useState<MemoryEditContent | null>(null);
  const contentRef = useRef<MemoryEditContent | null>(null);
  const editingBase = useRef<{ content: MemoryEditContent; revision: number; timezone: string } | null>(null);
  const [localWrites, setLocalWrites] = useState(0);
  const [localError, setLocalError] = useState<string | null>(null);
  const [sharing, setSharing] = useState<Sharing | null>(null);
  const [readers, setReaders] = useState<DraftReader[]>([]);
  const [readerError, setReaderError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const active = useRef(true);
  const request = useRef<{ signature: string; id: string } | null>(null);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const sharingOpen = sharing !== null;
  useEffect(() => {
    let current = true;
    if (sharingOpen && credentials) {
      void requestMobileJson(credentials, "/api/mobile/v1/draft-readers").then(body => { if (current) { setReaders(parseDraftReaders(body)); setReaderError(null); } })
        .catch(() => { if (current) setReaderError("暂时无法核对家人账号，已选读者保留，请联网重试。"); });
    }
    return () => { current = false; };
  }, [sharingOpen, credentials]);
  if (!credentials || !memory.canWrite || memory.titleRevision === undefined || memory.bodyText === undefined || !isOccurredAtPrecision(memory.occurredAtPrecision)) return null;
  const timezone = family?.timezone ?? "UTC";
  const seed = (): LocalMemoryEdit => ({ scope: scope!, memoryId: memory.id,
    content: editingBase.current?.content ?? memoryEditContent(memory), base: editingBase.current?.content ?? memoryEditContent(memory),
    baseRevision: editingBase.current?.revision ?? memory.titleRevision!, timezone: editingBase.current?.timezone ?? timezone,
    savedContent: null, submission: null, conflict: null, blocked: false, problem: null, revision: 0, updatedAt: new Date().toISOString() });
  const dirty = edit && !sameMemoryEdit(edit.content, edit.base);
  const openContent = () => {
    setMessage(null);
    const useLocal = edit && (dirty || edit.savedContent || edit.submission || edit.conflict || edit.baseRevision >= memory.titleRevision!);
    const value = useLocal ? edit.content : memoryEditContent(memory);
    // Keep the revision the owner actually opened. A refresh before their first
    // keystroke must not silently rebase an old screen onto a newer family edit.
    editingBase.current = useLocal ? { content: edit.base, revision: edit.baseRevision, timezone: edit.timezone }
      : { content: memoryEditContent(memory), revision: memory.titleRevision!, timezone };
    contentRef.current = value;
    setContent(value);
  };
  const updateContent = (patch: Partial<MemoryEditContent>) => {
    if (!contentRef.current || !scope) return;
    const next = { ...contentRef.current, ...patch };
    contentRef.current = next;
    setContent(next);
    setLocalWrites(count => count + 1);
    setLocalError(null);
    void changeMemoryEdit(scope, memory.id, current => {
      const base = current ?? seed();
      // A clean acknowledged row can be older than the detail now on screen.
      const fresh = !base.submission && !base.savedContent && !base.conflict && sameMemoryEdit(base.content, base.base)
        && (editingBase.current?.revision ?? memory.titleRevision!) > base.baseRevision ? seed() : base;
      return { ...fresh, content: next };
    }).catch(error => { if (active.current) setLocalError(error instanceof Error ? error.message : "本机暂存未完成，请稍后重试保存。"); })
      .finally(() => { if (active.current) setLocalWrites(count => count - 1); });
  };
  const mutationId = (value: unknown) => {
    const signature = JSON.stringify(value);
    if (request.current?.signature !== signature) request.current = { signature, id: randomUUID() };
    return request.current.id;
  };
  const save = async () => {
    if (pending) return;
    if (sharing && online === false) { setMessage("读者范围需要联网核验。当前选择保留在本页。"); return; }
    if (content && (!content.title.trim() || (content.precision !== "unknown" && !content.occurredAt))) { setMessage("请填写标题，并按所选精度选择时间。"); return; }
    if (sharing?.visibility === "members" && !sharing.readers.length) { setMessage("请选择至少一位家人，或改为仅作者可见。"); return; }
    setPending(true); setMessage(null);
    try {
      if (content) {
        if (!scope) throw new Error("请先核对当前账号与家庭，再保存修改。");
        await changeMemoryEdit(scope, memory.id, current => {
          const row = current ?? seed();
          if (row.conflict) throw new Error("请先核对家庭版本，再选择保留哪份内容。");
          // A rejected request is safe to replace; an uncertain network receipt
          // keeps its exact operation ID and bytes until the server acknowledges.
          return { ...row, content, savedContent: content, blocked: false, problem: null,
            submission: row.blocked ? null : row.submission };
        });
        if (!active.current) return;
        setContent(null); contentRef.current = null; setLocalError(null);
        setMessage("已保存在本机，联网后同步到家庭。");
        await queued();
        return;
      } else if (sharing) {
        const values = { visibility: sharing.visibility, readerUserIds: sharing.visibility === "members" ? sharing.readers : [], expectedRevision: sharing.revision };
        await shareMobileMemory(credentials, memory.id, { ...values, mutationId: mutationId(values) });
      }
      if (!active.current) return;
      setContent(null); setSharing(null); setMessage("已保存。");
      await onSaved();
    } catch (error) {
      if (active.current && error instanceof ApiError && error.status === 409) await onSaved();
      if (active.current) setMessage(error instanceof ApiError && error.status === 409 ? "这件事已被修改。输入和选择已保留；请复制需要的文字，再取消并重新打开核对。" : error instanceof Error ? error.message : "暂时无法保存，输入和选择已保留。");
    } finally { if (active.current) setPending(false); }
  };
  async function mark(milestoneType: string) {
    if (!credentials || pending) return;
    setPending(true); setMessage(null);
    try {
      const values = { expectedRevision: memory.titleRevision!, milestoneType: memory.milestoneType === milestoneType ? null : milestoneType };
      await patchMobileMemory(credentials, memory.id, { ...values, mutationId: mutationId(values) });
      if (active.current) await onSaved();
    } catch { if (active.current) setMessage("暂时无法保存标记，请联网后重试。"); }
    finally { if (active.current) setPending(false); }
  }
  return <View style={s.card} accessibilityLabel="编辑与分享">
    {message ? <Text accessibilityRole="alert" style={s.body}>{message}</Text> : null}
    {restoreError || localError ? <Text accessibilityRole="alert" style={[s.body, { color: s.colors.error }]}>{restoreError || localError}</Text> : null}
    {edit ? <Text style={s.body}>{localWrites > 0 ? "正在保存到本机…" : edit.conflict ? "本机修改已保留 · 需要核对家庭版本" : edit.problem ?? (edit.savedContent || edit.submission ? "已保存在本机 · 等待同步到家庭" : dirty ? "输入已暂存本机 · 保存后才同步" : "修改已同步到家庭")}</Text> : null}
    {edit?.conflict ? <>
      <Text style={s.cardTitle}>家人也修改了这段回忆</Text>
      <Text style={s.body}>两份内容都已保留。先核对，再选择；继续修改可先回到编辑框。</Text>
      {[["我的本机修改", edit.content], ["家庭最新版本", edit.conflict.content]].map(([label, value]) => {
        const item = value as MemoryEditContent;
        return <View key={label as string} style={s.card}>
          <Text style={s.label}>{label as string}</Text><Text selectable style={s.cardTitle}>{item.title}</Text>
          <Text selectable style={s.body}>{item.bodyText || "未填写正文"}</Text>
          <Text style={s.body}>{item.occurredAt ? dateLabel(item.occurredAt, timezone, item.precision) : "时间未知"} · {item.location || "未填写地点"}</Text>
          <Text style={s.body}>参与人物：{item.participants.map(id => people.find(person => person.id === id)?.displayName ?? "未载入人物").join("、") || "未选择"}</Text>
        </View>;
      })}
      <EditorButton pending={pending || localWrites > 0} label="保留我的修改，重新保存" onPress={() => {
        if (!scope) return;
        setPending(true);
        void changeMemoryEdit(scope, memory.id, current => {
          if (!current?.conflict) return current;
          if (!current.content.title.trim() || (current.content.precision !== "unknown" && !current.content.occurredAt)) throw new Error("请填写标题，并按所选精度选择时间。");
          return { ...current, base: current.conflict.content, baseRevision: current.conflict.revision, savedContent: current.content,
            conflict: null, submission: null, blocked: false, problem: null };
        })
          .then(async () => { if (active.current) { setContent(null); contentRef.current = null; setMessage("已保存在本机，联网后重新同步。"); } await queued(); })
          .catch(error => { if (active.current) setMessage(error instanceof Error ? error.message : "暂时无法保存。"); })
          .finally(() => { if (active.current) setPending(false); });
      }} />
      <EditorButton pending={pending || localWrites > 0} label="放弃本机修改，使用家庭版本" onPress={() => {
        if (!scope) return;
        setPending(true);
        void changeMemoryEdit(scope, memory.id, current => current?.conflict ? null : current)
          .then(async () => { if (active.current) { setContent(null); contentRef.current = null; setMessage("已使用家庭版本。"); } await reloadLocal(); await onSaved(); })
          .catch(error => { if (active.current) setMessage(error instanceof Error ? error.message : "暂时无法更新。"); })
          .finally(() => { if (active.current) setPending(false); });
      }} />
    </> : null}
    {!content && !sharing ? <>
      <Text style={s.label}>标记这一刻</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{[["first_time", "第一次"], ["other", "值得记住"]].map(([value, label]) => <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: memory.milestoneType === value }} disabled={pending || online === false} onPress={() => void mark(value!)} style={memory.milestoneType === value ? s.primaryButton : s.secondaryButton}><Text style={memory.milestoneType === value ? s.primaryText : s.secondaryText}>{label}</Text></Pressable>)}</View>
      <EditorButton pending={pending || restoring || !scope || Boolean(restoreError)} label={dirty ? "继续修改这件事" : "修改这件事"} onPress={openContent} />
      {memory.visibility ? <EditorButton pending={pending} label="管理分享" onPress={() => { setMessage(null); setSharing({ visibility: memory.visibility!, readers: memory.readerUserIds ?? [], revision: memory.titleRevision! }); }} /> : null}
    </> : null}
    {content ? <>
      <Text style={s.body}>{localWrites > 0 ? "正在暂存输入…" : "输入自动暂存在本机，点击保存后才同步到家庭。"}</Text>
      <TextInput editable={!pending} accessibilityLabel="记忆标题" value={content.title} maxLength={100} onChangeText={title => updateContent({ title })} style={s.input} />
      <TextInput editable={!pending} accessibilityLabel="记忆正文" value={content.bodyText} multiline maxLength={100000} onChangeText={bodyText => updateContent({ bodyText })} style={s.input} />
      <PrecisionDateTimeField disabled={pending} occurredAt={content.occurredAt} precision={content.precision} timezone={timezone} onChange={updateContent} />
      <TextInput editable={!pending} accessibilityLabel="记忆地点" value={content.location} maxLength={200} onChangeText={location => updateContent({ location })} style={s.input} />
      <Text style={s.body}>参与人物</Text>{people.map(person => <Pressable disabled={pending} key={person.id} accessibilityRole="checkbox" accessibilityLabel={person.displayName} accessibilityState={{ checked: content.participants.includes(person.id) }} onPress={() => updateContent({ participants: content.participants.includes(person.id) ? content.participants.filter(id => id !== person.id) : [...content.participants, person.id] })} style={s.secondaryButton}><Text style={s.secondaryText}>{content.participants.includes(person.id) ? "✓ " : ""}{person.displayName}</Text></Pressable>)}
    </> : null}
    {sharing ? <>
      <Text style={s.cardTitle}>谁可以阅读这件事</Text>
      {([ ["private", memory.isAuthor ? "仅自己" : "仅作者"], ["members", "指定家人"], ["family", "全家可见"] ] as const).map(([value, label]) => <Pressable disabled={pending} key={value} accessibilityRole="radio" accessibilityState={{ selected: sharing.visibility === value }} onPress={() => setSharing(v => v && (v.visibility === value ? v : { ...v, visibility: value, readers: [] }))} style={s.secondaryButton}><Text style={s.secondaryText}>{label}</Text></Pressable>)}
      {sharing.visibility === "members" ? <>{readerError ? <Text>{readerError}</Text> : null}{readers.map(reader => <Pressable disabled={pending} key={reader.id} accessibilityRole="checkbox" accessibilityLabel={reader.name} accessibilityState={{ checked: sharing.readers.includes(reader.id) }} onPress={() => setSharing(v => v && ({ ...v, readers: v.readers.includes(reader.id) ? v.readers.filter(id => id !== reader.id) : [...v.readers, reader.id] }))} style={s.secondaryButton}><Text style={s.secondaryText}>{sharing.readers.includes(reader.id) ? "✓ " : ""}{reader.name}</Text></Pressable>)}{sharing.readers.filter(id => !readers.some(reader => reader.id === id)).map(id => <View key={id}><EditorButton pending={pending} label="取消已不可用的成员" onPress={() => setSharing(v => v && ({ ...v, readers: v.readers.filter(value => value !== id) }))} /></View>)}</> : null}
      <Text style={s.body}>保存后才改变读者。移除读者会收回这件事的在线入口；其他独立分享仍有效，已导出的文件无法远程收回。家人讲述也遵循各自的范围。</Text>
    </> : null}
    {content || sharing ? <><EditorButton pending={pending || Boolean(content && edit?.conflict)} label={sharing ? "保存分享设置" : "保存记忆修改"} onPress={() => void save()} /><EditorButton pending={pending || localWrites > 0 || Boolean(content && localError)} label={content ? "稍后继续，保留本机输入" : "取消编辑"} onPress={() => { setContent(null); contentRef.current = null; setSharing(null); setMessage(null); }} /></> : null}
  </View>;
}
