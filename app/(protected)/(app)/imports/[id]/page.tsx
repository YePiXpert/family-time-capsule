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
    <PageHeader backHref="/imports" backLabel="返回批量导入" eyebrow="Import session" title={detail.session.defaultTitle || "导入批次"} description={`完成 ${detail.session.completedCount}/${detail.session.totalCount}，失败 ${detail.session.failedCount}。刷新不会丢服务器进度。`} />
    <BatchImportCenter initial={initial} people={people.map((person) => ({ id: person.id, displayName: person.displayName, isChild: person.isChild }))} />
  </main>;
}
