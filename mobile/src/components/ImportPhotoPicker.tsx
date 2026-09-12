import { memo, useMemo, useState, type ReactNode } from "react";
import { FlatList, Image, Pressable, StyleSheet, View } from "react-native";
import * as Crypto from "expo-crypto";
import type { Credentials } from "../types";
import type { ImportPickItem, ImportPhotoSelection } from "../imports/photo-selection";
import { journalRadius, journalSpace } from "../design/tokens";
import { useColorTheme } from "../theme";
import { JournalIcon, type JournalIconName } from "./JournalIcon";
import { Text } from "./typography";
import { Button } from "./ui";

type PhotoGroup = ImportPhotoSelection["groups"][number];
type PickerRow = { kind: "group"; group: PhotoGroup; index: number } | { kind: "item"; item: ImportPickItem; group: PhotoGroup };

export type ImportPhotoPickerProps = {
  items: ImportPickItem[];
  selection: ImportPhotoSelection;
  onSelectionChange: (selection: ImportPhotoSelection) => void;
  credentials?: Credentials | null;
  disabled?: boolean;
  lockedIds?: readonly string[];
  header?: ReactNode;
  footer?: ReactNode;
  onOpen?: (item: ImportPickItem) => void;
};

/** The parent owns durable selection. Groups and expanded items share one virtual list. */
export function ImportPhotoPicker({ items, selection, onSelectionChange, credentials, disabled = false, lockedIds = [], header, footer, onOpen }: ImportPhotoPickerProps) {
  const { colors } = useColorTheme();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const byId = useMemo(() => new Map(items.map(item => [item.id, item])), [items]);
  const selected = useMemo(() => new Set(selection.selectedIds), [selection.selectedIds]);
  const locked = useMemo(() => new Set(lockedIds), [lockedIds]);
  const selectedPhotos = useMemo(() => items.filter(item => item.type === "image" && selected.has(item.id) && !locked.has(item.id)), [items, selected, locked]);
  const rows = useMemo(() => {
    const entries: PickerRow[] = [];
    for (const [index, group] of selection.groups.entries()) {
      entries.push({ kind: "group", group, index });
      if (expanded.has(group.id)) for (const id of group.ids) {
        const item = byId.get(id);
        if (item) entries.push({ kind: "item", item, group });
      }
    }
    return entries;
  }, [selection.groups, expanded, byId]);
  const commit = (next: ImportPhotoSelection) => { if (!disabled) onSelectionChange(next); };
  const commitIds = (ids: string[]) => commit({ ...selection, selectedIds: ids, coverId: selection.coverId && ids.includes(selection.coverId) ? selection.coverId : null });
  const toggle = (id: string) => {
    if (locked.has(id)) return;
    commitIds(selected.has(id) ? selection.selectedIds.filter(value => value !== id) : [...selection.selectedIds, id]);
  };
  const chooseCover = (item: ImportPickItem) => {
    if (item.type !== "image" || locked.has(item.id)) return;
    commit({ ...selection, selectedIds: selected.has(item.id) ? selection.selectedIds : [...selection.selectedIds, item.id], coverId: selection.coverId === item.id ? null : item.id });
  };
  const chooseRepresentative = (group: PhotoGroup, item: ImportPickItem) => commit({ ...selection, groups: selection.groups.map(row => row.id === group.id ? { ...row, representativeId: item.id } : row) });
  const chooseAll = () => commitIds(items.filter(item => !locked.has(item.id) || selected.has(item.id)).map(item => item.id));
  const chooseRepresentatives = () => {
    const ids = new Set(selection.selectedIds.filter(id => byId.get(id)?.type !== "image" || locked.has(id)));
    for (const group of selection.groups) {
      const representative = byId.get(group.representativeId);
      const image = representative?.type === "image" ? representative : group.ids.map(id => byId.get(id)).find(item => item?.type === "image");
      if (image && !locked.has(image.id)) ids.add(image.id);
    }
    commitIds(items.filter(item => ids.has(item.id)).map(item => item.id));
  };
  const mergePhotos = () => {
    if (selectedPhotos.length < 2) return;
    const ids = selectedPhotos.map(item => item.id), merging = new Set(ids);
    const group: PhotoGroup = { id: Crypto.randomUUID(), ids, representativeId: selection.coverId && merging.has(selection.coverId) ? selection.coverId : ids[0]!, reason: "manual" };
    const groups: PhotoGroup[] = [];
    let inserted = false;
    for (const previous of selection.groups) {
      if (previous.ids.some(id => merging.has(id)) && !inserted) { groups.push(group); inserted = true; }
      const remaining = previous.ids.filter(id => !merging.has(id));
      if (remaining.length) groups.push(remaining.length === previous.ids.length ? previous : { ...previous, ids: remaining, representativeId: remaining.includes(previous.representativeId) ? previous.representativeId : remaining[0]! });
    }
    commit({ ...selection, groups });
    setExpanded(previous => new Set([...previous, group.id]));
  };
  const splitPhotos = (group: PhotoGroup) => {
    const photos = group.ids.filter(id => byId.get(id)?.type === "image");
    if (photos.length < 2) return;
    const other = group.ids.filter(id => byId.get(id)?.type !== "image");
    const singles: PhotoGroup[] = photos.map(id => ({ id: Crypto.randomUUID(), ids: [id], representativeId: id, reason: "manual" }));
    if (other.length) singles.push({ ...group, ids: other, representativeId: other.includes(group.representativeId) ? group.representativeId : other[0]! });
    commit({ ...selection, groups: selection.groups.flatMap(row => row.id === group.id ? singles : [row]) });
  };
  return <FlatList
    testID="import-photo-picker"
    style={{ flex: 1, backgroundColor: colors.paper }}
    contentContainerStyle={styles.list}
    data={rows}
    keyExtractor={row => row.kind === "group" ? `group:${row.group.id}` : `item:${row.item.id}`}
    keyboardShouldPersistTaps="handled"
    initialNumToRender={10}
    maxToRenderPerBatch={10}
    windowSize={7}
    ListHeaderComponent={<View style={styles.header}>
      {header}
      <Text accessibilityRole="header" style={[styles.heading, { color: colors.ink }]}>这次导入，挑几张</Text>
      <Text style={[styles.body, { color: colors.muted }]}>所选素材用来组成记忆。取消勾选、换代表图或拆组，都不会删除原件。</Text>
      <Text accessibilityLiveRegion="polite" style={[styles.count, { color: colors.coralDark }]}>已选 {selection.selectedIds.length} / {items.length} 项 · {selection.groups.length} 组{selection.coverId ? " · 已选封面" : ""}</Text>
      <View style={styles.tools}>
        <Button title="全选" full={false} disabled={disabled || !items.length} onPress={chooseAll} />
        <Button title="仅选代表图" full={false} disabled={disabled || !items.some(item => item.type === "image")} onPress={chooseRepresentatives} />
        <Button title={selection.groups.every(group => expanded.has(group.id)) ? "全部收起" : "全部展开"} full={false} disabled={!selection.groups.length} onPress={() => setExpanded(selection.groups.every(group => expanded.has(group.id)) ? new Set() : new Set(selection.groups.map(group => group.id)))} />
      </View>
      <Text style={[styles.small, { color: colors.muted }]}>“仅选代表图”只调整照片，其他素材保持当前选择。没有拍摄时间时只按本批展示，不判断照片是否相似。</Text>
      <Button title="将已选照片合为一组" icon="image" disabled={disabled || selectedPhotos.length < 2} onPress={mergePhotos} />
    </View>}
    ListEmptyComponent={<Text style={[styles.body, { color: colors.muted }]}>暂时没有可挑选的完整素材，原有错误凭据仍保留。</Text>}
    renderItem={({ item: row }) => row.kind === "group" ? <GroupRow group={row.group} index={row.index} representative={byId.get(row.group.representativeId)} selectedCount={row.group.ids.filter(id => selected.has(id)).length} credentials={credentials} expanded={expanded.has(row.group.id)} disabled={disabled} canSplit={row.group.ids.filter(id => byId.get(id)?.type === "image").length > 1} onToggle={() => setExpanded(previous => { const next = new Set(previous); if (next.has(row.group.id)) next.delete(row.group.id); else next.add(row.group.id); return next; })} onSplit={() => splitPhotos(row.group)} /> : <ItemRow item={row.item} selected={selected.has(row.item.id)} cover={selection.coverId === row.item.id} representative={row.group.representativeId === row.item.id} credentials={credentials} disabled={disabled || locked.has(row.item.id)} locked={locked.has(row.item.id)} onToggle={() => toggle(row.item.id)} onCover={() => chooseCover(row.item)} onRepresentative={() => chooseRepresentative(row.group, row.item)} onOpen={onOpen ? () => onOpen(row.item) : undefined} />}
    ListFooterComponent={<View style={styles.footer}>{footer}</View>}
  />;
}

