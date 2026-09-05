"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BOOK_TEMPLATES,
  type BookAudience,
  type BookTemplate,
} from "@/mobile/src/books/types";
import {
  bookReviewRange,
  earlyBookRanges,
  type BookReview,
  type BookReviewKind,
  type BookReviewRange,
} from "@/mobile/src/books/review-types";
const field =
  "min-h-11 w-full rounded-xl border border-line bg-surface px-3 py-2";
const errors: Record<string, string> = {
  review_range_limit: "一次整理 1 至 366 天，请调整日期范围。",
  review_selection_limit: "一次最多选择 100 项；请先勾选需要的素材。",
  source_unavailable: "部分来源已不可见，本次没有写入，请刷新核对。",
  source_outside_period: "记忆日期已移出当前范围，请刷新核对。",
  revision_conflict: "家人已保存新版本，你的勾选仍保留，请重新打开草稿核对。",
  invalid_date_range: "请检查开始和结束日期。",
  book_too_large: "作品已达到编辑容量，请减少选材或另建一册。",
  album_requires_memories: "相册只接受记忆，请取消故事或讲述勾选。",
};
async function request<T>(
  url: string,
  body?: unknown,
  method = "POST",
): Promise<T> {
  const response = await fetch(
    url,
    body
      ? {
          method,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }
      : { cache: "no-store" },
  );
  const result = await response.json();
  if (!response.ok)
    throw Error(errors[result.error] ?? "暂时无法完成，请重试；勾选仍保留。");
  return result;
}
export function BookReviewEditor({
  initialRange,
}: {
  initialRange: BookReviewRange;
}) {
  const router = useRouter(),
    [range, setRange] = useState(initialRange),
    [start, setStart] = useState(initialRange.startDate),
    [end, setEnd] = useState(initialRange.endDate),
    [month, setMonth] = useState(initialRange.startDate.slice(0, 7)),
    [year, setYear] = useState(initialRange.startDate.slice(0, 4));
  const [audience, setAudience] = useState<BookAudience>("family"),
    [template, setTemplate] = useState<BookTemplate>("growth"),
    [kind, setKind] = useState<BookReviewKind>("memory"),
    [data, setData] = useState<BookReview | null>(null),
    [selected, setSelected] = useState<{ kind: BookReviewKind; id: string }[]>(
      [],
    ),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const load = useCallback(
    async (cursor = "") => {
      const mine = ++generation.current;
      try {
        const next = await request<BookReview>(
          `/api/books/review?${new URLSearchParams({ ...range, audience, template, kind, cursor })}`,
        );
        if (mine !== generation.current) return;
        setData((old) =>
          cursor && old
            ? { ...next, materials: [...old.materials, ...next.materials] }
            : next,
        );
        setError("");
      } catch (e) {
        if (mine === generation.current) setError((e as Error).message);
      }
    },
    [range, audience, template, kind],
  );
  useEffect(() => {
    const requests = generation;
    const timer = setTimeout(() => void load(), 0);
    return () => {
      clearTimeout(timer);
      requests.current++;
    };
  }, [load]);
  function apply(next: BookReviewRange) {
    setRange(next);
    setStart(next.startDate);
    setEnd(next.endDate);
    setMonth(next.startDate.slice(0,7));
    setYear(next.startDate.slice(0,4));
    setData(null);
    setSelected([]);
    router.replace(`/books/review?${new URLSearchParams(next)}`, {
      scroll: false,
    });
  }
  async function perform(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function create(operation: "draft" | "album") {
    void perform(async () => {
      const result = await request<{ id: string }>("/api/books/review", {
        ...range,
        audience,
        template,
        operation,
        ...(selected.length ? { selection: selected } : {}),
      });
      router.push(
        `/${operation === "album" ? "collections" : "books"}/${result.id}`,
      );
    });
  }
  return (
    <section className="my-6 space-y-6" aria-label="月度与年度作品选材">
      <p className="text-muted">
        从当时留下的原话与素材开始。统计按家庭发生日期；没有记忆的月份如实留白。
      </p>
      <div className="grid gap-3 rounded-2xl border border-line p-5 sm:grid-cols-2">
        <label>
          月份
          <input
            className={field}
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          />
        </label>
        <button
          className="ui-button-secondary"
          onClick={() => {
            try {
              apply(bookReviewRange(month));
            } catch {
              setError("请填写有效月份。");
            }
          }}
        >
          查看月份
        </button>
        <label>
          年份
          <input
            className={field}
            inputMode="numeric"
            value={year}
            onChange={(e) => setYear(e.target.value)}
          />
        </label>
        <button
          className="ui-button-secondary"
          onClick={() => {
            try {
              apply(bookReviewRange(year));
            } catch {
              setError("请填写四位年份。");
            }
          }}
        >
          查看全年
        </button>
        <label>
          开始日期
          <input
            className={field}
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </label>
        <label>
          结束日期（含当天）
          <input
            className={field}
            type="date"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </label>
        <button
          className="ui-button-secondary"
          onClick={() => apply({ startDate: start, endDate: end })}
        >
          查看日期范围
        </button>
        <label>
          作品模板
          <select
            className={field}
            value={template}
            onChange={(e) => {
              setTemplate(e.target.value as BookTemplate);
              setData(null);
            }}
          >
            {BOOK_TEMPLATES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          作品读者
          <select
            className={field}
            value={audience}
            onChange={(e) => {
              setAudience(e.target.value as BookAudience);
              setSelected([]);
              setData(null);
            }}
          >
            <option value="family">家庭可读版</option>
            <option value="personal">当前用户私人阅读版</option>
          </select>
        </label>
      </div>
      {data?.birthDate ? (
        <div className="flex flex-wrap gap-3">
          {earlyBookRanges(data.birthDate).map((r) => (
            <button
              key={r.label}
              className="ui-button-secondary"
              onClick={() =>
                apply({ startDate: r.startDate, endDate: r.endDate })
              }
            >
              {r.label}
            </button>
          ))}
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="rounded-xl border border-line p-4">
          {error}
        </p>
      ) : null}
      <button
        className="ui-button-secondary"
        disabled={busy}
        onClick={() => void load()}
      >
        刷新回顾
      </button>
      {data ? (
        <>
          <h2 className="text-2xl">
            {range.startDate} 至 {range.endDate}
          </h2>
          <p>
            {data.total} 段记忆 · 人工精选 {data.selectedCount} 段 ·{" "}
            {data.timezone}
          </p>
          <ol className="grid gap-3 sm:grid-cols-3">
            {data.months.map((m) => (
              <li key={m.month} className="rounded-xl border border-line p-3">
                {m.month} ·{" "}
                {m.count ? `${m.count} 段记忆` : "本月暂无记忆，留白"}
              </li>
            ))}
          </ol>
          {data.draft ? (
            <div className="rounded-2xl border border-accent/30 bg-accent-soft p-5">
              <h3 className="text-xl">正在制作：{data.draft.title}</h3>
              <p className="my-3">
                还有 {data.draft.newMemoryCount}{" "}
                段当前范围的记忆尚未选入。已有人工编辑不会自动改写。
              </p>
              <Link
                className="ui-button-primary"
                href={`/books/${data.draft.id}`}
              >
                继续编辑草稿
              </Link>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-3" aria-label="回顾素材类型">
            {(
              [
                ["memory", "记忆与成长节点"],
                ["contribution", "家人讲述"],
                ["story", "已发布周记与故事"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                className={
                  kind === value ? "ui-button-primary" : "ui-button-secondary"
                }
                onClick={() => {
                  setKind(value);
                  setData(null);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          {!data.materials.length ? (
            <p>这个范围暂时没有当前可见的此类素材。</p>
          ) : null}
          <ul className="space-y-3">
            {data.materials.map((m) => (
              <li
                key={`${m.kind}:${m.id}`}
                className="rounded-2xl border border-line p-4"
              >
                <label className="flex min-h-11 items-center gap-3">
                  <input
                    type="checkbox"
                    disabled={busy || !data.canWrite}
                    checked={selected.some(
                      (s) => s.id === m.id && s.kind === m.kind,
                    )}
                    onChange={(e) =>
                      setSelected((old) =>
                        e.target.checked
                          ? [...old, { kind: m.kind, id: m.id }]
                          : old.filter(
                              (s) => s.id !== m.id || s.kind !== m.kind,
                            ),
                      )
                    }
                  />
                  <span className="min-w-0 break-words">{m.title}</span>
                </label>
                <p className="my-2 text-sm text-muted">
                  {m.date}
                  {m.author ? ` · ${m.author}` : ""}
                  {m.milestone ? ` · 成长节点：${m.milestone}` : ""}
                  {m.included ? " · 已在草稿中" : ""}
                </p>
                <div className="flex flex-wrap gap-3">
                  {m.kind === "memory" ? (
                    <>
                      <Link className="ui-text-link" href={`/memories/${m.id}`}>
                        原始记忆
                      </Link>
                      {data.canWrite ? (
                        <button
                          className="ui-button-secondary"
                          disabled={busy}
                          onClick={() =>
                            void perform(async () => {
                              await request("/api/books/review", {
                                ...range,
                                audience,
                                template,
                                operation: "highlight",
                                id: m.id,
                                selected: !m.selected,
                              });
                              await load();
                            })
                          }
                        >
                          {m.selected ? "取消人工精选" : "设为人工精选"}
                        </button>
                      ) : null}
                    </>
                  ) : m.kind === "story" ? (
                    <Link className="ui-text-link" href={`/stories/${m.id}`}>
                      阅读来源故事
                    </Link>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
          {data.nextCursor ? (
            <button
              className="ui-button-secondary"
              disabled={busy}
              onClick={() => void load(data.nextCursor!)}
            >
              更多回顾素材
            </button>
          ) : null}
          {data.canWrite ? (
            <div className="space-y-3 rounded-2xl border border-line p-5">
              <p>
                已勾选 {selected.length}{" "}
                项。未勾选时使用人工精选；没有精选则选入当前范围记忆（最多 100
                项）。
              </p>
              <p className="text-sm text-muted">
                重复建立会继续同一未完成草稿。需要另一本时，请在作品页明确复制。
              </p>
              <div className="flex flex-wrap gap-3">
                <button
                  className="ui-button-primary"
                  disabled={busy}
                  onClick={() => create("draft")}
                >
                  {data.draft ? "恢复同一草稿" : "建立可编辑年册草稿"}
                </button>
                <button
                  className="ui-button-secondary"
                  disabled={busy || selected.some((s) => s.kind !== "memory")}
                  onClick={() => create("album")}
                >
                  建立相册草稿
                </button>
                {data.draft && selected.length ? (
                  <button
                    className="ui-button-secondary"
                    disabled={busy}
                    onClick={() =>
                      void perform(async () => {
                        await request(
                          `/api/books/projects/${data.draft!.id}`,
                          {
                            operation: "add",
                            revision: data.draft!.revision,
                            selection: selected,
                          },
                          "PATCH",
                        );
                        setSelected([]);
                        await load();
                      })
                    }
                  >
                    将所选加入现有草稿
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
        </>
      ) : (
        <p aria-live="polite">正在读取回顾…</p>
      )}
    </section>
  );
}
