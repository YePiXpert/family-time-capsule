import Link from "next/link";
import { MediaImage } from "@/components/media-view";
import { Icon } from "@/components/ui/icons";
import type { HomeDashboardDto } from "@/lib/home/service";

/**
 * 大字简洁显示（长辈阅读）首页：只保留日常四件事——
 * 最近的照片、最近的故事、听听家人的声音、我也说几句。
 * 数据全部来自真实家庭档案与当前角色权限；空状态如实说明，不造示例内容。
 * 复杂入口（收件箱、批量导入、AI、备份等）在这里不再露出，
 * 但路由与权限完全不变，随时可以从「返回标准显示」回到完整界面。
 */
export function SimpleHome({ dashboard }: { dashboard: HomeDashboardDto }) {
  const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "long",
    timeZone: dashboard.family.timezone,
  });
  const today = dateFormatter.format(new Date());
  const recentPhotos = dashboard.recentMemories.filter(
    (memory) => memory.cover?.type === "image",
  );

  return (
    <main className="page-container">
      <header>
        <p className="page-eyebrow">家庭时间胶囊</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">
          {dashboard.family.name}
        </h1>
        <p className="mt-2 text-lg text-muted">{today}</p>
      </header>

      <section aria-label="我也说几句" className="mt-8">
        {dashboard.canCapture ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Link
              href="/capture#audio"
              className="ui-button-primary justify-center text-lg"
            >
              <Icon name="microphone" size={24} className="mr-2" />
              说一段话
            </Link>
            <Link
              href="/capture#photo"
              className="ui-button-secondary justify-center text-lg"
            >
              <Icon name="image" size={24} className="mr-2" />
              拍张照片
            </Link>
          </div>
        ) : (
          <p className="rounded-2xl border border-line bg-surface p-5 text-base leading-8">
            你现在以只读方式查看家庭档案；想补充内容时，请联系家里帮你调整。
          </p>
        )}
      </section>

      <section aria-label="最近的照片" className="mt-10">
        <h2 className="text-2xl font-semibold">最近的照片</h2>
        {recentPhotos.length === 0 ? (
          <p className="mt-3 rounded-2xl border border-line bg-surface p-5 text-lg leading-9 text-muted">
            这里还没有最近的照片。
          </p>
        ) : (
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
            {recentPhotos.slice(0, 6).map((memory) => (
              <Link
                key={memory.id}
                href={`/memories/${memory.id}`}
                className="block overflow-hidden rounded-2xl border border-line bg-surface"
              >
                <span className="block aspect-[4/3] w-full">
                  <MediaImage
                    assetId={memory.cover!.assetId}
                    mimeType={memory.cover!.mimeType}
                    thumbAssetId={memory.cover!.thumbAssetId}
                    alt={`${memory.title}的照片`}
                    className="h-full w-full"
                    imgClassName="h-full w-full object-cover"
                  />
                </span>
                <span className="block p-3">
                  <span className="block truncate text-lg font-semibold">
                    {memory.title}
                  </span>
                  <span className="mt-1 block text-base text-muted">
                    {dateFormatter.format(memory.occurredAt)}
                  </span>
                </span>
              </Link>
            ))}
          </div>
        )}
        <p className="mt-3">
          <Link href="/timeline" className="ui-text-link text-lg">
            看更多照片和回忆
          </Link>
        </p>
      </section>

      <section aria-label="听听家人的声音" className="mt-10">
        <h2 className="text-2xl font-semibold">听听家人的声音</h2>
        {dashboard.voices.length === 0 ? (
          <p className="mt-3 rounded-2xl border border-line bg-surface p-5 text-lg leading-9 text-muted">
            还没有家人的录音；说一段话，以后就能在这里听到。
          </p>
        ) : (
          <ul className="mt-4 space-y-4">
            {dashboard.voices.map((voice) => (
              <li
                key={voice.id}
                className="rounded-2xl border border-line bg-surface p-5"
              >
                <p className="text-lg font-semibold">
                  {voice.authorName} ·{" "}
                  <Link href={`/memories/${voice.memoryEventId}`} className="ui-text-link">
                    {voice.eventTitle}
                  </Link>
                </p>
                <audio
                  controls
                  preload="metadata"
                  src={`/api/media/${voice.audioAssetId}`}
                  aria-label={`${voice.authorName}在「${voice.eventTitle}」里的讲述录音`}
                  className="mt-3 w-full"
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="最近的故事" className="mt-10">
        <h2 className="text-2xl font-semibold">最近的故事</h2>
        {dashboard.recentStory ? (
          <Link
            href={`/stories/${dashboard.recentStory.id}`}
            className="mt-4 block rounded-2xl border border-line bg-surface p-5"
          >
            <span className="block text-xl font-semibold leading-8">
              {dashboard.recentStory.title}
            </span>
            <span className="mt-2 inline-flex items-center text-lg font-semibold text-accent">
              打开读一读
              <Icon name="chevron-right" size={20} className="ml-1" />
            </span>
          </Link>
        ) : (
          <p className="mt-3 rounded-2xl border border-line bg-surface p-5 text-lg leading-9 text-muted">
            还没有整理好的家庭故事。
          </p>
        )}
      </section>
    </main>
  );
}