const GroupRow = memo(function GroupRow({ group, index, representative, selectedCount, credentials, expanded, disabled, canSplit, onToggle, onSplit }: { group: PhotoGroup; index: number; representative?: ImportPickItem; selectedCount: number; credentials?: Credentials | null; expanded: boolean; disabled: boolean; canSplit: boolean; onToggle: () => void; onSplit: () => void }) {
  const { colors } = useColorTheme();
  const reason = group.reason === "time" ? "拍摄时间在 30 秒内 · 建议分组" : group.reason === "manual" ? "你手动整理的分组" : "同一批导入 · 未按拍摄时间归组";
  return <View style={[styles.group, { backgroundColor: colors.card, borderColor: colors.line }]}>
    <Pressable accessibilityRole="button" accessibilityLabel={`第 ${index + 1} 组，${group.ids.length} 项，已选 ${selectedCount} 项，${expanded ? "收起" : "展开看全组"}`} accessibilityState={{ expanded }} onPress={onToggle} style={styles.groupTop}>
      {representative ? <ItemThumbnail item={representative} credentials={credentials} /> : null}
      <View style={styles.textColumn}>
        <Text style={[styles.groupTitle, { color: colors.ink }]}>第 {index + 1} 组 · {group.ids.length} 项</Text>
        <Text style={[styles.small, { color: colors.muted }]}>{reason}</Text>
        <Text style={[styles.small, { color: colors.coralDark }]}>已选 {selectedCount} 项 · {expanded ? "收起" : "展开看全组"}</Text>
      </View>
      <JournalIcon name="chevron-down" size={18} color={colors.muted} />
    </Pressable>
    {canSplit ? <Button title="拆开这组照片" variant="ghost" disabled={disabled} onPress={onSplit} /> : null}
  </View>;
});

