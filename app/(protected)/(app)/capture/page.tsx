import { getDraft, listDraftReaders } from "@/lib/drafts/service";
import type { Metadata } from "next";
import { requireFamily } from "@/lib/family/context";
import { hasFamilyCapability } from "@/lib/authz/policy";
import { listPeople } from "@/lib/family/service";
import { PageHeader } from "@/components/page-header";
import { InlineNotice } from "@/components/inline-notice";
import { PersistentCaptureEditor } from "./persistent-capture-editor";
import { getAiOperationalStatus } from "@/lib/ai/jobs";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "记录 · Family Time Capsule" };

export default async function CapturePage({ searchParams }: { searchParams: Promise<{ draft?: string }> }) {
  const context = await requireFamily();
  const { familyId, role, userId, familyTimezone } = context;
  const query = await searchParams;
  const canCapture = hasFamilyCapability(role, "capture:create");
  const canArchive = hasFamilyCapability(role, "inbox:review");
  const people = canCapture ? await listPeople(familyId) : [];
  // §5：指定读者按家庭账号（用户）选择；参与人物不是读者。
  const memberRows = canCapture ? listDraftReaders(context) : [];

  return (
    <main className="page-container capture-page max-w-3xl">
      <PageHeader
        eyebrow="值得留下的一刻"
        title="记录这一刻"
        description="一张照片、一段声音，或一句想对宝宝说的话。"
      />

      {canCapture ? (
        <PersistentCaptureEditor
          initialServerDraft={canCapture && query.draft ? getDraft(context, query.draft) : undefined}
          scope={`${userId}:${familyId}`}
          timezone={familyTimezone}
          canArchive={canArchive}
          aiSettings={hasFamilyCapability(role, "ai:review") ? getAiOperationalStatus(context) : null}
          people={people.map((person) => ({
            id: person.id,
            displayName: person.displayName,
            isChild: person.isChild,
          }))}
          members={memberRows}
        />
      ) : (
        <div className="mt-8">
          <InlineNotice tone="info" title="只读访问">
            当前账号是只读角色，可以浏览家庭档案，但不能添加新内容。
          </InlineNotice>
        </div>
      )}
    </main>
  );
}
