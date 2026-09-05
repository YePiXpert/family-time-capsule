"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type {
  CollectionDetail,
  CollectionPage,
} from "@/mobile/src/collections/types";
export function CollectionSelection({
  memories,
  initialCollection = "",
}: {
  memories: { id: string; title: string }[];
  initialCollection?: string;
}) {
  const [page, setPage] = useState<CollectionPage | null>(null),
    [collection, setCollection] = useState(initialCollection),
    [selected, setSelected] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false);
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const response = await fetch("/api/collections", { cache: "no-store" });
        if (!response.ok) throw new Error();
        const next: CollectionPage = await response.json();
        if (
          initialCollection &&
          !next.entries.some((c) => c.id === initialCollection)
        ) {
          const target = await fetch(
            `/api/collections/${encodeURIComponent(initialCollection)}`,
            { cache: "no-store" },
          );
          if (!target.ok) throw new Error();
          const detail: CollectionDetail = await target.json();
          if (detail.deletedAt) throw new Error();
          next.entries.unshift({
            ...detail,
            count: detail.items.filter((i) => i.source).length,
          });
        }
        if (active) setPage(next);
      } catch {
        if (active) setError("无法读取相册，请刷新重试。");
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [initialCollection]);
  async function more() {
    if (!page?.nextCursor) return;
    setBusy(true);
    try {
      const response = await fetch(
        `/api/collections?cursor=${encodeURIComponent(page.nextCursor)}`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error();
      const next: CollectionPage = await response.json();
      setPage((current) =>
        current
          ? {
              ...next,
              entries: [
                ...current.entries,
                ...next.entries.filter(
                  (c) =>
                    !current.entries.some((existing) => existing.id === c.id),
                ),
              ],
            }
          : next,
      );
      setError("");
    } catch {
      setError("无法读取更多相册，请重试。");
    } finally {
      setBusy(false);
    }
  }
  async function add() {
    const target = page?.entries.find((c) => c.id === collection);
    if (!target) return;
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const response = await fetch(`/api/collections/${collection}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          operation: "add",
          revision: target.revision,
          eventIds: selected,
        }),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(
          response.status === 409
            ? "相册已被其他家人修改。选择仍保留，请刷新相册后重试。"
            : "来源已变化或暂时无法保存；整批操作没有写入。",
        );
      setPage((current) =>
        current
          ? {
              ...current,
              entries: current.entries.map((c) =>
                c.id === collection ? { ...c, revision: body.revision } : c,
              ),
            }
          : null,
      );
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (page && !page.canWrite) return null;
  return (
    <details
      className="mt-5 rounded-2xl border border-line bg-surface p-4"
      open={initialCollection ? true : undefined}
    >
      <summary className="min-h-11 cursor-pointer py-2">
        {memories.length === 1 ? "加入相册 / 章节" : "多选整理到相册 / 章节"}
      </summary>
      {error ? (
        <p role="alert" className="my-3">
          {error}
        </p>
      ) : null}
      {page?.entries.length ? (
        <>
          <label className="block">
            目标相册
            <select
              className="mt-2 min-h-11 w-full rounded-xl border border-line bg-background px-3"
              value={collection}
              onChange={(e) => {
                setCollection(e.target.value);
                setSaved(false);
              }}
            >
              <option value="">请选择</option>
              {page.entries.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </label>
          {page.nextCursor ? (
            <button
              className="ui-button-secondary mt-3"
              disabled={busy}
              onClick={() => void more()}
            >
              读取更多相册
            </button>
          ) : null}
          <fieldset className="mt-4 space-y-2">
            <legend>选择已确认记忆</legend>
            {memories.map((m) => (
              <label
                key={m.id}
                className="flex min-h-11 items-center gap-3 break-words"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(m.id)}
                  onChange={(e) => {
                    setSelected((values) =>
                      e.target.checked
                        ? [...values, m.id]
                        : values.filter((id) => id !== m.id),
                    );
                    setSaved(false);
                  }}
                />
                {m.title}
              </label>
            ))}
          </fieldset>
          <button
            className="ui-button-primary mt-3"
            disabled={busy || !collection || !selected.length}
            onClick={() => void add()}
          >
            {busy ? "正在加入…" : `加入所选 ${selected.length} 条记忆`}
          </button>
          {saved ? (
            <p role="status" className="mt-3">
              已加入，只建立相册关系。
              <Link
                className="ui-text-link ml-2"
                href={`/collections/${collection}`}
              >
                打开相册
              </Link>
            </p>
          ) : null}
        </>
      ) : (
        <p className="mt-3">{page ? "还没有相册。" : "正在读取相册…"}</p>
      )}
      <Link href="/collections" className="ui-button-secondary mt-3">
        新建或查看全部相册
      </Link>
    </details>
  );
}
