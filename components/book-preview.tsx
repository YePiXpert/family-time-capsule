"use client";
import Image from "next/image";
import Link from "next/link";
import type { BookDetail } from "@/mobile/src/books/types";
const warnings = {
  missing_source: "来源已删除或当前不可见，这一块暂不进入阅读产物。",
  source_changed: "来源已有变化，手工文字仍保留，请核对。",
  low_resolution: "图片分辨率较低，放大或打印可能不够清晰。",
  long_text: "文字较长，正式出版会续页，请检查分页。",
  empty_block: "内容块为空。",
  empty_chapter: "有章节尚未加入内容。",
};
export function BookPreview({ book }: { book: BookDetail }) {
  const date = (value: string) =>
    new Intl.DateTimeFormat("zh-CN", {
      dateStyle: "long",
      timeZone: book.timezone,
    }).format(new Date(value));
  const imagesFor = (ids: string[]) =>
    ids.flatMap((id) => {
      const asset = book.sourceStates[id]?.asset;
      return asset?.type === "image" ? [asset] : [];
    });
  const coverState = Object.values(book.sourceStates).find(
    (s) => s.available && s.asset?.id === book.coverAssetId,
  );
  const cover =
    coverState?.asset?.previewAssetId || coverState?.asset?.id || null;
  return (
    <div
      className={`mx-auto w-full ${book.pageSize === "A4" ? "max-w-3xl" : "max-w-xl"}`}
      aria-label="年册预览"
    >
      <article
        className={`my-5 overflow-hidden rounded-2xl border border-line bg-surface ${book.template === "letters" ? "p-7 font-serif" : "p-4 sm:p-7"}`}
      >
        {cover ? (
          <Image
            src={`/api/media/${cover}`}
            unoptimized
            width={900}
            height={650}
            className="mb-6 max-h-96 w-full object-contain"
            alt="作品封面"
          />
        ) : null}
        <p className="text-sm text-muted">
          {book.audience === "family" ? "家庭可读版" : "我的私人阅读版"} ·{" "}
          {book.pageSize}
        </p>
        <h2 className="mt-5 break-words text-3xl">{book.title}</h2>
        <p className="mt-3 whitespace-pre-wrap text-lg">{book.subtitle}</p>
        {book.startDate || book.endDate ? (
          <p className="mt-4 text-sm text-muted">
            {book.startDate || "起始日期未定"} —{" "}
            {book.endDate || "结束日期未定"}
          </p>
        ) : null}
      </article>
      <nav
        aria-label="作品目录"
        className="my-6 rounded-2xl border border-line p-5"
      >
        <h2 className="text-lg">目录</h2>
        <ol>
          {book.chapters.map((chapter, i) => (
            <li key={chapter.id}>
              <a
                className="ui-text-link inline-flex min-h-11 items-center break-words"
                href={`#book-chapter-${chapter.id}`}
              >
                {i + 1}. {chapter.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>
      {book.chapters.map((chapter) => (
        <section
          key={chapter.id}
          id={`book-chapter-${chapter.id}`}
          className={`my-7 scroll-mt-6 rounded-2xl border border-line bg-surface p-4 sm:p-7 ${book.template === "letters" ? "font-serif" : ""}`}
        >
          <h2 className="mb-6 break-words text-2xl">{chapter.title}</h2>
          {book.blocks
            .filter((b) => b.chapterId === chapter.id)
            .map((block) => {
              const states = block.sourceIds
                  .map((id) => book.sourceStates[id])
                  .filter(Boolean),
                images = imagesFor(block.sourceIds),
                event = states.find((s) => s?.occurredAt),
                author = states.find((s) => s?.author)?.author;
              const refs = block.sourceIds.flatMap((id) => {
                const ref = book.sources.find((s) => s.id === id);
                return ref?.kind === "memory" && ref.memoryEventId ? [ref] : [];
              });
              return (
                <article
                  key={block.id}
                  className={`${block.layout.breakBefore ? "mt-8 border-t border-line pt-6" : "mt-4"} ${book.template === "photos" ? "space-y-3" : "space-y-4"}`}
                >
                  {book.blockedBlockIds.includes(block.id) ? (
                    <p className="rounded-xl border border-dashed border-line p-5 text-muted">
                      来源已删除或当前不可见
                    </p>
                  ) : (
                    <>
                      {block.kind === "date" ? (
                        <p className="text-sm text-accent">
                          {event?.occurredAt
                            ? date(event.occurredAt)
                            : "日期未知"}
                          {event?.ageLabel ? ` · ${event.ageLabel}` : ""}
                        </p>
                      ) : null}
                      {["image", "double", "collage"].includes(block.kind) ? (
                        <div
                          className={`grid gap-3 ${block.kind === "image" ? "grid-cols-1" : "grid-cols-2"}`}
                        >
                          {images
                            .slice(
                              0,
                              block.kind === "image"
                                ? 1
                                : block.kind === "double"
                                  ? 2
                                  : 4,
                            )
                            .map((asset, i) => (
                              <Image
                                key={`${asset.id}-${i}`}
                                src={`/api/media/${asset.previewAssetId || asset.id}`}
                                unoptimized
                                width={900}
                                height={650}
                                alt={block.caption || asset.filename}
                                className={`w-full ${block.layout.fit === "cover" ? "aspect-square object-cover" : "max-h-96 object-contain"}`}
                                style={{
                                  objectPosition: `${(block.layout.focus[i]?.x ?? 0.5) * 100}% ${(block.layout.focus[i]?.y ?? 0.5) * 100}%`,
                                }}
                              />
                            ))}
                        </div>
                      ) : null}
                      {block.kind === "quote" ? (
                        <blockquote className="border-l-2 border-accent/40 pl-4">
                          <p className="whitespace-pre-wrap break-words text-lg leading-8">
                            {block.text}
                          </p>
                          {author ? (
                            <footer className="mt-3 text-sm text-muted">
                              — {author}
                              {event?.occurredAt
                                ? ` · ${date(event.occurredAt)}`
                                : ""}
                            </footer>
                          ) : null}
                        </blockquote>
                      ) : block.text ? (
                        <p className="whitespace-pre-wrap break-words leading-8">
                          {block.text}
                        </p>
                      ) : null}
                      {block.caption ? (
                        <p className="whitespace-pre-wrap break-words text-sm text-muted">
                          {block.caption}
                        </p>
                      ) : null}
                    </>
                  )}
                  {refs.length ? (
                    <p className="flex flex-wrap gap-2 text-xs text-muted">
                      {refs.map((ref) => (
                        <Link
                          className="ui-text-link"
                          key={ref.id}
                          href={`/memories/${ref.memoryEventId}`}
                        >
                          来源记忆
                        </Link>
                      ))}
                    </p>
                  ) : null}
                  {book.warnings
                    .filter((w) => w.blockId === block.id)
                    .map((w) => (
                      <p key={w.code} className="text-sm text-muted">
                        {warnings[w.code]}
                      </p>
                    ))}
                </article>
              );
            })}
        </section>
      ))}
      {!book.blocks.length ? (
        <p className="my-5 rounded-xl border border-dashed border-line p-5 text-muted">
          还没有选材。可以从真实记忆、相册或已发布故事中挑选，也可以手工插入内容。
        </p>
      ) : null}
    </div>
  );
}
