import { getDraft, listDraftReaders } from "@/lib/drafts/service";
import type { Metadata } from "next";
import { requireFamily } from "@/lib/family/context";
import { hasFamilyCapability } from "@/lib/authz/policy";
import { listPeople } from "@/lib/family/service";
import { PageHeader } from "@/components/page-header";
import { InlineNotice } from "@/components/inline-notice";
import { PersistentCaptureEditor } from "./persistent-capture-editor";
import Link from "next/link";

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
    <main className="page-container">
      <PageHeader
        eyebrow="Capture"
        title="记录这一刻"
        description="围绕一件事写文字、加照片和录音。草稿自动保存在本机，明天还能继续。"
        actions={canCapture ? <Link href="/imports" className="ui-button-secondary">批量导入</Link> : undefined}
      />

      {canCapture ? (
        <PersistentCaptureEditor
          initialServerDraft={canCapture && query.draft ? getDraft(context, query.draft) : undefined}
          scope={`${userId}:${familyId}`}
          timezone={familyTimezone}
          canArchive={canArchive}
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
