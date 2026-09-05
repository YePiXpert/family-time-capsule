"use client";
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
  const router = useRouter(),
    [page, setPage] = useState<BookPage | null>(null),
    [title, setTitle] = useState(""),
    [template, setTemplate] = useState<BookTemplate>("growth"),
    [audience, setAudience] = useState<BookAudience>("family"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [deleted, setDeleted] = useState(false);
  const load = useCallback(
    async (cursor = "") => {
      try {
        const next = await request<BookPage>(
          `/api/books/projects?deleted=${deleted ? "1" : "0"}&cursor=${encodeURIComponent(cursor)}`,
        );
        setPage((current) =>
          cursor && current
            ? { ...next, entries: [...current.entries, ...next.entries] }
            : next,
        );
        setError("");
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [deleted],
  );
  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);
  async function create() {
    setBusy(true);
    try {
      const result = await request<{ id: string }>(
        "/api/books/projects",
        "POST",
        { title, template, audience },
      );
      router.push(`/books/${result.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="成长年册书架" className="mt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl">我的作品</h2>
        <button
          className="ui-button-secondary"
          onClick={() => setDeleted((v) => !v)}
        >
          {deleted ? "返回书架" : "作品回收站"}
        </button>
      </div>
      {error ? (
        <p role="alert" className="my-4">
          {error}
          <button
            className="ui-button-secondary ml-2"
            onClick={() => void load()}
          >
            重试
          </button>
        </p>
      ) : null}
      {page?.canWrite && !deleted ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
          className="my-6 space-y-4 rounded-2xl border border-line bg-surface p-5"
        >
          <label className="block">
            作品名称
            <input
              className={field}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              required
            />
          </label>
          <fieldset className="grid gap-3 sm:grid-cols-3">
            <legend className="mb-2">选一种开始方式</legend>
            {BOOK_TEMPLATES.map((item) => (
              <label
                className="rounded-xl border border-line p-3"
                key={item.id}
              >
                <span className="flex min-h-11 items-center gap-2">
                  <input
                    type="radio"
                    name="book-template"
                    value={item.id}
                    checked={template === item.id}
                    onChange={() => setTemplate(item.id)}
                  />
                  {item.title}
                </span>
                <span className="text-sm text-muted">{item.description}</span>
              </label>
            ))}
          </fieldset>
          <label className="block">
            读者范围
            <select
              className={field}
              value={audience}
              onChange={(e) => setAudience(e.target.value as BookAudience)}
            >
              <option value="family">家庭可读版</option>
              <option value="personal">我的私人阅读版</option>
            </select>
          </label>
          <p className="text-sm text-muted">
            家庭版只选入家庭读者可见的原文；私密、父母可见、长大后可见讲述及未到期胶囊不会自动加入。
          </p>
          <button className="ui-button-primary" disabled={busy}>
            {busy ? "正在建立…" : "建立可编辑作品"}
          </button>
        </form>
      ) : null}
      <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {page?.entries.map((book) => (
          <li key={book.id}>
            <Link
              href={`/books/${book.id}`}
              className="block h-full rounded-2xl border border-line bg-surface p-5"
            >
              <p className="text-sm text-muted">
                {BOOK_TEMPLATES.find((t) => t.id === book.template)?.title} ·{" "}
                {book.audience === "family" ? "家庭可读版" : "私人阅读版"}
              </p>
              <h3 className="mt-3 break-words text-xl">{book.title}</h3>
              <p className="mt-2 whitespace-pre-wrap break-words text-sm text-muted">
                {book.subtitle}
              </p>
              <span className="mt-4 block text-sm">
                继续阅读与编辑 · 修订 {book.revision}
              </span>
            </Link>
          </li>
        ))}
      </ol>
      {page && !page.entries.length ? (
        <p className="my-5 rounded-xl border border-dashed border-line p-5 text-muted">
          {deleted
            ? "回收站没有作品。"
            : "为一段家庭经历取个名字，再从旧素材里挑选。编辑内容会保存在家庭服务器。"}
        </p>
      ) : null}
      {page?.nextCursor ? (
        <button
          className="ui-button-secondary mt-4"
          onClick={() => void load(page.nextCursor!)}
        >
          更多作品
        </button>
      ) : null}
    </section>
  );
}
export function BookEditor({ id }: { id: string }) {
  const [book, setBook] = useState<BookDetail | null>(null),
    [error, setError] = useState(""),
    [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false),
    [paused, setPaused] = useState(false),
    [sequence, setSequence] = useState(0),
    [reading, setReading] = useState(false),
    [operationBusy, setOperationBusy] = useState(false);
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
    setStatus("有修改，正在等待保存…");
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
  async function preview() {
    setOperationBusy(true);
    try {
      if (!(await save())) return;
      const next = await request<BookDetail>(`/api/books/projects/${id}`);
      accept(next);
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
      <div className="my-4 flex flex-wrap gap-3">
        {canEdit ? (
          <>
            <button
              className="ui-button-primary"
              disabled={busy}
              onClick={() => void save()}
            >
              保存当前编辑
            </button>
            <button
              className="ui-button-secondary"
              disabled={busy}
              onClick={() => (reading ? setReading(false) : void preview())}
            >
              {reading ? "继续编辑" : "预览作品"}
            </button>
            <button
              className="ui-button-secondary"
              disabled={busy}
              onClick={() => void operation("snapshot")}
            >
              保存版本快照
            </button>
          </>
        ) : null}
      </div>
      {canEdit && !reading ? (
        <fieldset disabled={operationBusy}>
          <section
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
                {BOOK_TEMPLATES.map((t) => (
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
          </section>
          <BookMaterialPicker
            audience={book.audience}
            disabled={busy}
            onAdd={(selection) => operation("add", { selection })}
          />
          <section aria-label="章节与内容块" className="mt-7 space-y-5">
            <h2 className="text-2xl">章节与内容</h2>
            {book.chapters.map((chapter, chapterIndex) => (
              <section
                className="rounded-2xl border border-line p-4"
                key={chapter.id}
              >
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
                        className="my-4 space-y-3 rounded-xl border border-line bg-surface p-4"
                        aria-label={`内容块 ${index + 1}`}
                      >
                        {blocked ? (
                          <p>
                            来源当前不可见，原有编辑仍保存在服务器。可以移除此块，暂不能修改来源。
                          </p>
                        ) : (
                          <>
                            <label className="block">
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
                            </label>
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
                            {["image", "double", "collage"].includes(
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
                          <button
                            className="ui-button-secondary"
                            onClick={() =>
                              update({
                                blocks: book.blocks.filter(
                                  (b) => b.id !== block.id,
                                ),
                              })
                            }
                          >
                            删除内容块
                          </button>
                        </div>
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
          </section>
        </fieldset>
      ) : (
        <BookPreview book={book} />
      )}
      {!book.deletedAt ? <BookRenderPanel id={id} audience={book.audience} prepare={async()=>{setOperationBusy(true);try{return await save()?serverRevision.current:null;}finally{setOperationBusy(false);}}}/> : null}
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
              >
                修订 {version.revision} ·{" "}
                {new Intl.DateTimeFormat("zh-CN", {
                  dateStyle: "medium",
                  timeStyle: "short",
                  timeZone: book.timezone,
                }).format(new Date(version.createdAt))}
              </Link>
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
          <option value="story">已发布故事</option>
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
