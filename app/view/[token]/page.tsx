import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { resolveReadGrant, listReadGrantEntries } from "@/lib/family/read-grants";

// 访客限定阅读（ID-5）：无账号、单一相册、只读。
// 与投递箱相同的隐私纪律：不暴露家庭数据（家庭名、成员、其他相册）。
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "家人分享给你的相册 · Family Time Capsule",
  robots: { index: false, follow: false },
};

export default async function GuestViewPage(
  props: PageProps<"/view/[token]">,
) {
  const params = await props.params;
  const token = typeof params.token === "string" ? params.token : "";
  const grant = resolveReadGrant(token);
  if (!grant) notFound();
  const entries = listReadGrantEntries(grant);

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-5 py-12 sm:px-6">
      <h1 className="text-2xl font-semibold">{grant.collectionTitle}</h1>
      {grant.collectionDescription ? (
        <p className="mt-2 max-w-2xl text-base leading-7 text-foreground/70">
          {grant.collectionDescription}
        </p>
      ) : null}
      <p className="mt-2 text-sm text-foreground/55">
        这是家人分享给你的只读相册链接：只能在这里浏览，不能下载整册、投稿或看到家庭的其他内容。
        链接可能过期或被随时收回。
      </p>

      {entries.length === 0 ? (
        <p className="mt-10 text-sm text-foreground/60">相册还没有内容。</p>
      ) : (
        <div className="mt-8 flex flex-col gap-8">
          {entries.map((entry) => (
            <section
              key={entry.eventId}
              aria-label={entry.title}
              className="rounded-2xl border border-foreground/10 bg-foreground/[0.02] p-4 sm:p-5"
            >
              <h2 className="font-medium">{entry.title}</h2>
              {entry.caption ? (
                <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-foreground/70">
                  {entry.caption}
                </p>
              ) : null}
              {entry.assets.length > 0 ? (
                <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {entry.assets.map((item) => (
                    <li key={item.assetId} className="overflow-hidden rounded-xl border border-foreground/10 bg-background">
                      {item.type === "image" ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={`/api/media/${item.assetId}?grant=${encodeURIComponent(token)}`} alt={entry.title} loading="lazy" className="h-40 w-full object-cover" />
                      ) : item.type === "audio" ? <audio aria-label={entry.title} controls preload="none" src={`/api/media/${item.assetId}?grant=${encodeURIComponent(token)}`} className="w-full" />
                        : item.type === "video" ? <video aria-label={entry.title} controls preload="metadata" src={`/api/media/${item.assetId}?grant=${encodeURIComponent(token)}`} className="w-full" />
                        : <a className="ui-button-secondary min-h-11" href={`/api/media/${item.assetId}?grant=${encodeURIComponent(token)}`}>打开文档</a>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-foreground/50">这条记忆暂无可浏览的影像。</p>
              )}
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