const ItemRow = memo(function ItemRow({ item, selected, cover, representative, credentials, disabled, locked, onToggle, onCover, onRepresentative, onOpen }: { item: ImportPickItem; selected: boolean; cover: boolean; representative: boolean; credentials?: Credentials | null; disabled: boolean; locked: boolean; onToggle: () => void; onCover: () => void; onRepresentative: () => void; onOpen?: () => void }) {
  const { colors } = useColorTheme();
  return <View style={[styles.item, { backgroundColor: colors.card, borderColor: selected ? colors.coral : colors.line }]}>
    <View style={styles.itemTop}>
      {onOpen ? <Pressable accessibilityRole="button" accessibilityLabel={`查看原件：${item.title}`} onPress={onOpen}><ItemThumbnail item={item} credentials={credentials} /></Pressable> : <ItemThumbnail item={item} credentials={credentials} />}
      <View style={styles.textColumn}>
        <Text numberOfLines={2} style={[styles.itemTitle, { color: colors.ink }]}>{item.title || "未命名素材"}</Text>
        <Text style={[styles.small, { color: colors.muted }]}>{typeLabel(item.type)}{representative ? " · 本组代表" : ""}{cover ? " · 草稿封面" : ""}</Text>
        {locked ? <Text style={[styles.small, { color: colors.muted }]}>正文在已关联草稿中修改，不随这里的挑选增删。</Text> : null}
      </View>
      <Pressable accessibilityRole="checkbox" accessibilityLabel={`选中 ${item.title}`} accessibilityState={{ checked: selected, disabled }} disabled={disabled} onPress={onToggle} style={[styles.check, { backgroundColor: selected ? colors.coral : colors.paper, borderColor: selected ? colors.coral : colors.line }]}>
        {selected ? <JournalIcon name="check" color={colors.onCoral} size={18} /> : null}
      </Pressable>
    </View>
    <View style={styles.tools}>
      {onOpen ? <Button title="查看原件" variant="ghost" full={false} onPress={onOpen} /> : null}
      {item.type === "image" ? <>
        <Button title={representative ? "本组代表图" : "设为代表图"} variant="ghost" full={false} disabled={disabled || representative} onPress={onRepresentative} />
        <Button title={cover ? "取消封面" : "设为封面"} variant="ghost" full={false} disabled={disabled} onPress={onCover} />
      </> : null}
    </View>
  </View>;
});

