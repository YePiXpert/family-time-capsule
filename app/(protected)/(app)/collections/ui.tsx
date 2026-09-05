"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import type {
  CollectionDetail,
  CollectionEdit,
  CollectionPage,
} from "@/mobile/src/collections/types";
import { PageHeader } from "@/components/page-header";
const field =
  "min-h-11 w-full rounded-xl border border-line bg-surface px-3 py-2";
const messages: Record<string, string> = {
  revision_conflict:
    "其他家人已修改这份相册。你的输入仍保留；请先复制未保存内容，再重新读取最新版本。",
  source_unavailable: "部分来源已删除或不可见，整批操作没有写入。",
  invalid_cover: "封面必须来自本相册内当前可见记忆的照片。",
  forbidden: "当前账号没有编辑权限。",
  collection_deleted: "相册已被移入回收站。",
};
async function request<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method: body ? "PATCH" : "GET",
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      messages[data.error] || "操作失败，请重试。未保存输入仍保留。",
    );
  return data;
}
export function CollectionsClient() {
  const router = useRouter();
  const [page, setPage] = useState<CollectionPage | null>(null),
    [deleted, setDeleted] = useState(false),
    [title, setTitle] = useState(""),
    [kind, setKind] = useState<"album" | "chapter">("album"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const load = useCallback(
    async (cursor = "") => {
      try {
        setError("");
        const next = await request<CollectionPage>(
          `/api/collections?deleted=${deleted ? "1" : "0"}&cursor=${encodeURIComponent(cursor)}`,
        );
        setPage((current) =>
          cursor && current
            ? { ...next, entries: [...current.entries, ...next.entries] }
            : next,
        );
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
    setError("");
    try {
      const r = await fetch("/api/collections", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, kind }),
      });
      const b = await r.json();
      if (!r.ok) throw new Error("请填写 1–200 字的名称，或稍后重试。");
      router.push(`/collections/${b.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="page-container">
      <PageHeader
        title="相册与章节"
        eyebrow="Family collections"
        description="从真实记忆里，整理一段想反复翻看的家庭经历。"
        backHref="/timeline"
        backLabel="返回时间轴"
      />
      <div className="mt-5 flex gap-3">
        <button
          className="ui-button-secondary"
          onClick={() => setDeleted(!deleted)}
        >
          {deleted ? "返回相册" : "相册回收站"}
        </button>
      </div>
      {error ? (
        <p role="alert" className="mt-4 text-danger">
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
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
          className="my-6 grid gap-3 sm:grid-cols-3"
        >
          <label>
            名称
            <input
              className={field}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              required
            />
          </label>
          <label>
            形式
            <select
              className={field}
              value={kind}
              onChange={(e) => setKind(e.target.value as typeof kind)}
            >
              <option value="album">主题相册</option>
              <option value="chapter">章节（可分小节）</option>
            </select>
          </label>
          <button disabled={busy} className="ui-button-primary self-end">
            {busy ? "正在创建…" : "新建相册 / 章节"}
          </button>
        </form>
      ) : null}
      <ol className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {page?.entries.map((c) => (
          <li key={c.id} className="min-w-0">
            <Link
              href={`/collections/${c.id}`}
              className="block overflow-hidden rounded-2xl border border-line bg-surface"
            >
              {c.coverAssetId ? (
                <Image
                  src={`/api/media/${c.coverAssetId}`}
                  width={500}
                  height={320}
                  unoptimized
                  alt="相册封面"
                  className="h-44 w-full object-cover"
                />
              ) : null}
              <div className="p-4">
                <p className="text-sm text-muted">
                  {c.kind === "chapter" ? "章节" : "主题相册"} · {c.count}{" "}
                  条可见记忆
                </p>
                <h2 className="break-words text-xl">{c.title}</h2>
                <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-muted">
                  {c.description}
                </p>
              </div>
            </Link>
          </li>
        ))}
      </ol>
      {page && !page.entries.length ? (
        <p className="mt-6 text-muted">
          {deleted
            ? "回收站没有相册。"
            : "先为一段家庭经历取个名字，再从时间轴挑选记忆。"}
        </p>
      ) : null}
      {page?.nextCursor ? (
        <button
          className="ui-button-secondary mt-5"
          onClick={() => void load(page.nextCursor!)}
        >
          更多相册
        </button>
      ) : null}
    </main>
  );
}
export function CollectionEditor({ id }: { id: string }) {
  const [reading, setReading] = useState(false);
  const [doc, setDoc] = useState<CollectionDetail | null>(null),
    [saved, setSaved] = useState<CollectionDetail | null>(null),
    [error, setError] = useState(""),
    [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const value = await request<CollectionDetail>(`/api/collections/${id}`);
      setDoc(value);
      setSaved(value);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);
  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);
  const update = (patch: Partial<CollectionEdit>) => {
    setDoc((current) =>
      current ? ({ ...current, ...patch } as CollectionDetail) : null,
    );
    setStatus("有未保存修改");
  };
  async function save(operation = "save") {
    if (!doc) return;
    setBusy(true);
    setError("");
    try {
      const next = await request<CollectionDetail>(`/api/collections/${id}`, {
        operation,
        revision: saved?.revision,
        edit: doc,
      });
      setDoc(next);
      setSaved(next);
      setStatus(
        operation === "save"
          ? "已保存，可以随时重开。"
          : operation === "delete"
            ? "已移入相册回收站；源记忆和原件仍在。"
            : "相册已恢复。",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function move(index: number, delta: number) {
    if (!doc) return;
    const items = [...doc.items];
    const next = index + delta;
    if (next < 0 || next >= items.length) return;
    [items[index], items[next]] = [items[next]!, items[index]!];
    update({ items, sortMode: "manual" });
  }
  const editable = doc?.canWrite && !doc.deletedAt && !reading;
  const ordered =
    doc?.sortMode === "time"
      ? [...doc.items].sort(
          (a, b) =>
            (a.source?.occurredAt ?? "9999").localeCompare(
              b.source?.occurredAt ?? "9999",
            ) || a.id.localeCompare(b.id),
        )
      : doc?.items;
  const displayItems = editable
    ? ordered
    : [...(ordered || [])].sort(
        (a, b) =>
          (doc?.sections.findIndex((s) => s.id === a.sectionId) ?? -1) -
          (doc?.sections.findIndex((s) => s.id === b.sectionId) ?? -1),
      );
  return (
    <main className="page-container">
      <PageHeader
        title={doc?.title || "打开相册"}
        eyebrow="Keep a chapter"
        backHref="/collections"
        backLabel="返回相册"
      />
      {error ? (
        <div role="alert" className="mt-4 rounded-xl border border-line p-4">
          <p>{error}</p>
          <button
            className="ui-button-secondary mt-3"
            onClick={() => {
              if (
                !doc ||
                window.confirm(
                  "重新读取会放弃当前未保存输入。确认已复制需要保留的内容？",
                )
              )
                void load();
            }}
          >
            重新读取服务器版本
          </button>
        </div>
      ) : null}
      <p role="status" className="my-3 text-muted">
        {status}
      </p>
      {doc ? (
        <>
          <p className="text-sm text-muted">
            版本 {doc.revision} · {doc.items.filter((i) => i.source).length}{" "}
            条可见记忆{doc.deletedAt ? " · 在回收站中" : ""}
          </p>
          {doc.canWrite && !doc.deletedAt ? (
            <button
              className="ui-button-secondary mt-3"
              onClick={() => setReading(!reading)}
            >
              {reading ? "继续编辑" : "阅读相册"}
            </button>
          ) : null}
          {editable ? (
            <>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void save();
                }}
                className="mt-5 space-y-4"
                aria-label="编辑相册"
              >
                <label className="block">
                  名称
                  <input
                    className={field}
                    required
                    maxLength={200}
                    value={doc.title}
                    onChange={(e) => update({ title: e.target.value })}
                  />
                </label>
                <label className="block">
                  简介
                  <textarea
                    className={field}
                    rows={3}
                    maxLength={5000}
                    value={doc.description}
                    onChange={(e) => update({ description: e.target.value })}
                  />
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label>
                    开始日期（可选）
                    <input
                      className={field}
                      type="date"
                      value={doc.startDate || ""}
                      onChange={(e) =>
                        update({ startDate: e.target.value || null })
                      }
                    />
                  </label>
                  <label>
                    结束日期（可选）
                    <input
                      className={field}
                      type="date"
                      value={doc.endDate || ""}
                      onChange={(e) =>
                        update({ endDate: e.target.value || null })
                      }
                    />
                  </label>
                </div>
                <label className="block">
                  封面
                  <select
                    className={field}
                    value={doc.coverAssetId || ""}
                    onChange={(e) =>
                      update({ coverAssetId: e.target.value || null })
                    }
                  >
                    <option value="">不设封面</option>
                    {doc.items
                      .filter((i) => i.source?.coverAssetId)
                      .map((i) => (
                        <option key={i.id} value={i.source!.coverAssetId!}>
                          {i.source!.title}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="block">
                  顺序
                  <select
                    className={field}
                    value={doc.sortMode}
                    onChange={(e) =>
                      update({ sortMode: e.target.value as "manual" | "time" })
                    }
                  >
                    <option value="manual">手动排序</option>
                    <option value="time">按发生时间</option>
                  </select>
                </label>
                {doc.kind === "chapter" ? (
                  <section aria-label="章节小节">
                    <h2>小节</h2>
                    {doc.sections.map((section, index) => (
                      <div
                        key={section.id}
                        className="mt-3 flex flex-wrap gap-2"
                      >
                        <input
                          aria-label={`小节 ${index + 1} 名称`}
                          className={field}
                          value={section.title}
                          onChange={(e) =>
                            update({
                              sections: doc.sections.map((s) =>
                                s.id === section.id
                                  ? { ...s, title: e.target.value }
                                  : s,
                              ),
                            })
                          }
                        />
                        <button
                          type="button"
                          className="ui-button-secondary"
                          disabled={index === 0}
                          onClick={() => {
                            const sections = [...doc.sections];
                            [sections[index - 1], sections[index]] = [
                              sections[index]!,
                              sections[index - 1]!,
                            ];
                            update({ sections });
                          }}
                        >
                          小节上移
                        </button>
                        <button
                          type="button"
                          className="ui-button-secondary"
                          disabled={index === doc.sections.length - 1}
                          onClick={() => {
                            const sections = [...doc.sections];
                            [sections[index + 1], sections[index]] = [
                              sections[index]!,
                              sections[index + 1]!,
                            ];
                            update({ sections });
                          }}
                        >
                          小节下移
                        </button>
                        <button
                          type="button"
                          className="ui-button-secondary"
                          onClick={() =>
                            update({
                              sections: doc.sections.filter(
                                (s) => s.id !== section.id,
                              ),
                              items: doc.items.map((i) =>
                                i.sectionId === section.id
                                  ? { ...i, sectionId: null }
                                  : i,
                              ),
                            })
                          }
                        >
                          移除小节
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      disabled={doc.sections.length >= 20}
                      className="ui-button-secondary mt-3"
                      onClick={() =>
                        update({
                          sections: [
                            ...doc.sections,
                            { id: crypto.randomUUID(), title: "新小节" },
                          ],
                        })
                      }
                    >
                      添加小节
                    </button>
                  </section>
                ) : null}
                <button disabled={busy} className="ui-button-primary">
                  {busy ? "正在保存…" : "保存相册"}
                </button>
              </form>
              <Link
                className="ui-button-secondary mt-4"
                href={`/timeline?collection=${id}`}
                onClick={(event) => {
                  if (status === "有未保存修改") {
                    event.preventDefault();
                    setError("请先保存修改，再从时间轴选材。");
                  }
                }}
              >
                从时间轴多选记忆
              </Link>
            </>
          ) : (
            <p className="mt-4 whitespace-pre-wrap">{doc.description}</p>
          )}
          <ol className="mt-6 space-y-4">
            {displayItems?.map((item, displayIndex) => {
              const index = doc.items.findIndex((i) => i.id === item.id);
              return (
                <li
                  key={item.id}
                  className="rounded-2xl border border-line bg-surface p-4"
                >
                  {!editable &&
                  item.sectionId &&
                  (displayIndex === 0 ||
                    displayItems[displayIndex - 1]?.sectionId !==
                      item.sectionId) ? (
                    <h2 className="mb-4 text-2xl">
                      {doc.sections.find((s) => s.id === item.sectionId)?.title}
                    </h2>
                  ) : null}
                  {item.source ? (
                    <>
                      <Link
                        className="ui-text-link break-words text-lg"
                        href={`/memories/${item.memoryEventId}`}
                      >
                        {item.source.title}
                      </Link>
                      <p className="text-sm text-muted">
                        {new Intl.DateTimeFormat("zh-CN", {
                          dateStyle: "long",
                          timeZone: doc.timezone,
                        }).format(new Date(item.source.occurredAt))}
                      </p>
                      {item.source.previewAssetId ? (
                        <Image
                          src={`/api/media/${item.source.previewAssetId}`}
                          unoptimized
                          width={500}
                          height={320}
                          alt={item.caption || item.source.title}
                          className="my-3 max-h-80 w-full object-contain"
                        />
                      ) : null}
                    </>
                  ) : (
                    <p>来源已删除或当前不可见</p>
                  )}
                  {editable ? (
                    <>
                      <label className="mt-3 block">
                        图文说明
                        <textarea
                          className={field}
                          value={item.caption}
                          maxLength={2000}
                          onChange={(e) =>
                            update({
                              items: doc.items.map((i) =>
                                i.id === item.id
                                  ? { ...i, caption: e.target.value }
                                  : i,
                              ),
                            })
                          }
                        />
                      </label>
                      {doc.sections.length ? (
                        <label>
                          所属小节
                          <select
                            className={field}
                            value={item.sectionId || ""}
                            onChange={(e) =>
                              update({
                                items: doc.items.map((i) =>
                                  i.id === item.id
                                    ? {
                                        ...i,
                                        sectionId: e.target.value || null,
                                      }
                                    : i,
                                ),
                              })
                            }
                          >
                            <option value="">未分小节</option>
                            {doc.sections.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.title}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : null}
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          aria-label={`上移 ${item.source?.title || "条目"}`}
                          className="ui-button-secondary"
                          disabled={index === 0}
                          onClick={() => move(index, -1)}
                        >
                          上移
                        </button>
                        <button
                          aria-label={`下移 ${item.source?.title || "条目"}`}
                          className="ui-button-secondary"
                          disabled={index === doc.items.length - 1}
                          onClick={() => move(index, 1)}
                        >
                          下移
                        </button>
                        <button
                          className="ui-button-secondary"
                          onClick={() =>
                            update({
                              items: doc.items.filter((i) => i.id !== item.id),
                            })
                          }
                        >
                          移出相册
                        </button>
                      </div>
                    </>
                  ) : (
                    <p className="mt-3 whitespace-pre-wrap">{item.caption}</p>
                  )}
                </li>
              );
            })}
          </ol>
          {doc.canWrite ? (
            <div className="mt-6 flex flex-wrap gap-3">
              {!doc.deletedAt ? (
                <button
                  disabled={busy}
                  className="ui-button-primary"
                  onClick={() => void save()}
                >
                  保存排序与说明
                </button>
              ) : null}
              <button
                className="ui-button-secondary"
                disabled={busy}
                onClick={() => {
                  if (
                    doc.deletedAt ||
                    window.confirm(
                      `将“${doc.title}”移入相册回收站？可以恢复，源记忆不会删除。`,
                    )
                  )
                    void save(doc.deletedAt ? "restore" : "delete");
                }}
              >
                {doc.deletedAt ? "恢复相册" : "删除相册"}
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </main>
  );
}
