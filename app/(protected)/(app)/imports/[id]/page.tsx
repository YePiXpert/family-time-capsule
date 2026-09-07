import { getDb } from "@/db";
import { and, eq } from "drizzle-orm";
import { inboxItem } from "@/db/schema/inbox";
import { getLibraryAsset } from "@/lib/assets/library";
import { listDrafts } from "@/lib/drafts/service";
import { hasFamilyCapability } from "@/lib/authz/policy";
import { IntakeDestination } from "../intake-destination";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireFamily } from "@/lib/family/context";
import { listPeople } from "@/lib/family/service";
import { getImportSessionDetail } from "@/lib/imports/service";
import { PageHeader } from "@/components/page-header";
import { BatchImportCenter, type ImportSessionDto } from "../batch-import-center";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "导入进度 · Family Time Capsule" };

export default async function ImportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, context] = await Promise.all([params, requireFamily()]);
  const [detail, people] = await Promise.all([
    getImportSessionDetail(context.familyId, id),
    listPeople(context.familyId),
  ]);
  if (!detail) notFound();
  const canChoose = detail.session.createdByUserId === context.userId && detail.session.source !== "guest" && hasFamilyCapability(context.role, "capture:create");
  const texts = canChoose ? detail.items.flatMap(({ item }) => {
    if (item.assetId || !item.inboxItemId) return [];
    const source = getDb().select().from(inboxItem).where(and(eq(inboxItem.id, item.inboxItemId), eq(inboxItem.familyId, context.familyId))).get();
    return source?.rawText ? [source.rawText] : [];
  }) : [];
  const originals = canChoose ? await Promise.all([...new Set(detail.items.flatMap(({ item }) => item.assetId ? [item.assetId] : []))].map(async id => {
    try { const asset = await getLibraryAsset(context, id); return asset ? { id, title: asset.title } : null; } catch { return null; }
  })) : [];
  const initial: ImportSessionDto = {
    session: {
      id: detail.session.id,
      source: detail.session.source,
      status: detail.session.status,
      totalCount: detail.session.totalCount,
      completedCount: detail.session.completedCount,
      failedCount: detail.session.failedCount,
      defaultTitle: detail.session.defaultTitle,
      defaultOccurredAt: detail.session.defaultOccurredAt?.toISOString() ?? null,
      defaultLocationText: detail.session.defaultLocationText,
      participantPersonIds: detail.participantPersonIds,
      createdAt: detail.session.createdAt.toISOString(),
      updatedAt: detail.session.updatedAt.toISOString(),
    },
    items: detail.items.map(({ item, upload }) => ({
      id: item.id, captureId: item.captureId, status: item.status, errorCode: item.errorCode,
      sortOrder: item.sortOrder, assetId: item.assetId, inboxItemId: item.inboxItemId,
      filename: item.filename, totalBytes: item.totalBytes,
      lastModified: item.lastModified?.getTime() ?? null, clientFingerprint: item.clientFingerprint,
      upload: upload ? {
        id: upload.id, filename: upload.filename, declaredMime: upload.declaredMime,
        totalBytes: upload.totalBytes, receivedBytes: upload.receivedBytes,
        lastModified: upload.lastModified?.getTime() ?? null,
        clientFingerprint: upload.clientFingerprint, status: upload.status,
        expiresAt: upload.expiresAt.toISOString(),
      } : null,
    })),
  };
  return <main className="page-container max-w-5xl">
    <PageHeader backHref="/imports" backLabel="返回批量导入" eyebrow="收到的内容" title={detail.session.defaultTitle || "导入批次"} description={`完成 ${detail.session.completedCount}/${detail.session.totalCount}，失败 ${detail.session.failedCount}。刷新不会丢服务器进度。`} />
    {canChoose && <IntakeDestination id={id} revision={detail.session.intakeRevision} destination={detail.session.intakeDestination} draftId={detail.session.intakeDraftId} drafts={listDrafts(context)} text={texts} assets={originals.flatMap(asset => asset ? [asset] : [])} />}
    <BatchImportCenter initial={initial} people={people.map((person) => ({ id: person.id, displayName: person.displayName, isChild: person.isChild }))} />
  </main>;
}
