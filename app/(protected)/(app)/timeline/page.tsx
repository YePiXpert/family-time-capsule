import type { Metadata } from "next";
import Link from "next/link";
import { requireFamily } from "@/lib/family/context";
import { getFamily, listPeople } from "@/lib/family/service";
import { getTimeline } from "@/lib/memories/service";
import { formatAgeLabel } from "@/lib/memories/age";
import { MediaImage } from "@/components/media-view";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "时光轴 · Family Time Capsule" };

export default async function TimelinePage() {
  const { familyId } = await requireFamily();
  const [family, people, entries] = await Promise.all([
    getFamily(familyId),
    listPeople(familyId),
    getTimeline(familyId),
  ]);

  // 年龄基于孩子生日现算（不依赖持久化字符串）
  const child = people.find((p) => p.isChild);
  const timezone = family?.timezone ?? "Asia/Shanghai";
  const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "long",
    timeZone: timezone,
  });

  // 按年月分组（按家庭时区）
  const groups = new Map<string, typeof entries>();
  for (const entry of entries) {
    const month = new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "long",
      timeZone: timezone,
    }).format(entry.event.occurredAt);
    const list = groups.get(month) ?? [];
    list.push(entry);
    groups.set(month, list);
  }

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-16">
      <h1 className="text-2xl font-semibold">时光轴</h1>
      <p className="mt-2 text-sm leading-6 text-foreground/60">
        {child?.displayName ?? "孩子"}的成长线——按真实发生的时间排列，
        晚上传的旧照片不会跑到今天。
      </p>

      {entries.length === 0 ? (
        <div className="mt-10 rounded-xl border border-dashed border-foreground/20 p-8 text-center text-sm text-foreground/50">
          还没有记忆事件。上传的内容在
          <Link href="/inbox" className="mx-1 underline underline-offset-2">
            收件箱
          </Link>
          确认后会出现在这里。
        </div>
      ) : (
        <div className="mt-8 flex flex-col gap-10">
          {[...groups.entries()].map(([month, list]) => (
            <section key={month} aria-label={month}>
              <h2 className="text-sm font-medium tracking-widest text-foreground/50">
                {month}
              </h2>
              <ol className="mt-4 flex flex-col gap-4">
                {list.map(({ event, coverAssetId, coverAssetType, coverAssetMime, coverThumbAssetId, assetCount, participantNames }) => (
                  <li key={event.id}>
                    <Link
                      href={`/memories/${event.id}`}
                      className="flex gap-4 rounded-xl border border-foreground/10 bg-foreground/[0.02] p-4 transition-colors hover:border-accent/50"
                    >
                      {coverAssetId && coverAssetType === "image" ? (
                        <MediaImage
                          assetId={coverAssetId}
                          mimeType={coverAssetMime ?? "image/jpeg"}
                          thumbAssetId={coverThumbAssetId}
                          className="h-20 w-20 shrink-0"
                          imgClassName="h-20 w-20 shrink-0 rounded-lg border border-foreground/10 object-cover"
                        />
                      ) : (
                        coverAssetId && (
                          <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-lg border border-foreground/10 bg-foreground/[0.03] text-xs text-foreground/50">
                            {coverAssetType === "audio" ? "音频" : coverAssetType === "video" ? "视频" : "文件"}
                          </div>
                        )
                      )}
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <span className="font-medium">{event.title}</span>
                        <span className="text-sm text-foreground/60">
                          {dateFormatter.format(event.occurredAt)}
                          {child?.birthDate && (
                            <span className="ml-2 text-accent">
                              {formatAgeLabel(child.birthDate, event.occurredAt)}
                            </span>
                          )}
                        </span>
                        <span className="text-xs text-foreground/45">
                          {participantNames.join(" · ")}
                          {participantNames.length > 0 && " · "}
                          {assetCount} 份素材
                        </span>
                      </div>
                    </Link>
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
