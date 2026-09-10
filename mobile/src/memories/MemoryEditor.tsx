import { useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { Text, TextInput } from "../components/typography";
import { randomUUID } from "expo-crypto";
import { ApiError, patchMobileMemory, requestMobileJson, shareMobileMemory } from "../api/client";
import { PrecisionDateTimeField } from "../components/PrecisionDateTimeField";
import { parseDraftReaders, type DraftReader } from "../drafts/readers";
import { useApp } from "../state/AppContext";
import type { MemorySharingPatch, MobileMemory, MobileMemoryPatch } from "../types";
import { useSharedStyles } from "../theme";
import { isOccurredAtPrecision, type OccurredAtPrecision } from "../utils/occurred-precision";
import { utcToZonedWallTimeInput } from "../utils/wall-time";

function EditorButton({ label, onPress, pending }: { label: string; onPress: () => void; pending: boolean }) {
  const s = useSharedStyles();
  return <Pressable accessibilityRole="button" disabled={pending} onPress={onPress} style={s.secondaryButton}><Text style={s.secondaryText}>{label}</Text></Pressable>;
}

type Content = { title: string; bodyText: string; location: string; occurredAt: string | null; precision: OccurredAtPrecision; participants: string[]; child: string | null; revision: number };
type Sharing = { visibility: MemorySharingPatch["visibility"]; readers: string[]; revision: number };
export function MemoryEditor({ memory, onSaved }: { memory: MobileMemory; onSaved: () => Promise<void> }) {
  const s = useSharedStyles();
  const { credentials, family, people, online } = useApp();
  const [content, setContent] = useState<Content | null>(null);
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
  const mutationId = (value: unknown) => {
    const signature = JSON.stringify(value);
    if (request.current?.signature !== signature) request.current = { signature, id: randomUUID() };
    return request.current.id;
  };
  const save = async () => {
    if (pending) return;
    if (online === false) { setMessage("当前离线，输入和选择仍保留在本页。联网后再保存。"); return; }
    if (content && (!content.title.trim() || (content.precision !== "unknown" && !content.occurredAt))) { setMessage("请填写标题，并按所选精度选择时间。"); return; }
    if (sharing?.visibility === "members" && !sharing.readers.length) { setMessage("请选择至少一位家人，或改为仅作者可见。"); return; }
    setPending(true); setMessage(null);
    try {
      if (content) {
        const wall = content.occurredAt ? utcToZonedWallTimeInput(new Date(content.occurredAt), timezone) : undefined;
        const values: Omit<MobileMemoryPatch, "mutationId"> = { title: content.title, bodyText: content.bodyText, locationText: content.location || null,
          occurredAtPrecision: content.precision, occurredAtWall: content.precision === "unknown" ? undefined : content.precision === "year" ? wall?.slice(0, 4) : content.precision === "month" ? wall?.slice(0, 7) : content.precision === "date_only" ? wall?.slice(0, 10) : wall,
          participantPersonIds: content.participants, childPersonId: content.child, expectedRevision: content.revision };
        await patchMobileMemory(credentials, memory.id, { ...values, mutationId: mutationId(values) });
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
    {!content && !sharing ? <>
      <Text style={s.label}>标记这一刻</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{[["first_time", "第一次"], ["other", "值得记住"]].map(([value, label]) => <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: memory.milestoneType === value }} disabled={pending || online === false} onPress={() => void mark(value!)} style={memory.milestoneType === value ? s.primaryButton : s.secondaryButton}><Text style={memory.milestoneType === value ? s.primaryText : s.secondaryText}>{label}</Text></Pressable>)}</View>
      <EditorButton pending={pending} label="修改这件事" onPress={() => { setMessage(null); setContent({ title: memory.title, bodyText: memory.bodyText!, location: memory.locationText ?? "", occurredAt: memory.occurredAtPrecision === "unknown" ? null : memory.occurredAt, precision: memory.occurredAtPrecision as OccurredAtPrecision, participants: memory.participantPersonIds, child: memory.childPersonId, revision: memory.titleRevision! }); }} />
      {memory.visibility ? <EditorButton pending={pending} label="管理分享" onPress={() => { setMessage(null); setSharing({ visibility: memory.visibility!, readers: memory.readerUserIds ?? [], revision: memory.titleRevision! }); }} /> : null}
    </> : null}
    {content ? <>
      <TextInput editable={!pending} accessibilityLabel="记忆标题" value={content.title} maxLength={100} onChangeText={title => setContent(v => v && ({ ...v, title }))} style={s.input} />
      <TextInput editable={!pending} accessibilityLabel="记忆正文" value={content.bodyText} multiline maxLength={100000} onChangeText={bodyText => setContent(v => v && ({ ...v, bodyText }))} style={s.input} />
      <PrecisionDateTimeField disabled={pending} occurredAt={content.occurredAt} precision={content.precision} timezone={timezone} onChange={value => setContent(v => v && ({ ...v, ...value }))} />
      <TextInput editable={!pending} accessibilityLabel="记忆地点" value={content.location} maxLength={200} onChangeText={location => setContent(v => v && ({ ...v, location }))} style={s.input} />
      <Text style={s.body}>参与人物</Text>{people.map(person => <Pressable disabled={pending} key={person.id} accessibilityRole="checkbox" accessibilityLabel={person.displayName} accessibilityState={{ checked: content.participants.includes(person.id) }} onPress={() => setContent(v => v && ({ ...v, participants: v.participants.includes(person.id) ? v.participants.filter(id => id !== person.id) : [...v.participants, person.id] }))} style={s.secondaryButton}><Text style={s.secondaryText}>{content.participants.includes(person.id) ? "✓ " : ""}{person.displayName}</Text></Pressable>)}
    </> : null}
    {sharing ? <>
      <Text style={s.cardTitle}>谁可以阅读这件事</Text>
      {([ ["private", memory.isAuthor ? "仅自己" : "仅作者"], ["members", "指定家人"], ["family", "全家可见"] ] as const).map(([value, label]) => <Pressable disabled={pending} key={value} accessibilityRole="radio" accessibilityState={{ selected: sharing.visibility === value }} onPress={() => setSharing(v => v && (v.visibility === value ? v : { ...v, visibility: value, readers: [] }))} style={s.secondaryButton}><Text style={s.secondaryText}>{label}</Text></Pressable>)}
      {sharing.visibility === "members" ? <>{readerError ? <Text>{readerError}</Text> : null}{readers.map(reader => <Pressable disabled={pending} key={reader.id} accessibilityRole="checkbox" accessibilityLabel={reader.name} accessibilityState={{ checked: sharing.readers.includes(reader.id) }} onPress={() => setSharing(v => v && ({ ...v, readers: v.readers.includes(reader.id) ? v.readers.filter(id => id !== reader.id) : [...v.readers, reader.id] }))} style={s.secondaryButton}><Text style={s.secondaryText}>{sharing.readers.includes(reader.id) ? "✓ " : ""}{reader.name}</Text></Pressable>)}{sharing.readers.filter(id => !readers.some(reader => reader.id === id)).map(id => <View key={id}><EditorButton pending={pending} label="取消已不可用的成员" onPress={() => setSharing(v => v && ({ ...v, readers: v.readers.filter(value => value !== id) }))} /></View>)}</> : null}
      <Text style={s.body}>保存后才改变读者。移除读者会收回这件事的在线入口；其他独立分享仍有效，已导出的文件无法远程收回。家人讲述也遵循各自的范围。</Text>
    </> : null}
    {content || sharing ? <><EditorButton pending={pending} label={sharing ? "保存分享设置" : "保存记忆修改"} onPress={() => void save()} /><EditorButton pending={pending} label="取消编辑" onPress={() => { setContent(null); setSharing(null); setMessage(null); }} /></> : null}
  </View>;
}
