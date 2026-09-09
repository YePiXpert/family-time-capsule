"use client";
import { WorkCreator } from "./work-creator";
import { BookRenderPanel } from "./book-render-panel";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type {
  BookAudience,
  BookBlock,
  BookDetail,
  BookPage,
  BookTemplate,
} from "@/mobile/src/books/types";
import { BOOK_TEMPLATES, defaultBookLayout } from "@/mobile/src/books/types";
import { BookPreview } from "./book-preview";
const field =
  "min-h-11 w-full rounded-xl border border-line bg-surface px-3 py-2";
const errorMessages: Record<string, string> = {
  revision_conflict:
    "其他家人已修改这份作品。你的输入仍保留，请先复制未保存文字，再读取最新版本。",
  source_unavailable:
    "部分来源已删除或不在这份作品的读者范围内。整批操作没有写入。",
  forbidden: "当前账号没有编辑权限。",
  book_too_large: "作品超过当前编辑上限，请分成两册继续整理。",
  invalid_cover: "请从作品中当前可见的照片选择封面。",
  book_deleted: "作品已移入回收站。",
  draft_exists: "这个范围已有另一份进行中的草稿，请先完成或整理那一份。",
  audience_locked: "作品读者范围不能直接切换。请按目标读者范围重新选材。",
};
async function request<T>(
  url: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(url, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: body === undefined ? {} : { "content-type": "application/json" },
    cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      errorMessages[data.error] || "暂时无法保存，请重试。未保存输入仍保留。",
    );
  return data;
}
export function BookShelf() {
  const [page, setPage] = useState<BookPage | null>(null);
  const [deleted, setDeleted] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async (cursor = "") => {
    try {
      const next = await request<BookPage>(`/api/books/projects?${new URLSearchParams({ deleted: deleted ? "1" : "0", cursor })}`);
      setPage(old => cursor && old ? { ...next, entries: [...old.entries, ...next.entries] } : next); setError("");
    } catch (e) { setError((e as Error).message); }
  }, [deleted]);
  useEffect(() => { const timer = setTimeout(() => void load(), 0); return () => clearTimeout(timer); }, [load]);
  return <section aria-label="家庭书" className="mt-4 space-y-4">
    <div className="flex items-start justify-between gap-3">
      {page?.canWrite && !deleted && !creating ? <button className="ui-button-primary" onClick={() => setCreating(true)}>新建家庭书</button> : <span />}
      <details><summary className="ui-text-link cursor-pointer">管理</summary><button className="ui-button-secondary" onClick={() => { setDeleted(value => !value); setCreating(false); }}>{deleted ? "返回家庭书" : "作品回收站"}</button></details>
    </div>
    {creating ? <WorkCreator kind="book" onCancel={() => setCreating(false)} /> : null}
    {error ? <p role="alert">{error}<button className="ui-text-link ml-3" onClick={() => void load()}>重试</button></p> : null}
    <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{page?.entries.map(book => <li key={book.id}><Link href={`/books/${book.id}`} className="block rounded-2xl border border-line p-5"><h2 className="text-xl">{book.title}</h2><p className="mt-2 text-sm text-muted">{book.subtitle}</p></Link></li>)}</ol>
    {page && !page.entries.length ? <p className="text-muted">{deleted ? "回收站没有作品。" : "选一些记忆，做成第一本家庭书。"}</p> : null}
    {page?.nextCursor ? <button className="ui-button-secondary" onClick={() => void load(page.nextCursor!)}>更多作品</button> : null}
  </section>;
}
export function BookEditor({ id }: { id: string }) {
  const router = useRouter();
  const [book, setBook] = useState<BookDetail | null>(null),
    [error, setError] = useState(""),
    [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false),
    [paused, setPaused] = useState(false),
    [sequence, setSequence] = useState(0),
    [reading, setReading] = useState(true),
    [operationBusy, setOperationBusy] = useState(false),
    [tool, setTool] = useState<"content" | "layout" | "settings">("content"),
    [activeBlock, setActiveBlock] = useState<string | null>(null),
    [dragBlockId, setDragBlockId] = useState<string | null>(null),
    [dropHint, setDropHint] = useState<{ id: string; after: boolean } | null>(
      null,
    );
  const current = useRef<BookDetail | null>(null),
    editSequence = useRef(0),
    savedSequence = useRef(0),
    saving = useRef(false),
    serverRevision = useRef(0);
  function accept(next: BookDetail) {
    current.current = next;
    setBook(next);
    serverRevision.current = next.revision;
    editSequence.current = 0;
    savedSequence.current = 0;
    setSequence(0);
    setPaused(false);
    setError("");
  }
  const load = useCallback(async () => {
    try {
      const next = await request<BookDetail>(`/api/books/projects/${id}`);
      current.current = next;
      setBook(next);
      serverRevision.current = next.revision;
      editSequence.current = 0;
      savedSequence.current = 0;
      setSequence(0);
      setPaused(false);
      setError("");
      setStatus("已读取保存内容");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);
  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);
  const save = useCallback(async () => {
    if (!current.current || saving.current) return false;
    if (savedSequence.current === editSequence.current) return true;
    saving.current = true;
    setBusy(true);
    const sentSequence = editSequence.current;
    try {
      const next = await request<BookDetail>(
        `/api/books/projects/${id}`,
        "PATCH",
        {
          operation: "save",
          revision: serverRevision.current,
          edit: current.current,
        },
      );
      serverRevision.current = next.revision;
      savedSequence.current = sentSequence;
      const value =
        editSequence.current === sentSequence
          ? next
          : {
              ...current.current,
              revision: next.revision,
              updatedAt: next.updatedAt,
              sourceStates: next.sourceStates,
              versions: next.versions,
            };
      current.current = value;
      setBook(value);
      setStatus(
        editSequence.current === sentSequence
          ? "已自动保存，可以随时重开。"
          : "继续保存新修改…",
      );
      setError("");
      setPaused(false);
      return true;
    } catch (e) {
      setError((e as Error).message);
      setStatus("自动保存已暂停，输入仍保留。");
      setPaused(true);
      return false;
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }, [id]);
  useEffect(() => {
    if (paused || busy || sequence === savedSequence.current) return;
    const timer = setTimeout(() => void save(), 900);
    return () => clearTimeout(timer);
  }, [sequence, paused, busy, save]);
  useEffect(() => {
    return () => {
      if (editSequence.current !== savedSequence.current) void save();
    };
  }, [save]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (editSequence.current !== savedSequence.current) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  function update(patch: Partial<BookDetail>) {
    if (!current.current) return;
    const next = { ...current.current, ...patch };
    current.current = next;
    setBook(next);
    editSequence.current++;
    setSequence(editSequence.current);
    setStatus(
      paused ? "自动保存已暂停，请点「重试保存」。" : "有修改，正在等待保存…",
    );
  }
  async function operation(
    operation: string,
    extra: Record<string, unknown> = {},
  ) {
    if (saving.current) return;
    setOperationBusy(true);
    try {
      if (!(await save())) return;
      setBusy(true);
      const next = await request<BookDetail>(
        `/api/books/projects/${id}`,
        "PATCH",
        { operation, revision: serverRevision.current, ...extra },
      );
      if (operation === "copy") { router.push(`/books/${next.id}`); return; }
      accept(next);
      setStatus(operation === "snapshot" ? "已保存版本快照。" : "已保存。");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setOperationBusy(false);
    }
  }
  function updateBlock(blockId: string, patch: Partial<BookBlock>) {
    if (book)
      update({
        blocks: book.blocks.map((b) =>
          b.id === blockId ? { ...b, ...patch } : b,
        ),
      });
  }
  function moveBlock(blockId: string, delta: number) {
    if (!book) return;
    const blocks = [...book.blocks],
      index = blocks.findIndex((b) => b.id === blockId),
      siblings = blocks.filter((b) => b.chapterId === blocks[index]?.chapterId),
      siblingIndex = siblings.findIndex((b) => b.id === blockId),
      nextId = siblings[siblingIndex + delta]?.id,
      next = blocks.findIndex((b) => b.id === nextId);
    if (next < 0 || next >= blocks.length) return;
    [blocks[index], blocks[next]] = [blocks[next]!, blocks[index]!];
    update({ blocks });
  }
  function reorderBlock(sourceId: string, targetId: string, after: boolean) {
    if (!book || sourceId === targetId) return;
    const source = book.blocks.find((b) => b.id === sourceId),
      target = book.blocks.find((b) => b.id === targetId);
    if (!source || !target || source.chapterId !== target.chapterId) return;
    const blocks = book.blocks.filter((b) => b.id !== sourceId);
    let index = blocks.findIndex((b) => b.id === targetId);
    if (after) index++;
    blocks.splice(index, 0, source);
    update({ blocks });
  }
  async function preview() {
    setOperationBusy(true);
    try {
      if (!(await save())) return;
      setReading(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOperationBusy(false);
    }
  }
  if (!book)
    return (
      <div className="page-container">
        <p role="alert">{error || "正在打开作品…"}</p>
        <button className="ui-button-secondary" onClick={() => void load()}>
          重试
        </button>
      </div>
    );
  const canEdit = book.canWrite && !book.deletedAt;
  const assets = book.sources.filter(
    (s) =>
      s.kind === "asset" &&
      book.sourceStates[s.id]?.available &&
      book.sourceStates[s.id]?.asset?.type === "image",
  );
  return (
    <main className="page-container max-w-6xl">
      <Link
        className="ui-text-link inline-flex min-h-11 items-center"
        href="/books"
        onNavigate={(e) => {
          if (editSequence.current !== savedSequence.current) {
            e.preventDefault();
            setError("请先保存修改，再返回书架。");
          }
        }}
      >
        返回书架
      </Link>
      <h1 className="mt-3 break-words text-3xl">{book.title}</h1>
      <p className="my-2 text-sm text-muted">
        {book.audience === "family" ? "家庭可读版" : "我的私人阅读版"} · 修订{" "}
        {book.revision}
        {book.deletedAt ? " · 在作品回收站中" : ""}
      </p>
      <p role="status" className="my-3 text-sm text-muted">
        {status}
      </p>
      {error ? (
        <div role="alert" className="my-4 rounded-xl border border-line p-4">
          <p>{error}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              className="ui-button-secondary"
              disabled={busy}
              onClick={() => void save()}
            >
              重试保存
            </button>
            <button
              className="ui-button-secondary"
              disabled={busy}
              onClick={() => {
                if (
                  window.confirm(
                    "重新读取会替换未保存输入，请先复制需要保留的文字。",
                  )
                )
                  void load();
              }}
            >
              重新读取服务器版本
            </button>
          </div>
        </div>
      ) : null}
      {canEdit && reading ? <details className="my-4 rounded-2xl border border-line bg-surface p-4">
        <summary className="min-h-11 cursor-pointer py-2 font-medium">调整封面、寄语与收录内容</summary>
        <div className="mt-3 space-y-4">
          <label className="block">给宝宝的寄语<textarea className={`${field} mt-2 w-full`} rows={3} maxLength={500} value={book.subtitle} onChange={e => update({ subtitle: e.target.value })} placeholder="写几句想留给长大的你的话……" /></label>
          <label className="block">封面照片<select className={`${field} mt-2 w-full`} value={book.coverAssetId ?? ""} onChange={e => update({ coverAssetId: e.target.value || null })}><option value="">只用标题封面</option>{[...new Map(Object.values(book.sourceStates).filter(s => s.available && s.asset?.type === "image").map(s => [s.asset!.id, s])).values()].map((s, i) => <option key={s.asset!.id} value={s.asset!.id}>{`照片 ${i + 1} · ${s.asset!.filename}`}</option>)}</select></label>
          <div><p className="mb-2 text-sm text-muted">从本册移除不会删除原记录，之后也不会自动加回来。</p>{book.sources.filter(source => source.kind === "memory" && book.blocks.some(b => b.sourceIds.includes(source.id))).map(source => <div key={source.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-line py-2"><span>{book.sourceStates[source.id]?.label || "暂不可见的记录"}</span><button className="ui-button-secondary" onClick={() => update({ blocks: book.blocks.filter(b => !b.sourceIds.includes(source.id)) })}>从本册移除：{book.sourceStates[source.id]?.label || "这条记录"}</button></div>)}</div>
        </div>
      </details> : null}
      <div className="my-4 flex flex-wrap gap-3">
        {canEdit ? (
          <>
            {!reading ? <>
            <button
              className="ui-button-primary"
              disabled={busy}
              onClick={() => void save()}
            >
              保存当前编辑
            </button>
            </> : null}
            <button
              className="ui-button-secondary"
              disabled={busy}
              onClick={() => (reading ? setReading(false) : void preview())}
            >
              {reading ? "更多调整" : "预览作品"}
            </button>

          </>
        ) : null}
      </div>
      {canEdit && !reading ? <nav aria-label="编辑工具" className="my-4 flex gap-3">{(["content", "layout", "settings"] as const).map((value, i) => <button key={value} aria-pressed={tool === value} onClick={() => setTool(value)} className={tool === value ? "ui-button-primary" : "ui-button-secondary"}>{["内容", "版式", "整本设置"][i]}</button>)}</nav> : null}
      {canEdit && !reading ? (
        <div className="xl:grid xl:grid-cols-2 xl:items-start xl:gap-6">
          <div className="min-w-0">
            <fieldset disabled={operationBusy}>
          {tool === "settings" ? <section
            aria-label="作品信息"
            className="grid gap-4 rounded-2xl border border-line bg-surface p-4 sm:grid-cols-2"
          >
            <label>
              标题
              <input
                className={field}
                value={book.title}
                maxLength={200}
                onChange={(e) => update({ title: e.target.value })}
              />
            </label>
            <label>
              副标题
              <input
                className={field}
                value={book.subtitle}
                maxLength={500}
                onChange={(e) => update({ subtitle: e.target.value })}
              />
            </label>
            <label>
              模板
              <select
                className={field}
                value={book.template}
                onChange={(e) =>
                  update({ template: e.target.value as BookTemplate })
                }
              >
                {BOOK_TEMPLATES.filter(t => t.id !== "letters" || book.template === "letters").map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              纸张
              <select
                className={field}
                value={book.pageSize}
                onChange={(e) =>
                  update({ pageSize: e.target.value as "A4" | "A5" })
                }
              >
                <option>A5</option>
                <option>A4</option>
              </select>
            </label>
            <label>
              开始日期
              <input
                type="date"
                className={field}
                value={book.startDate || ""}
                onChange={(e) => update({ startDate: e.target.value || null })}
              />
            </label>
            <label>
              结束日期
              <input
                type="date"
                className={field}
                value={book.endDate || ""}
                onChange={(e) => update({ endDate: e.target.value || null })}
              />
            </label>
            <label>
              封面
              <select
                className={field}
                value={book.coverAssetId || ""}
                onChange={(e) =>
                  update({ coverAssetId: e.target.value || null })
                }
              >
                <option value="">不设图片封面</option>
                {assets.map((source) => (
                  <option key={source.id} value={source.assetId!}>
                    {book.sourceStates[source.id]?.label}
                  </option>
                ))}
              </select>
            </label>
          </section> : null}
          {tool === "content" ? <BookMaterialPicker
            audience={book.audience}
            disabled={busy}
            onAdd={(selection) => operation("add", { selection })}
          /> : null}
          {tool !== "settings" ? <section aria-label="章节与内容块" className="mt-7 space-y-5">
            <h2 className="text-2xl">章节与内容</h2>
            {book.chapters.map((chapter, chapterIndex) => (
              <section
                className="rounded-2xl border border-line p-4"
                key={chapter.id}
              >
                <details><summary className="min-h-11 cursor-pointer py-2">{chapter.title} · 编辑章节</summary>
                <label>
                  章节 {chapterIndex + 1} 名称
                  <input
                    className={field}
                    value={chapter.title}
                    maxLength={200}
                    onChange={(e) =>
                      update({
                        chapters: book.chapters.map((c) =>
                          c.id === chapter.id
                            ? { ...c, title: e.target.value }
                            : c,
                        ),
                      })
                    }
                  />
                </label>
                <div className="my-3 flex flex-wrap gap-2">
                  {[-1, 1].map((delta) => (
                    <button
                      key={delta}
                      className="ui-button-secondary"
                      disabled={
                        chapterIndex + delta < 0 ||
                        chapterIndex + delta >= book.chapters.length
                      }
                      onClick={() => {
                        const chapters = [...book.chapters];
                        [
                          chapters[chapterIndex],
                          chapters[chapterIndex + delta],
                        ] = [
                          chapters[chapterIndex + delta]!,
                          chapters[chapterIndex]!,
                        ];
                        update({ chapters });
                      }}
                    >
                      {delta < 0 ? "章节上移" : "章节下移"}
                    </button>
                  ))}
                  <button
                    className="ui-button-secondary"
                    onClick={() => {
                      if (
                        window.confirm(
                          "移除章节及其中内容块？来源记忆不会删除。",
                        )
                      )
                        update({
                          chapters: book.chapters.filter(
                            (c) => c.id !== chapter.id,
                          ),
                          blocks: book.blocks.filter(
                            (b) => b.chapterId !== chapter.id,
                          ),
                        });
                    }}
                  >
                    删除章节
                  </button>
                </div>
                </details>
                {book.blocks
                  .filter((b) => b.chapterId === chapter.id)
                  .map((block, index) => {
                    const blocked = book.blockedBlockIds.includes(block.id),
                      imageRefs = block.sourceIds.filter((id) =>
                        book.sources.some(
                          (s) => s.id === id && s.kind === "asset",
                        ),
                      );
                    return (
                      <article
                        key={block.id}
                        className={`my-4 space-y-3 rounded-xl border border-line bg-surface p-4 ${
                          dropHint?.id === block.id
                            ? dropHint.after
                              ? "border-b-2 border-b-accent"
                              : "border-t-2 border-t-accent"
                            : ""
                        }`}
                        aria-label={`内容块 ${index + 1}`}
                        onDragOver={(e) => {
                          const source = book.blocks.find(
                            (b) => b.id === dragBlockId,
                          );
                          if (
                            !source ||
                            source.chapterId !== block.chapterId ||
                            dragBlockId === block.id
                          )
                            return;
                          e.preventDefault();
                          const rect = e.currentTarget.getBoundingClientRect(),
                            after = e.clientY > rect.top + rect.height / 2;
                          if (dropHint?.id !== block.id || dropHint.after !== after)
                            setDropHint({ id: block.id, after });
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          const sourceId =
                            dragBlockId ?? e.dataTransfer.getData("text/plain");
                          if (sourceId && dropHint)
                            reorderBlock(sourceId, dropHint.id, dropHint.after);
                          setDragBlockId(null);
                          setDropHint(null);
                        }}
                      >
                        <button className="ui-text-link" aria-expanded={activeBlock === block.id} onClick={() => setActiveBlock(value => value === block.id ? null : block.id)}>{block.text.slice(0, 80) || block.caption || `内容 ${index + 1}`} · {activeBlock === block.id ? "收起" : "编辑"}</button>
                        {activeBlock === block.id ? <>
                        <div>
                          <span
                            className="inline-flex min-h-8 cursor-grab items-center gap-1 text-sm text-muted select-none"
                            draggable
                            aria-label={`拖拽排序内容块 ${index + 1}`}
                            title="拖拽调整顺序"
                            onDragStart={(e) => {
                              e.dataTransfer.setData("text/plain", block.id);
                              e.dataTransfer.effectAllowed = "move";
                              setDragBlockId(block.id);
                            }}
                            onDragEnd={() => {
                              setDragBlockId(null);
                              setDropHint(null);
                            }}
                          >
                            ≡ 拖拽排序
                          </span>
                        </div>
                        {blocked ? (
                          <p>
                            来源当前不可见，原有编辑仍保存在服务器。可以移除此块，暂不能修改来源。
                          </p>
                        ) : (
                          <>
                            {tool === "layout" ? <label className="block">
                              版式
                              <select
                                className={field}
                                value={block.kind}
                                onChange={(e) =>
                                  updateBlock(block.id, {
                                    kind: e.target.value as BookBlock["kind"],
                                  })
                                }
                              >
                                {Object.entries({
                                  text: "文字",
                                  image: "单图",
                                  double: "双图",
                                  collage: "小型拼图",
                                  quote: "引文",
                                  date: "日期 / 年龄",
                                }).map(([value, label]) => (
                                  <option key={value} value={value}>
                                    {label}
                                  </option>
                                ))}
                              </select>
                            </label> : null}
                            {tool === "content" ? <>
                            <label className="block">
                              正文
                              <textarea
                                className={field}
                                rows={4}
                                maxLength={30000}
                                value={block.text}
                                onChange={(e) =>
                                  updateBlock(block.id, {
                                    text: e.target.value,
                                  })
                                }
                              />
                            </label>
                            <label className="block">
                              图片说明 / 署名
                              <textarea
                                className={field}
                                rows={2}
                                maxLength={2000}
                                value={block.caption}
                                onChange={(e) =>
                                  updateBlock(block.id, {
                                    caption: e.target.value,
                                  })
                                }
                              />
                            </label>
                            </> : null}
                            {tool === "layout" && ["image", "double", "collage"].includes(
                              block.kind,
                            ) ? (
                              <>
                                <p className="text-sm text-muted">
                                  先通过选材加入记忆，即可在这些照片之间换图。
                                </p>
                                {Array.from(
                                  {
                                    length:
                                      block.kind === "image"
                                        ? 1
                                        : block.kind === "double"
                                          ? 2
                                          : 4,
                                  },
                                  (_, slot) => (
                                    <div key={slot} className="space-y-2">
                                      <label className="block">
                                        图片 {slot + 1}
                                        <select
                                          className={field}
                                          value={imageRefs[slot] || ""}
                                          onChange={(e) => {
                                            const selected = [...imageRefs];
                                            selected[slot] = e.target.value;
                                            updateBlock(block.id, {
                                              sourceIds: [
                                                ...block.sourceIds.filter(
                                                  (id) =>
                                                    !imageRefs.includes(id),
                                                ),
                                                ...new Set(
                                                  selected.filter(Boolean),
                                                ),
                                              ],
                                            });
                                          }}
                                        >
                                          <option value="">尚未选择</option>
                                          {assets.map((source) => (
                                            <option
                                              key={source.id}
                                              value={source.id}
                                            >
                                              {
                                                book.sourceStates[source.id]
                                                  ?.label
                                              }
                                            </option>
                                          ))}
                                        </select>
                                      </label>
                                      <label className="block">
                                        图片 {slot + 1} 水平焦点
                                        <input
                                          aria-label={`图片 ${slot + 1} 水平焦点`}
                                          className="min-h-11 w-full"
                                          type="range"
                                          min="0"
                                          max="1"
                                          step="0.05"
                                          value={block.layout.focus[slot]!.x}
                                          onChange={(e) =>
                                            updateBlock(block.id, {
                                              layout: {
                                                ...block.layout,
                                                focus: block.layout.focus.map(
                                                  (f, i) =>
                                                    i === slot
                                                      ? {
                                                          ...f,
                                                          x: Number(
                                                            e.target.value,
                                                          ),
                                                        }
                                                      : f,
                                                ),
                                              },
                                            })
                                          }
                                        />
                                      </label>
                                      <label className="block">
                                        图片 {slot + 1} 垂直焦点
                                        <input
                                          aria-label={`图片 ${slot + 1} 垂直焦点`}
                                          className="min-h-11 w-full"
                                          type="range"
                                          min="0"
                                          max="1"
                                          step="0.05"
                                          value={block.layout.focus[slot]!.y}
                                          onChange={(e) =>
                                            updateBlock(block.id, {
                                              layout: {
                                                ...block.layout,
                                                focus: block.layout.focus.map(
                                                  (f, i) =>
                                                    i === slot
                                                      ? {
                                                          ...f,
                                                          y: Number(
                                                            e.target.value,
                                                          ),
                                                        }
                                                      : f,
                                                ),
                                              },
                                            })
                                          }
                                        />
                                      </label>
                                    </div>
                                  ),
                                )}
                                <label className="block">
                                  图片展示
                                  <select
                                    className={field}
                                    value={block.layout.fit}
                                    onChange={(e) =>
                                      updateBlock(block.id, {
                                        layout: {
                                          ...block.layout,
                                          fit: e.target.value as
                                            "contain" | "cover",
                                        },
                                      })
                                    }
                                  >
                                    <option value="contain">
                                      保留完整原图比例
                                    </option>
                                    <option value="cover">
                                      按版面裁切展示
                                    </option>
                                  </select>
                                </label>
                              </>
                            ) : null}
                            <label className="flex min-h-11 items-center gap-2">
                              <input
                                type="checkbox"
                                checked={block.layout.breakBefore}
                                onChange={(e) =>
                                  updateBlock(block.id, {
                                    layout: {
                                      ...block.layout,
                                      breakBefore: e.target.checked,
                                    },
                                  })
                                }
                              />
                              从新页开始
                            </label>
                            <p className="text-sm text-muted">
                              来源：
                              {block.sourceIds
                                .map(
                                  (id) =>
                                    book.sourceStates[id]?.label ||
                                    book.sources.find((s) => s.id === id)
                                      ?.label ||
                                    "手写",
                                )
                                .join("、") || "手写内容"}
                            </p>
                          </>
                        )}
                        <div className="flex flex-wrap gap-2">
                          <button
                            className="ui-button-secondary"
                            disabled={book.blocks.find((b) => b.chapterId === block.chapterId)?.id === block.id}
                            onClick={() => moveBlock(block.id, -1)}
                          >
                            内容上移
                          </button>
                          <button
                            className="ui-button-secondary"
                            disabled={book.blocks.filter((b) => b.chapterId === block.chapterId).at(-1)?.id === block.id}
                            onClick={() => moveBlock(block.id, 1)}
                          >
                            内容下移
                          </button>
                          <label className="flex min-h-11 w-full items-center gap-2 text-sm sm:w-72">
                            移动到章节
                            <select
                              className={field}
                              value=""
                              onChange={(e) => {
                                const targetId = e.target.value;
                                if (!targetId || targetId === block.chapterId)
                                  return;
                                update({
                                  blocks: [
                                    ...book.blocks.filter(
                                      (b) => b.id !== block.id,
                                    ),
                                    { ...block, chapterId: targetId },
                                  ],
                                });
                              }}
                            >
                              <option value="">选择章节…</option>
                              {book.chapters.map((c, i) => (
                                <option key={c.id} value={c.id}>
                                  {i + 1}. {c.title}
                                </option>
                              ))}
                            </select>
                          </label>
                          <button
                            className="ui-button-secondary"
                            onClick={() => {
                              const kindLabel = {
                                text: "文字",
                                image: "单图",
                                double: "双图",
                                collage: "小型拼图",
                                quote: "引文",
                                date: "日期 / 年龄",
                              }[block.kind];
                              if (
                                window.confirm(
                                  `移除内容块（${kindLabel}）？来源记忆不会删除。`,
                                )
                              )
                                update({
                                  blocks: book.blocks.filter(
                                    (b) => b.id !== block.id,
                                  ),
                                });
                            }}
                          >
                            删除内容块
                          </button>
                        </div>
                        </> : null}
                      </article>
                    );
                  })}
                <button
                  className="ui-button-secondary"
                  onClick={() =>
                    update({
                      blocks: [
                        ...book.blocks,
                        {
                          id: crypto.randomUUID(),
                          chapterId: chapter.id,
                          kind: "text",
                          text: "",
                          caption: "",
                          layout: defaultBookLayout(),
                          sourceIds: [],
                        },
                      ],
                    })
                  }
                >
                  插入内容块
                </button>
              </section>
            ))}
            <button
              className="ui-button-secondary"
              disabled={book.chapters.length >= 50}
              onClick={() =>
                update({
                  chapters: [
                    ...book.chapters,
                    { id: crypto.randomUUID(), title: "新章节" },
                  ],
                })
              }
            >
              添加章节
            </button>
          </section> : null}
            </fieldset>
          </div>
          <aside
            aria-label="实时预览"
            className="sticky top-4 hidden max-h-[calc(100vh-2rem)] overflow-y-auto xl:block"
          >
            <BookPreview book={book} />
          </aside>
        </div>
      ) : (
        <BookPreview book={book} />
      )}
      <details className="my-4"><summary className="ui-button-secondary cursor-pointer">导出与下载</summary>
      {!book.deletedAt ? <BookRenderPanel id={id} audience={book.audience} prepare={async()=>{setOperationBusy(true);try{return await save()?serverRevision.current:null;}finally{setOperationBusy(false);}}}/> : null}
      </details>
      <details className="my-4"><summary className="ui-text-link cursor-pointer">作品管理</summary>
      {canEdit ? <>
            <button
              className="ui-button-secondary"
              disabled={busy}
              onClick={() => void operation("snapshot")}
            >
              保存版本快照
            </button>
            <button className="ui-button-secondary" disabled={busy} onClick={() => void operation("copy")}>复制成新册</button>
            <button className="ui-button-secondary" disabled={busy} onClick={() => void operation(book.status === "finished" ? "reopen" : "finish")}>{book.status === "finished" ? "重新列为正在制作" : "标记制作完成"}</button>
      </> : null}
      <section className="my-8" aria-label="保存的版本">
        <h2 className="text-lg">保存的版本</h2>
        <p className="my-2 text-sm text-muted">
          自动保存保留当前编辑；版本快照用于留下某次排版，阅读时仍会校验来源权限。
        </p>
        <ul>
          {book.versions.map((version) => (
            <li key={version.revision}>
              <Link
                className="ui-text-link inline-flex min-h-11 items-center"
                href={`/books/${id}/versions/${version.revision}`}
                onNavigate={(e) => {
                  if (editSequence.current !== savedSequence.current) {
                    e.preventDefault();
                    setError("请先保存修改，再打开保存的版本。");
                  }
                }}
              >
                修订 {version.revision} ·{" "}
                {new Intl.DateTimeFormat("zh-CN", {
                  dateStyle: "medium",
                  timeStyle: "short",
                  timeZone: book.timezone,
                }).format(new Date(version.createdAt))}
              </Link>
              {canEdit ? <button className="ui-text-link ml-3" disabled={busy} onClick={() => { if (window.confirm("当前排版会先保存为版本，再恢复所选排版。")) void operation("restore_version", { version: version.revision }); }}>恢复此版本</button> : null}
            </li>
          ))}
        </ul>
      </section>
      {book.canWrite ? (
        <button
          className="ui-button-secondary"
          disabled={busy}
          onClick={() => {
            if (
              book.deletedAt ||
              window.confirm("移入作品回收站？源记忆、相册和原件不受影响。")
            )
              void operation(book.deletedAt ? "restore" : "delete");
          }}
        >
          {book.deletedAt ? "恢复作品" : "删除作品"}
        </button>
      ) : null}
      </details>
    </main>
  );
}
function BookMaterialPicker({
  audience,
  disabled,
  onAdd,
}: {
  audience: BookAudience;
  disabled: boolean;
  onAdd: (selection: { kind: string; id: string }[]) => Promise<void>;
}) {
  const [kind, setKind] = useState("memory"),
    [entries, setEntries] = useState<{ id: string; title: string }[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [selected, setSelected] = useState<string[]>([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  const requestGeneration = useRef(0);
  const load = useCallback(
    async (next = "") => {
      const generation = ++requestGeneration.current;
      setLoading(true);
      try {
        const data = await request<{
          entries: { id: string; title: string }[];
          nextCursor: string | null;
        }>(
          `/api/books/projects/materials?kind=${kind}&audience=${audience}&cursor=${encodeURIComponent(next)}`,
        );
        if (generation !== requestGeneration.current) return;
        setEntries((current) =>
          next ? [...current, ...data.entries] : data.entries,
        );
        setCursor(data.nextCursor);
        setError("");
      } catch (e) {
        if (generation === requestGeneration.current) setError((e as Error).message);
      } finally {
        if (generation === requestGeneration.current) setLoading(false);
      }
    },
    [kind, audience],
  );
  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);
  return (
    <details className="my-5 rounded-2xl border border-line p-4">
      <summary className="min-h-11 cursor-pointer py-2 text-lg">
        从真实记忆中选材
      </summary>
      <label className="block">
        来源类型
        <select
          className={field}
          value={kind}
          onChange={(e) => {
            requestGeneration.current++;
            setEntries([]);
            setKind(e.target.value);
            setSelected([]);
          }}
        >
          <option value="memory">已确认记忆</option>
          <option value="collection">相册 / 章节</option>

        </select>
      </label>
      {error ? <p role="alert">{error}</p> : null}
      <fieldset className="my-3 space-y-2">
        <legend>选择来源</legend>
        {entries.map((entry) => (
          <label
            className="flex min-h-11 items-center gap-3 break-words"
            key={entry.id}
          >
            <input
              type="checkbox"
              checked={selected.includes(entry.id)}
              onChange={(e) =>
                setSelected((current) =>
                  e.target.checked
                    ? [...current, entry.id]
                    : current.filter((id) => id !== entry.id),
                )
              }
            />
            {entry.title}
          </label>
        ))}
      </fieldset>
      {!loading && !entries.length ? (
        <p className="my-3 text-sm text-muted">
          当前范围没有可选内容，可以先到时间轴整理。
        </p>
      ) : null}
      {cursor ? (
        <button
          className="ui-button-secondary mr-2"
          disabled={loading}
          onClick={() => void load(cursor)}
        >
          更多来源
        </button>
      ) : null}
      <button
        className="ui-button-primary"
        disabled={disabled || loading || !selected.length}
        onClick={() => void onAdd(selected.map((id) => ({ kind, id })))}
      >
        加入所选 {selected.length} 项来源
      </button>
    </details>
  );
}
