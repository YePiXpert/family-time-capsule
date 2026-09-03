import type { Metadata } from "next";
import Link from "next/link";
import { and, eq, inArray } from "drizzle-orm";
import { requireFamily } from "@/lib/family/context";
import { getInboxPage } from "@/lib/inbox/service";
import { getThumbnailMap } from "@/lib/assets/service";
import { getDb } from "@/db";
import { aiSuggestion } from "@/db/schema/suggestion";
import { hasFamilyCapability } from "@/lib/authz/policy";
import { listPendingClusterSuggestions } from "@/lib/clusters/service";
import {
  getAiRuntimeDisclosure,
  listAiProcessingConsents,
} from "@/lib/ai/jobs";
import { utcToZonedWallTimeInput } from "@/lib/metadata/time";
import { getFamily } from "@/lib/family/service";
import { InboxBoard } from "./inbox-board";
import { InboxSuggestButton } from "./inbox-suggestion-ui";
import { ClusterSuggestionPanel } from "./cluster-suggestion-ui";
import type { InboxSuggestionChipDto } from "./inbox-suggestion-ui";
import type { ClusterSuggestionDto } from "./cluster-suggestion-ui";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "收件箱 · Family Time Capsule" };

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireFamily();
  const { familyId, role } = context;
  const canReview = hasFamilyCapability(role, "inbox:review");
  const canAiReview = hasFamilyCapability(role, "ai:review");
  const params = await searchParams;
  const cursorParam = typeof params.cursor === "string" ? params.cursor : null;
  const page = await getInboxPage(familyId, undefined, { cursor: cursorParam });
  const entries = page.entries;
  const family = await getFamily(familyId);
  const timezone = family?.timezone ?? "Asia/Shanghai";

  // 收件箱封面优先用缩略图（避免列表加载全尺寸原件）
  const thumbMap = await getThumbnailMap(
    familyId,
    entries.map((e) => e.assets[0]?.id).filter((id): id is string => Boolean(id)),
  );

  // M3-E：按条目聚合 pending 建议并预填（title / occurredAt）
  const entryIds = entries.map((e) => e.item.id);
  const suggestionRows =
    canReview && entryIds.length > 0
      ? getDb()
          .select()
          .from(aiSuggestion)
          .where(
            and(
              eq(aiSuggestion.familyId, familyId),
              eq(aiSuggestion.entityType, "inbox_item"),
              eq(aiSuggestion.status, "pending"),
              inArray(aiSuggestion.entityId, entryIds),
            ),
          )
          .all()
      : [];

  const suggestionsByItem = new Map<
    string,
    {
      chips: InboxSuggestionChipDto[];
      title?: string;
      occurredWall?: string;
    }
  >();
  for (const row of suggestionRows) {
    const bucket = suggestionsByItem.get(row.entityId) ?? {
      chips: [] as InboxSuggestionChipDto[],
    };
    let displayValue = "";
    let precision: string | undefined;
    try {
      const payload = JSON.parse(row.valueJson) as Record<string, unknown>;
      if (row.suggestionType === "title") {
        displayValue = String(payload.title ?? "");
      } else if (row.suggestionType === "occurred_at") {
        const iso = String(payload.occurredAt ?? "");
        const d = new Date(iso);
        if (!Number.isNaN(d.getTime())) {
          displayValue = new Intl.DateTimeFormat("zh-CN", {
            dateStyle: "medium",
            timeStyle: "short",
            timeZone: timezone,
          }).format(d);
          precision = String(payload.precision ?? "approximate");
          bucket.occurredWall ??= utcToZonedWallTimeInput(d, timezone);
        }
      } else if (row.suggestionType === "person") {
        displayValue = String(payload.personName ?? "");
      } else if (row.suggestionType === "tag") {
        displayValue = String(payload.tag ?? "");
      }
    } catch {
      continue;
    }
    if (!displayValue) continue;
    if (row.suggestionType === "title") bucket.title ??= displayValue;
    bucket.chips.push({ id: row.id, type: row.suggestionType, displayValue, precision });
    suggestionsByItem.set(row.entityId, bucket);
  }

  // M3-F：本地分簇建议（成员摘要从当前条目取）
  const entryById = new Map(entries.map((e) => [e.item.id, e]));
  const clusterRows = canReview
    ? await listPendingClusterSuggestions(familyId)
    : [];
  const clusters: ClusterSuggestionDto[] = [];
  for (const row of clusterRows) {
    let ids: string[] = [];
    try {
      ids = JSON.parse(row.inboxItemIdsJson) as string[];
    } catch {
      continue;
    }
    const memberLabels = ids.flatMap((id) => {
      const entry = entryById.get(id);
      if (!entry) return [];
      const label =
        entry.assets[0]?.originalFilename ??
        entry.item.rawText?.trim().slice(0, 16) ??
        "条目";
      return [label.replace(/\.[a-z0-9]{1,8}$/i, "")];
    });
    if (memberLabels.length < 2) continue; // 成员已不在收件箱 → 由扫描清理
    clusters.push({
      id: row.id,
      kind: row.kind,
      reasonText: row.reasonText,
      memberLabels,
    });
  }

  // AI 建议按钮可用性：provider 配置有效 + text 能力 + （外部 provider 时）已同意
  const disclosure = getAiRuntimeDisclosure();
  const consents = canAiReview ? await listAiProcessingConsents(context) : [];
  const textConsent = consents.find((c) => c.capability === "text");
  const textSuggestAvailable =
    canAiReview &&
    disclosure.valid &&
    disclosure.capabilities?.text?.available === true &&
    (disclosure.external === false || textConsent?.enabled === true);

  const withSuggestions = entries.map((e) => {
    const bucket = suggestionsByItem.get(e.item.id);
    return {
      ...e,
      coverThumbAssetId: e.assets[0]
        ? (thumbMap.get(e.assets[0].id)?.id ?? null)
        : null,
      suggestionChips: bucket?.chips ?? [],
      suggestedTitle: bucket?.title,
      suggestedOccurredWall: bucket?.occurredWall,
    };
  });

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-16">
      <h1 className="text-2xl font-semibold">收件箱</h1>
      <p className="mt-2 text-sm leading-6 text-foreground/60">
        {canReview
          ? "新内容先在这里整理：确认真实时间后进入时间轴。勾选多项可以合并成一件事。"
          : "这里列出尚待整理的内容；当前角色可以查看，但整理与确认由管理员或编辑完成。"}
      </p>

      {canReview && entries.length > 0 && (
        <ClusterSuggestionPanel suggestions={clusters} />
      )}

      {canReview && textSuggestAvailable && entries.length > 0 && (
        <InboxSuggestButton />
      )}

      {page.nextCursor && (
        <div className="mt-6 text-center text-sm">
          <Link
            href={`/inbox?cursor=${page.nextCursor}`}
            className="rounded-lg border border-foreground/20 px-4 py-2 transition-colors hover:border-accent"
          >
            下一页
          </Link>
        </div>
      )}

      {entries.length === 0 ? (
        <div className="mt-10 rounded-xl border border-dashed border-foreground/20 p-8 text-center text-sm text-foreground/50">
          没有待整理的内容。去
          <Link href="/capture" className="mx-1 underline underline-offset-2">
            记录
          </Link>
          页上传照片、录音或写下一段话。
        </div>
      ) : (
        <InboxBoard entries={withSuggestions} canReview={canReview} />
      )}
    </main>
  );
}