function typeLabel(type: ImportPickItem["type"]) {
  return ({ image: "照片", video: "视频", audio: "录音", document: "文件", text: "文字" } as Record<string, string>)[type] || "素材";
}

function ItemThumbnail({ item, credentials }: { item: ImportPickItem; credentials?: Credentials | null }) {
  const { colors } = useColorTheme();
  const [failed, setFailed] = useState<string | null>(null);
  const path = item.thumbnailUri || (item.type === "image" ? item.localUri : undefined);
  let source: { uri: string; headers?: Record<string, string> } | undefined;
  if (path) {
    if (/^(file|content):/i.test(path)) source = { uri: path };
    else if (credentials) {
      try {
        const uri = new URL(path, credentials.serverUrl);
        if (uri.origin === new URL(credentials.serverUrl).origin) source = { uri: uri.toString(), headers: { Authorization: `Bearer ${credentials.token}` } };
      } catch { /* A malformed preview never prevents selecting the original. */ }
    }
  } else if (item.type === "image" && credentials) {
    source = { uri: `${credentials.serverUrl}/api/media/${encodeURIComponent(item.id)}`, headers: { Authorization: `Bearer ${credentials.token}` } };
  }
  const icon: JournalIconName = item.type === "image" ? "image" : item.type === "video" ? "video" : item.type === "audio" ? "audio" : "file";
  return <View style={[styles.thumbnail, { backgroundColor: colors.softCoral }]}>
    {source && failed !== source.uri ? <Image source={source} resizeMode="contain" fadeDuration={0} style={StyleSheet.absoluteFill} onError={() => setFailed(source?.uri ?? null)} /> : <JournalIcon name={icon} size={28} color={colors.coralDark} />}
  </View>;
}

const styles = StyleSheet.create({
  list: { padding: journalSpace.page, gap: 12, paddingBottom: 36 },
  header: { gap: 12, marginBottom: 8 },
  heading: { fontSize: 22, fontWeight: "600" },
  body: { fontSize: 15 },
  small: { fontSize: 12 },
  count: { fontSize: 14, fontWeight: "600" },
  tools: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  group: { borderRadius: journalRadius.card, borderWidth: 1, padding: 12, gap: 4 },
  groupTop: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 88 },
  groupTitle: { fontSize: 17, fontWeight: "600" },
  textColumn: { flex: 1, gap: 6, minWidth: 0 },
  item: { borderRadius: journalRadius.control, borderWidth: 1, padding: 12, gap: 8 },
  itemTop: { flexDirection: "row", alignItems: "center", gap: 12 },
  itemTitle: { fontSize: 15, fontWeight: "500" },
  check: { width: 44, height: 44, borderRadius: 12, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  thumbnail: { width: 88, height: 88, borderRadius: 10, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  footer: { gap: 12, paddingTop: 8 },
});
