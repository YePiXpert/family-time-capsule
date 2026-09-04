import type { Metadata } from "next";
import Link from "next/link";
import { requireFamily } from "@/lib/family/context";
import { listPeople } from "@/lib/family/service";
import { searchFamily } from "@/lib/search/service";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "搜索 · Family Time Capsule" };

const inputClass =
  "rounded-lg border border-foreground/15 bg-transparent px-3 py-2 text-sm outline-none transition-colors focus:border-accent";

const MEDIA_TYPES = [
  { value: "", label: "全部媒介" },
  { value: "image", label: "照片" },
  { value: "video", label: "视频" },
  { value: "audio", label: "音频" },
  { value: "document", label: "文档" },
] as const;

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireFamily();
  const params = await searchParams;
  const first = (key: string): string =>
    typeof params[key] === "string" ? (params[key] as string) : "";

  const q = first("q").trim();
  const personId = first("person") || undefined;
  const dateFrom = first("from") || undefined;
  const dateTo = first("to") || undefined;
  const tag = first("tag") || undefined;
  const mediaType =
    first("media") === "image" || first("media") === "video" || first("media") === "audio" || first("media") === "document"
      ? (first("media") as "image" | "video" | "audio" | "document")
      : undefined;

  const [people, tags] = await Promise.all([
    listPeople(context.familyId),
    listAllTags(context.familyId),
  ]);

  const result = q
    ? searchFamily(context, { q, personId, dateFrom, dateTo, tag, mediaType })
    : null;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-16">
      <h1 className="text-2xl font-semibold">搜索</h1>
      <p className="mt-2 text-sm leading-6 text-foreground/60">
        全文搜索运行在本地数据库上，不依赖任何 AI；结果按家庭隔离并遵守讲述可见性。
      </p>

      <form method="get" className="mt-6 flex flex-col gap-3" aria-label="搜索表单">
        <div className="flex flex-wrap gap-2">
          <input
            type="search"
            name="q"
            defaultValue={q}
            required
            maxLength={100}
            placeholder="搜索标题、确认事实、家人讲述、已修订转录…"
            aria-label="搜索关键词"
            className={`${inputClass} min-w-56 flex-1`}
          />
          <button
            type="submit"
            className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90"
          >
            搜索
          </button>
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          <select name="person" defaultValue={personId ?? ""} aria-label="按参与人过滤" className={inputClass}>
            <option value="">全部参与人</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.displayName}
              </option>
            ))}
          </select>
          <select name="tag" defaultValue={tag ?? ""} aria-label="按标签过滤" className={inputClass}>
            <option value="">全部标签</option>
            {tags.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <select name="media" defaultValue={mediaType ?? ""} aria-label="按媒介过滤" className={inputClass}>
            {MEDIA_TYPES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
          <input
            type="date"
            name="from"
            defaultValue={dateFrom ?? ""}
            aria-label="开始日期"
            className={inputClass}
          />
          <input
            type="date"
            name="to"
            defaultValue={dateTo ?? ""}
            aria-label="结束日期"
            className={inputClass}
          />
        </div>
      </form>

      {result && (
        <section aria-label="搜索结果" className="mt-8 flex flex-col gap-6">
          <p className="text-sm text-foreground/60">
            共 {result.total} 条结果（事件 {result.events.length} · 确认事实{" "}
            {result.facts.length} · 家人讲述 {result.contributions.length} · 转录{" "}
            {result.transcripts.length} · 故事 {result.stories.length} · 文档{" "}
            {result.documents.length}）
          </p>

          {result.events.length > 0 && (
            <div>
              <h2 className="text-base font-medium">事件</h2>
              <ul className="mt-2 flex flex-col gap-2">
                {result.events.map((e) => (
                  <li key={e.id} className="rounded-lg border border-foreground/10 px-4 py-2.5 text-sm">
                    <Link href={`/memories/${e.id}`} className="font-medium hover:text-accent">
                      {e.title}
                    </Link>
                    <p className="mt-1 text-xs leading-5 text-foreground/50">{e.snippet}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.facts.length > 0 && (
            <div>
              <h2 className="text-base font-medium">确认事实</h2>
              <ul className="mt-2 flex flex-col gap-2">
                {result.facts.map((f) => (
                  <li key={f.id} className="rounded-lg border border-foreground/10 px-4 py-2.5 text-sm">
                    <Link href={`/memories/${f.eventId}`} className="hover:text-accent">
                      {f.statement}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.contributions.length > 0 && (
            <div>
              <h2 className="text-base font-medium">家人讲述</h2>
              <ul className="mt-2 flex flex-col gap-2">
                {result.contributions.map((c) => (
                  <li key={c.id} className="rounded-lg border border-foreground/10 px-4 py-2.5 text-sm">
                    <Link href={`/memories/${c.eventId}`} className="hover:text-accent">
                      {c.authorName ? `${c.authorName}：` : ""}
                      {c.text}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.transcripts.length > 0 && (
            <div>
              <h2 className="text-base font-medium">转录（人工修订）</h2>
              <ul className="mt-2 flex flex-col gap-2">
                {result.transcripts.map((t) => (
                  <li key={t.id} className="rounded-lg border border-foreground/10 px-4 py-2.5 text-sm">
                    <Link href={`/memories/${t.eventId}`} className="hover:text-accent">
                      {t.text}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.stories.length > 0 && (
            <div>
              <h2 className="text-base font-medium">故事</h2>
              <ul className="mt-2 flex flex-col gap-2">
                {result.stories.map((st) => (
                  <li key={st.id} className="rounded-lg border border-foreground/10 px-4 py-2.5 text-sm">
                    <Link href={`/stories/${st.id}`} className="font-medium hover:text-accent">
                      {st.title}
                    </Link>
                    <p className="mt-1 text-xs leading-5 text-foreground/50">{st.snippet}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.documents.length > 0 && (
            <div>
              <h2 className="text-base font-medium">文档正文</h2>
              <ul className="mt-2 flex flex-col gap-2">
                {result.documents.map((document) => (
                  <li key={document.id} className="rounded-lg border border-foreground/10 px-4 py-2.5 text-sm">
                    <Link href={`/memories/${document.eventId}`} className="font-medium hover:text-accent">
                      {document.filename}
                    </Link>
                    <p className="mt-1 text-xs leading-5 text-foreground/50">{document.snippet}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.total === 0 && (
            <p className="text-sm text-foreground/50">
              没有匹配的内容。试试别的关键词，或减少过滤条件。
            </p>
          )}
        </section>
      )}
    </main>
  );
}

async function listAllTags(familyId: string): Promise<string[]> {
  const { getDb } = await import("@/db");
  const { memoryEventTag } = await import("@/db/schema/suggestion");
  const { eq } = await import("drizzle-orm");
  const rows = getDb()
    .selectDistinct({ tag: memoryEventTag.tag })
    .from(memoryEventTag)
    .where(eq(memoryEventTag.familyId, familyId))
    .orderBy(memoryEventTag.tag)
    .all();
  return rows.map((r) => r.tag);
}
