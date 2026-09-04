import Link from "next/link";
import { MediaImage } from "./media-view";
import { Icon } from "./ui/icons";

export type MemoryCardProps = {
  id: string;
  title: string;
  dateLabel: string;
  ageLabel?: string | null;
  location?: string | null;
  people?: string[];
  assetCount?: number;
  cover?: null | { assetId: string; mimeType: string; thumbAssetId?: string | null; type?: string | null };
  href?: string;
  compact?: boolean;
};

export function MemoryCard({ id, title, dateLabel, ageLabel, location, people = [], assetCount = 0, cover, href, compact = false }: MemoryCardProps) {
  return (
    <Link href={href ?? `/memories/${id}`} className={`memory-card ${compact ? "memory-card-compact" : ""}`}>
      <div className="memory-card-media">
        {cover?.type === "image" || (cover && !cover.type) ? (
          <MediaImage assetId={cover.assetId} mimeType={cover.mimeType} thumbAssetId={cover.thumbAssetId} alt="" className="h-full w-full" imgClassName="h-full w-full object-cover" />
        ) : (
          <span className="memory-card-placeholder"><Icon name={cover?.type === "audio" ? "audio" : cover?.type === "video" ? "video" : "archive"} size={28} /></span>
        )}
      </div>
      <div className="min-w-0 flex-1 p-4">
        <p className="text-xs font-medium text-accent">{dateLabel}{ageLabel ? ` · ${ageLabel}` : ""}</p>
        <h3 className="mt-1 line-clamp-2 text-base font-semibold leading-6 sm:text-lg">{title}</h3>
        {location ? <p className="mt-1 truncate text-sm text-muted">{location}</p> : null}
        <p className="mt-2 truncate text-xs text-faint">{people.join(" · ")}{people.length && assetCount ? " · " : ""}{assetCount ? `${assetCount} 份素材` : ""}</p>
      </div>
    </Link>
  );
}
