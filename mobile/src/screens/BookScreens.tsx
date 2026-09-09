import { FocusedImage } from "../components/FocusedImage";
import { Text, TextInput } from "../components/typography";
import { WorkCreator } from "./WorkCreator";
import { Disclosure } from "../components/Disclosure";
import { ReadingDownloadButton } from "../reading/DownloadButton";
import { NativeBookPublication } from "../books/NativeBookPublication";
import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusEffect, usePreventRemove } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { randomUUID } from "expo-crypto";
import { Alert, Pressable, ScrollView, View } from "react-native";
import {
  fetchBook,
  fetchBooks,
  fetchBookMaterials,
  mutateBook,
  type BookMaterials,
} from "../api/client";
import {
  BOOK_TEMPLATES,
  defaultBookLayout,
  type BookDetail,
  type BookPage,
  type BookBlock,
} from "../books/types";
import type { RootStackParamList } from "../navigation/types";
import { useApp } from "../state/AppContext";
import { sharedStyles as s, colors } from "../theme";
function Button({
  title,
  onPress,
  disabled = false,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      style={[s.secondaryButton, disabled && s.disabled]}
      onPress={onPress}
    >
      <Text style={s.secondaryText}>{title}</Text>
    </Pressable>
  );
}
function Field({
  label,
  value,
  onChange,
  disabled = false,
  multiline = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  multiline?: boolean;
}) {
  return (
    <View style={{ gap: 5 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        style={[
          s.input,
          multiline && { minHeight: 100, textAlignVertical: "top" },
        ]}
        value={value}
        onChangeText={onChange}
        editable={!disabled}
        multiline={multiline}
      />
    </View>
  );
}
export function BooksScreen({ navigation }: { navigation: Pick<NativeStackScreenProps<RootStackParamList, "Books">["navigation"], "navigate"> }) {
  const { credentials } = useApp();
  const [page, setPage] = useState<BookPage | null>(null);
  const [deleted, setDeleted] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async (cursor = "") => {
    if (!credentials) return;
    try { const next = await fetchBooks(credentials, deleted, cursor); setPage(old => cursor && old ? { ...next, entries: [...old.entries, ...next.entries] } : next); setError(""); }
    catch (e) { setError((e as Error).message); }
  }, [credentials, deleted]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  return <ScrollView style={s.screen} contentContainerStyle={s.content}>
    {page?.canWrite && !deleted && !creating ? <Button title="新建家庭书" onPress={() => setCreating(true)} /> : null}
    {creating ? <WorkCreator kind="book" onCancel={() => setCreating(false)} onCreated={id => { setCreating(false); navigation.navigate("BookDetail", { id }); }} /> : null}
    {error ? <><Text accessibilityRole="alert" style={s.error}>{error}</Text><Button title="重试" onPress={() => void load()} /></> : null}
    {!credentials ? <Text style={s.body}>连接家庭服务器后可以创建家庭书；已下载的作品仍可离线阅读。</Text> : null}
    {page?.entries.map(book => <Pressable key={book.id} accessibilityRole="button" onPress={() => navigation.navigate("BookDetail", { id: book.id })} style={s.card}><Text style={s.cardTitle}>{book.title}</Text><Text style={s.body}>{book.subtitle}</Text></Pressable>)}
    {page && !page.entries.length ? <Text style={s.body}>{deleted ? "回收站没有作品。" : "选一些记忆，做成第一本家庭书。"}</Text> : null}
    {page?.nextCursor ? <Button title="更多作品" onPress={() => void load(page.nextCursor!)} /> : null}
    <Disclosure title="管理"><Button title={deleted ? "返回家庭书" : "作品回收站"} onPress={() => { setDeleted(value => !value); setCreating(false); }} /><Button title="刷新" onPress={() => void load()} /></Disclosure>
  </ScrollView>;
}
export function BookDetailScreen({
  navigation,
  route,
}: NativeStackScreenProps<RootStackParamList, "BookDetail">) {
  const { credentials } = useApp();
  const id = route.params.id;
  const [book, setBook] = useState<BookDetail | null>(null),
    [error, setError] = useState(""),
    [dirty, setDirty] = useState(false),
    [saving, setSaving] = useState(false),
    [operation, setOperation] = useState(false),
    [editing, setEditing] = useState(false),
    [tool, setTool] = useState<"content" | "layout" | "settings">("content"),
    [activeBlock, setActiveBlock] = useState<string | null>(null),
    [chapterIndex, setChapterIndex] = useState(0),
    [blockPage, setBlockPage] = useState(0),
    [selecting, setSelecting] = useState(false),
    [materialKind, setMaterialKind] = useState<
      "memory" | "collection"
    >("memory"),
    [materials, setMaterials] = useState<BookMaterials | null>(null),
    [selected, setSelected] = useState<string[]>([]),
    [coverPicker, setCoverPicker] = useState(false);
  const current = useRef(book),
    sequence = useRef(0),
    savedSequence = useRef(0),
    inflight = useRef<Promise<boolean> | null>(null),
    scroll = useRef<ScrollView>(null),
    materialGeneration = useRef(0);
  function accept(doc: BookDetail) {
    current.current = doc;
    setBook(doc);
    savedSequence.current = sequence.current;
    setDirty(false);
    setError("");
  }
  const load = useCallback(async () => {
    if (!credentials) return;
    try {
      const doc = await fetchBook(credentials, id);
      current.current = doc;
      setBook(doc);
      savedSequence.current = sequence.current;
      setDirty(false);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [credentials, id]);
  useFocusEffect(
    useCallback(() => {
      if (sequence.current === savedSequence.current) void load();
    }, [load]),
  );
  const save = useCallback(async (): Promise<boolean> => {
    if (inflight.current) {
      if (!(await inflight.current)) return false;
    }
    const doc = current.current;
    if (!credentials || !doc) return false;
    if (savedSequence.current === sequence.current) return true;
    const sent = sequence.current;
    setSaving(true);
    const request = (async () => {
      try {
        const result = await mutateBook(credentials, id, {
          operation: "save",
          revision: doc.revision,
          edit: doc,
        });
        savedSequence.current = sent;
        if (sequence.current === sent) {
          current.current = result;
          setBook(result);
          setDirty(false);
        } else {
          current.current = {
            ...current.current!,
            revision: result.revision,
            sourceStates: result.sourceStates,
          };
          setBook(current.current);
        }
        setError("");
        return true;
      } catch (e) {
        setError((e as Error).message);
        return false;
      } finally {
        setSaving(false);
        inflight.current = null;
      }
    })();
    inflight.current = request;
    return request;
  }, [credentials, id]);
  useEffect(() => {
    if (!dirty || error || operation) return;
    const timer = setTimeout(() => void save(), 900);
    return () => clearTimeout(timer);
  }, [book, dirty, error, operation, save]);
  usePreventRemove(dirty, ({ data }) =>
    Alert.alert("还有未保存修改", "保存失败或冲突时，你的输入会保留在此页。", [
      { text: "继续编辑", style: "cancel" },
      {
        text: "放弃本次修改",
        style: "destructive",
        onPress: () => navigation.dispatch(data.action),
      },
      {
        text: "保存后返回",
        onPress: () => {
          setOperation(true);
          void save()
            .then((ok) => {
              if (ok) navigation.dispatch(data.action);
            })
            .finally(() => setOperation(false));
        },
      },
    ]),
  );
  function update(patch: Partial<BookDetail>) {
    if (!current.current || operation) return;
    const next = { ...current.current, ...patch };
    current.current = next;
    sequence.current++;
    setBook(next);
    setDirty(true);
  }
  async function act(op: string, extra: Record<string, unknown> = {}) {
    if (!credentials) return;
    setOperation(true);
    try {
      if (!(await save())) return;
      const next = await mutateBook(credentials, id, {
        operation: op, revision: current.current!.revision, ...extra,
      });
      if (op === "copy") navigation.replace("BookDetail", {id:next.id});
      else accept(next);
      if (op === "add") {
        setSelecting(false);
        setSelected([]);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOperation(false);
    }
  }
  const audience = book?.audience;
  const loadMaterials = useCallback(
    async (cursor = "") => {
      if (!credentials || !audience) return;
      const gen = ++materialGeneration.current;
      try {
        const next = await fetchBookMaterials(
          credentials,
          materialKind,
          audience,
          cursor,
        );
        if (gen !== materialGeneration.current) return;
        setMaterials((p) =>
          cursor && p
            ? { ...next, entries: [...p.entries, ...next.entries] }
            : next,
        );
      } catch (e) {
        if (gen === materialGeneration.current) setError((e as Error).message);
      }
    },
    [credentials, materialKind, audience],
  );
  useEffect(() => {
    if (selecting) void Promise.resolve().then(() => loadMaterials());
  }, [selecting, loadMaterials]);
  function patchBlock(block: BookBlock, patch: Partial<BookBlock>) {
    update({
      blocks: book!.blocks.map((b) =>
        b.id === block.id ? { ...b, ...patch } : b,
      ),
    });
  }
  function moveBlock(block: BookBlock, delta: number) {
    const blocks = [...book!.blocks],
      siblings = blocks.filter((b) => b.chapterId === block.chapterId),
      index = siblings.findIndex((b) => b.id === block.id),
      target = siblings[index + delta];
    if (!target) return;
    const a = blocks.findIndex((b) => b.id === block.id),
      b = blocks.findIndex((b) => b.id === target.id);
    [blocks[a], blocks[b]] = [blocks[b]!, blocks[a]!];
    update({ blocks });
  }
  if (!book)
    return (
      <View style={s.content}>
        <Text accessibilityRole="alert">{error || "正在打开作品…"}</Text>
        <Button title="重试" onPress={() => void load()} />
      </View>
    );
  const chapter =
      book.chapters[
        Math.min(chapterIndex, Math.max(0, book.chapters.length - 1))
      ],
    allBlocks = book.blocks.filter((b) => b.chapterId === chapter?.id),
    visibleBlocks = allBlocks.slice(blockPage * 8, blockPage * 8 + 8),
    canEdit = book.canWrite && !book.deletedAt,
    busy = operation;
  const imageRefs = book.sources.filter(
    (r) =>
      book.sourceStates[r.id]?.available &&
      book.sourceStates[r.id]?.asset?.type === "image",
  );
  const photo = (
    assetId: string,
    caption: string,
    fit: "contain" | "cover" = "contain",
    focus?: { x: number; y: number },
  ) =>
    credentials ? (
      <FocusedImage
        label={caption || "作品照片"}
        source={{
          uri: `${credentials.serverUrl}/api/media/${assetId}`,
          headers: { Authorization: `Bearer ${credentials.token}` },
        }}
        fit={fit}
        focus={focus}
      />
    ) : null;
  return (
    <ScrollView
      ref={scroll}
      style={s.screen}
      contentContainerStyle={s.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={s.eyebrow}>
        {book.audience === "family" ? "家庭可读版" : "我的私人阅读版"}
      </Text>
      <Text style={s.title}>{book.title}</Text>
      <Text style={s.body}>{book.subtitle}</Text>
      <Text accessibilityLiveRegion="polite" style={s.body}>
        {saving
          ? "正在保存…"
          : dirty
            ? "有未保存修改"
            : `已保存 · 版本 ${book.revision}`}
      </Text>
      {error ? (
        <View style={s.notice}>
          <Text accessibilityRole="alert" style={s.error}>
            {error}
          </Text>
          <Button
            title="重试保存"
            onPress={() => void save()}
            disabled={busy}
          />
          <Button
            title="重新载入服务器版本"
            onPress={() =>
              Alert.alert("重新载入", "将放弃此页尚未保存的输入。", [
                { text: "保留输入", style: "cancel" },
                { text: "重新载入", onPress: () => void load() },
              ])
            }
            disabled={busy || saving}
          />
        </View>
      ) : null}
      <Disclosure title="导出与下载">
      {!book.deletedAt ? <ReadingDownloadButton kind="book" id={id} prepare={async () => { setOperation(true); try { return await save() && sequence.current === savedSequence.current; } finally { setOperation(false); } }} /> : null}
      {credentials && !book.deletedAt ? (
        <NativeBookPublication credentials={credentials} id={id} audience={book.audience}
          prepare={async () => {
            setOperation(true);
            try { return await save() && sequence.current === savedSequence.current ? current.current!.revision : null; }
            finally { setOperation(false); }
          }} />
      ) : null}
      </Disclosure>
      {canEdit ? (
        <>
          <Button
            title={editing ? "阅读作品" : "编辑"}
            disabled={busy}
            onPress={() => {
              if (editing) {
                setOperation(true);
                void save()
                  .then(async (ok) => {
                    if (ok && credentials) {
                      accept(await fetchBook(credentials, id));
                      setEditing(false);
                    }
                  })
                  .catch((e) => setError((e as Error).message))
                  .finally(() => setOperation(false));
              } else setEditing(true);
            }}
          />
          {editing && tool === "content" ? <Button
            title={selecting ? "关闭选材" : "添加记忆或相册"}
            disabled={busy}
            onPress={() => {
              setSelected([]);
              setMaterials(null);
              setSelecting(!selecting);
            }}
          /> : null}
        </>
      ) : null}
      {editing && canEdit ? <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {(["content", "layout", "settings"] as const).map((value, i) => <Pressable key={value} accessibilityRole="tab" accessibilityState={{ selected: tool === value }} onPress={() => setTool(value)} style={tool === value ? s.primaryButton : s.secondaryButton}><Text style={tool === value ? s.primaryText : s.secondaryText}>{["内容", "版式", "整本设置"][i]}</Text></Pressable>)}
      </View> : null}
      {selecting && canEdit && editing && tool === "content" ? (
        <View style={s.card}>
          <Text style={s.cardTitle}>从已确认内容选材</Text>
          {(["memory", "collection"] as const).map((kind, i) => (
            <Button
              key={kind}
              title={`${materialKind === kind ? "✓ " : ""}${["记忆", "相册"][i]}`}
              disabled={busy}
              onPress={() => {
                setSelected([]);
                setMaterials(null);
                setMaterialKind(kind);
              }}
            />
          ))}
          {materials?.entries.map((m) => (
            <Button
              key={m.id}
              title={`${selected.includes(m.id) ? "✓ " : ""}${m.title}`}
              disabled={busy}
              onPress={() =>
                setSelected((v) =>
                  v.includes(m.id) ? v.filter((x) => x !== m.id) : [...v, m.id],
                )
              }
            />
          ))}
          {materials?.nextCursor ? (
            <Button
              title="更多素材"
              onPress={() => void loadMaterials(materials.nextCursor!)}
              disabled={busy}
            />
          ) : null}
          <Button
            title={`加入 ${selected.length} 项`}
            disabled={busy || !selected.length}
            onPress={() =>
              void act("add", {
                selection: selected.map((id) => ({ kind: materialKind, id })),
              })
            }
          />
        </View>
      ) : null}
      {editing && canEdit && tool === "settings" ? (
        <View style={s.card}>
          <Field
            label="作品标题"
            value={book.title}
            onChange={(title) => update({ title })}
            disabled={busy}
          />
          <Field
            label="副标题"
            value={book.subtitle}
            onChange={(subtitle) => update({ subtitle })}
            disabled={busy}
          />
          <Field
            label="开始日期 YYYY-MM-DD"
            value={book.startDate || ""}
            onChange={(startDate) => update({ startDate: startDate || null })}
            disabled={busy}
          />
          <Field
            label="结束日期 YYYY-MM-DD"
            value={book.endDate || ""}
            onChange={(endDate) => update({ endDate: endDate || null })}
            disabled={busy}
          />
          {BOOK_TEMPLATES.filter(t => t.id !== "letters" || book.template === "letters").map((t) => (
            <Button
              key={t.id}
              title={`${book.template === t.id ? "✓ " : ""}${t.title}`}
              disabled={busy}
              onPress={() => update({ template: t.id })}
            />
          ))}
          <Button
            title={`纸张 ${book.pageSize}`}
            disabled={busy}
            onPress={() =>
              update({ pageSize: book.pageSize === "A4" ? "A5" : "A4" })
            }
          />
          <Button
            title={`封面：${imageRefs.find((r) => r.assetId === book.coverAssetId)?.label ?? "未设置"}${coverPicker ? " ∨" : " ›"}`}
            disabled={busy}
            onPress={() => setCoverPicker(!coverPicker)}
          />
          {coverPicker ? (
            <View style={{ gap: 5 }}>
              <Button
                title={`${book.coverAssetId ? "" : "✓ "}无封面（默认）`}
                disabled={busy}
                onPress={() => {
                  update({ coverAssetId: null });
                  setCoverPicker(false);
                }}
              />
              {imageRefs.map((r) => (
                <Button
                  key={r.id}
                  title={`${book.coverAssetId === r.assetId ? "✓ " : ""}${r.label}`}
                  disabled={busy}
                  onPress={() => {
                    update({ coverAssetId: r.assetId });
                    setCoverPicker(false);
                  }}
                />
              ))}
            </View>
          ) : null}
          <Button
            title="添加章节"
            disabled={busy || book.chapters.length >= 50}
            onPress={() => {
              update({
                chapters: [
                  ...book.chapters,
                  { id: randomUUID(), title: "新的章节" },
                ],
              });
              setChapterIndex(book.chapters.length);
              setBlockPage(0);
            }}
          />
        </View>
      ) : null}
      {book.coverAssetId
        ? photo(
            book.sourceStates[
              book.sources.find((r) => r.assetId === book.coverAssetId)?.id ||
                ""
            ]?.asset?.previewAssetId || book.coverAssetId,
            "封面照片",
          )
        : null}
      <Disclosure title="目录">
        {book.chapters.map((c, i) => (
          <Button
            key={c.id}
            title={`${i + 1}. ${c.title}${c.id === chapter?.id ? " · 当前" : ""}`}
            onPress={() => {
              setChapterIndex(i);
              setBlockPage(0);
              scroll.current?.scrollTo({ y: 0, animated: false });
            }}
          />
        ))}
      </Disclosure>
      {chapter ? (
        <>
          <Text style={s.title}>{chapter.title}</Text>
          {editing && canEdit && tool === "content" ? (
            <Disclosure title="编辑章节"><View style={s.card}>
              <Field
                label="章节标题"
                value={chapter.title}
                onChange={(title) =>
                  update({
                    chapters: book.chapters.map((c) =>
                      c.id === chapter.id ? { ...c, title } : c,
                    ),
                  })
                }
                disabled={busy}
              />
              {[-1, 1].map((delta) => (
                <Button
                  key={delta}
                  title={delta < 0 ? "章节上移" : "章节下移"}
                  disabled={
                    busy ||
                    chapterIndex + delta < 0 ||
                    chapterIndex + delta >= book.chapters.length
                  }
                  onPress={() => {
                    const chapters = [...book.chapters];
                    [chapters[chapterIndex], chapters[chapterIndex + delta]] = [
                      chapters[chapterIndex + delta]!,
                      chapters[chapterIndex]!,
                    ];
                    update({ chapters });
                    setChapterIndex(chapterIndex + delta);
                  }}
                />
              ))}
              <Button
                title="删除章节及其内容"
                disabled={busy}
                onPress={() =>
                  Alert.alert("删除章节", "只移除本作品的内容，源记忆保留。", [
                    { text: "取消", style: "cancel" },
                    {
                      text: "删除",
                      style: "destructive",
                      onPress: () => {
                        update({
                          chapters: book.chapters.filter(
                            (c) => c.id !== chapter.id,
                          ),
                          blocks: book.blocks.filter(
                            (b) => b.chapterId !== chapter.id,
                          ),
                        });
                        setChapterIndex(0);
                        setBlockPage(0);
                      },
                    },
                  ])
                }
              />
              <Button
                title="插入文字页"
                disabled={busy}
                onPress={() => {
                  update({
                    blocks: [
                      ...book.blocks,
                      {
                        id: randomUUID(),
                        chapterId: chapter.id,
                        kind: "text",
                        text: "",
                        caption: "",
                        layout: defaultBookLayout(),
                        sourceIds: [],
                      },
                    ],
                  });
                  setBlockPage(Math.floor(allBlocks.length / 8));
                }}
              />
            </View></Disclosure>
          ) : null}
        </>
      ) : null}
      {visibleBlocks.map((b) => {
        const blocked = book.blockedBlockIds.includes(b.id),
          index = allBlocks.findIndex((x) => x.id === b.id),
          images = b.sourceIds
            .flatMap((r) => {
              const a = book.sourceStates[r]?.asset;
              return a?.type === "image" ? [a] : [];
            })
            .slice(0, b.kind === "double" ? 2 : b.kind === "collage" ? 4 : 1);
        return (
          <View
            key={b.id}
            style={[
              s.card,
              book.template === "letters" && {
                borderLeftWidth: 4,
                borderLeftColor: colors.coral,
              },
            ]}
          >
            {editing && canEdit && tool !== "settings" ? <Button title={activeBlock === b.id ? "收起此内容" : "选择此内容"} onPress={() => setActiveBlock(value => value === b.id ? null : b.id)} /> : null}
            {blocked ? (
              <Text style={s.body}>来源已删除或当前不可见，内容已撤下。</Text>
            ) : (
              <>
                {images.map((a, slot) => (
                  <View key={a.id}>
                    {photo(
                      a.previewAssetId || a.id,
                      b.caption || a.filename,
                      b.layout.fit,
                      b.layout.focus[slot],
                    )}
                  </View>
                ))}
                {b.kind === "date" ? (
                  <Text>
                    {b.sourceIds
                      .map((r) => book.sourceStates[r])
                      .filter((r) => r?.occurredAt)
                      .map(
                        (r) =>
                          `${new Intl.DateTimeFormat("zh-CN", { timeZone: book.timezone, dateStyle: "long" }).format(new Date(r!.occurredAt!))} ${r?.ageLabel || ""}`,
                      )
                      .join(" · ")}
                  </Text>
                ) : null}
                <Text
                  selectable
                  style={{
                    fontSize: b.kind === "quote" ? 19 : 16,
                    lineHeight: 28,
                    color: colors.ink,
                  }}
                >
                  {b.text}
                </Text>
                {b.caption ? <Text style={s.body}>{b.caption}</Text> : null}
                <Disclosure title="查看来源">{b.sourceIds.map((r) => {
                  const ref = book.sources.find((s) => s.id === r);
                  return ref?.memoryEventId ? (
                    <Button
                      key={r}
                      title={`来源：${book.sourceStates[r]?.label || "原始记忆"}`}
                      onPress={() =>
                        navigation.navigate("Memory", {
                          id: ref.memoryEventId!,
                        })
                      }
                    />
                  ) : null;
                })}</Disclosure>
                {editing && canEdit && activeBlock === b.id && tool !== "settings" ? (
                  <>
                    {tool === "content" ? <>
                    <Field
                      label="正文"
                      value={b.text}
                      onChange={(text) => patchBlock(b, { text })}
                      disabled={busy}
                      multiline
                    />
                    <Field
                      label="图片说明"
                      value={b.caption}
                      onChange={(caption) => patchBlock(b, { caption })}
                      disabled={busy}
                    />
                    </> : null}
                    {tool === "layout" ? <>
                    {(
                      [
                        "text",
                        "image",
                        "double",
                        "collage",
                        "quote",
                        "date",
                      ] as const
                    ).map((kind, i) => (
                      <Button
                        key={kind}
                        title={`${b.kind === kind ? "✓ " : ""}${["文字", "单图", "双图", "拼图", "引文", "日期年龄"][i]}`}
                        onPress={() => patchBlock(b, { kind })}
                        disabled={busy}
                      />
                    ))}
                    <Button
                      title={
                        b.layout.fit === "contain"
                          ? "图片完整显示"
                          : "图片填满版面"
                      }
                      disabled={busy}
                      onPress={() =>
                        patchBlock(b, {
                          layout: {
                            ...b.layout,
                            fit:
                              b.layout.fit === "contain" ? "cover" : "contain",
                          },
                        })
                      }
                    />
                    <Button
                      title={
                        b.layout.breakBefore ? "另起一页：开" : "另起一页：关"
                      }
                      disabled={busy}
                      onPress={() =>
                        patchBlock(b, {
                          layout: {
                            ...b.layout,
                            breakBefore: !b.layout.breakBefore,
                          },
                        })
                      }
                    />
                    {["image", "double", "collage"].includes(b.kind)
                      ? imageRefs.map((r) => (
                          <Button
                            key={r.id}
                            title={`${b.sourceIds.includes(r.id) ? "移除" : "加入"}照片：${r.label}`}
                            disabled={busy}
                            onPress={() =>
                              patchBlock(b, {
                                sourceIds: b.sourceIds.includes(r.id)
                                  ? b.sourceIds.filter((x) => x !== r.id)
                                  : [...b.sourceIds, r.id],
                              })
                            }
                          />
                        ))
                      : null}
                    {images.map((asset, slot) => <View key={asset.id} style={{ gap: 8 }}><Text style={s.label}>图片 {slot + 1} 裁切焦点</Text>{(["x", "y"] as const).map(axis => <View key={axis} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}><Text>{axis === "x" ? "水平" : "垂直"} {Math.round((b.layout.focus[slot]?.[axis] ?? 0.5) * 100)}%</Text>{[-0.1, 0.1].map(delta => <Pressable key={delta} accessibilityRole="button" accessibilityLabel={`图片 ${slot + 1} ${axis === "x" ? "水平" : "垂直"}${delta < 0 ? "减少" : "增加"}`} disabled={busy} onPress={() => patchBlock(b, { layout: { ...b.layout, focus: b.layout.focus.map((focus, i) => i === slot ? { ...focus, [axis]: Math.max(0, Math.min(1, Math.round((focus[axis] + delta) * 10) / 10)) } : focus) } })} style={s.secondaryButton}><Text style={s.secondaryText}>{delta < 0 ? "−" : "+"}</Text></Pressable>)}</View>)}</View>)}
                    </> : null}
                  </>
                ) : null}
              </>
            )}
            {book.warnings
              .filter((w) => w.blockId === b.id)
              .map((w, i) => (
                <Text key={i} style={s.body}>
                  {
                    {
                      missing_source: "缺少可见来源",
                      source_changed: "来源有更新，手工编辑保持不变",
                      low_resolution: "照片分辨率偏低",
                      long_text: "长文请在出版预览核对分页",
                      empty_block: "此内容为空",
                      empty_chapter: "章节为空",
                    }[w.code]
                  }
                </Text>
              ))}
            {editing && canEdit && activeBlock === b.id && tool === "content" ? (
              <>
                <Button
                  title="内容上移"
                  disabled={busy || index === 0}
                  onPress={() => moveBlock(b, -1)}
                />
                <Button
                  title="内容下移"
                  disabled={busy || index === allBlocks.length - 1}
                  onPress={() => moveBlock(b, 1)}
                />
                <Button
                  title="删除此内容"
                  disabled={busy}
                  onPress={() =>
                    update({ blocks: book.blocks.filter((x) => x.id !== b.id) })
                  }
                />
              </>
            ) : null}
          </View>
        );
      })}
      {!allBlocks.length ? (
        <Text style={s.body}>这一章还没有内容，可以从已有记忆选材。</Text>
      ) : null}
      <Text style={s.body}>
        第 {blockPage + 1} / {Math.max(1, Math.ceil(allBlocks.length / 8))} 段
      </Text>
      <Button
        title="上一段"
        disabled={blockPage === 0}
        onPress={() => {
          setBlockPage(blockPage - 1);
          scroll.current?.scrollTo({ y: 0, animated: false });
        }}
      />
      <Button
        title="下一段"
        disabled={(blockPage + 1) * 8 >= allBlocks.length}
        onPress={() => {
          setBlockPage(blockPage + 1);
          scroll.current?.scrollTo({ y: 0, animated: false });
        }}
      />
      <Disclosure title="作品管理">
      {canEdit ? <>
          <Button title="复制成新册" disabled={busy} onPress={()=>void act("copy")} />
          <Button title={book.status==="finished"?"重新列为正在制作":"标记制作完成"} disabled={busy} onPress={()=>void act(book.status==="finished"?"reopen":"finish")} />
          <Button
            title="保存版本快照"
            disabled={busy}
            onPress={() => void act("snapshot")}
          />
          <Disclosure title="版本记录">{book.versions.map(version => <Button key={version.revision} title={`恢复版本 ${version.revision}`} disabled={busy} onPress={() => Alert.alert("恢复版本", "当前排版会先保存为一个版本，再恢复所选排版。", [{ text: "取消", style: "cancel" }, { text: "恢复", onPress: () => void act("restore_version", { version: version.revision }) }])} />)}</Disclosure>
      </> : null}
      {book.canWrite ? (
        <Button
          title={book.deletedAt ? "恢复作品" : "删除作品"}
          disabled={busy}
          onPress={() =>
            Alert.alert(
              book.deletedAt ? "恢复作品" : "删除作品",
              "源记忆、讲述和原件保持完整。",
              [
                { text: "取消", style: "cancel" },
                {
                  text: "确认",
                  onPress: () =>
                    void act(book.deletedAt ? "restore" : "delete"),
                },
              ],
            )
          }
        />
      ) : null}
      </Disclosure>
    </ScrollView>
  );
}
