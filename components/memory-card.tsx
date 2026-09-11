import Link from "next/link";
import { MediaImage } from "./media-view";
import { Icon } from "./ui/icons";

export type MemoryCardProps = {
  id: string;
  title: string;
  bodyText?: string;
  dateLabel: string;
  ageLabel?: string | null;
  location?: string | null;
  people?: string[];
  assetCount?: number;
  cover?: null | { assetId: string; mimeType: string; thumbAssetId?: string | null; type?: string | null };
  href?: string;
  compact?: boolean;
  milestoneType?: string | null;
  isPinned?: boolean;
};

const MILESTONE_LABEL: Record<string, string> = {
  first_time: "第一次",
  growth: "成长节点",
  family: "家庭时刻",
  learning: "学会了",
  celebration: "值得庆祝",
  other: "值得记住",
};

export function MemoryCard({ id, title, bodyText, dateLabel, ageLabel, location, people = [], assetCount = 0, cover, href, compact = false, milestoneType, isPinned = false }: MemoryCardProps) {
  const detailHref = href ?? `/memories/${id}`;
  return (
    <div className={`memory-card ${compact ? "memory-card-compact" : ""}`}>
      <Link href={detailHref} className="memory-card-media" aria-hidden="true" tabIndex={-1}>
        {cover?.type === "image" || (cover && !cover.type) ? (
          <MediaImage assetId={cover.assetId} mimeType={cover.mimeType} thumbAssetId={cover.thumbAssetId} alt="" className="h-full w-full" imgClassName="h-full w-full object-cover" loading="lazy" />
        ) : (
          <span className="memory-card-placeholder"><Icon name={cover?.type === "audio" ? "audio" : cover?.type === "video" ? "video" : "archive"} size={28} /></span>
        )}
      </Link>
      <div className="min-w-0 flex-1 p-4">
        {milestoneType || isPinned ? (
          <p className="mb-1 flex flex-wrap gap-1.5 text-[0.68rem] font-semibold tracking-wide text-accent">
            {isPinned ? <span>置顶记忆</span> : null}
            {isPinned && milestoneType ? <span aria-hidden="true">·</span> : null}
            {milestoneType ? <span>{MILESTONE_LABEL[milestoneType] ?? "成长节点"}</span> : null}
          </p>
        ) : null}
        <Link href={detailHref} className="memory-card-body">
          <p className="text-xs font-medium text-accent">{dateLabel}{ageLabel ? ` · ${ageLabel}` : ""}</p>
          <h3 className="mt-1 line-clamp-2 text-base font-semibold leading-6 sm:text-lg">{title}</h3>
          {bodyText && bodyText !== title ? <p className="mt-2 line-clamp-3 whitespace-pre-wrap leading-7 text-foreground">{bodyText}</p> : null}
          {location ? <p className="mt-1 truncate text-sm text-muted">{location}</p> : null}
          <p className="mt-2 truncate text-xs text-faint">{people.join(" · ")}{people.length && assetCount ? " · " : ""}{assetCount ? `${assetCount} 份素材` : ""}</p>
        </Link>
      </div>
      <Link href={detailHref} className="memory-card-actions glass-overlay" aria-hidden="true" tabIndex={-1}>
        <span className="memory-card-actions-more"><Icon name="more" size={18} /></span>
        <span className="memory-card-actions-view"><Icon name="chevron-right" size={18} /></span>
      </Link>
    </div>
  );
}
