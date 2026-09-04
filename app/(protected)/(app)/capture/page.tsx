import type { Metadata } from "next";
import { requireFamily } from "@/lib/family/context";
import { hasFamilyCapability } from "@/lib/authz/policy";
import { listPeople } from "@/lib/family/service";
import { PageHeader } from "@/components/page-header";
import { InlineNotice } from "@/components/inline-notice";
import { CaptureEditor } from "./capture-editor";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "记录 · Family Time Capsule" };

export default async function CapturePage() {
  const { familyId, role } = await requireFamily();
  const canCapture = hasFamilyCapability(role, "capture:create");
  const canArchive = hasFamilyCapability(role, "inbox:review");
  const people = canCapture ? await listPeople(familyId) : [];

  return (
    <main className="page-container">
      <PageHeader
        eyebrow="Capture"
        title="记录这一刻"
        description="一句话、一张照片或一段声音都够。原件会先安全进入收件箱，发生时间与导入时间始终分开保存。"
      />

      {canCapture ? (
        <CaptureEditor
          canArchive={canArchive}
          people={people.map((person) => ({
            id: person.id,
            displayName: person.displayName,
            isChild: person.isChild,
          }))}
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
