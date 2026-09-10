import { getDraft, listDraftReaders } from "@/lib/drafts/service";
import type { Metadata } from "next";
import { requireFamily } from "@/lib/family/context";
import { hasFamilyCapability } from "@/lib/authz/policy";
import Link from "next/link";
import { Icon } from "@/components/ui/icons";
import styles from "./capture.module.css";
import { InlineNotice } from "@/components/inline-notice";
import { PersistentCaptureEditor } from "./persistent-capture-editor";
import { getAiOperationalStatus } from "@/lib/ai/jobs";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "记录这一刻 · 小美成长记" };

export default async function CapturePage({ searchParams }: { searchParams: Promise<{ draft?: string; localDraft?: string }> }) {
  const context = await requireFamily();
  const { familyId, role, userId, familyTimezone } = context;
  const query = await searchParams;
  const canCapture = hasFamilyCapability(role, "capture:create");
  const canArchive = hasFamilyCapability(role, "inbox:review");
  // §5：指定读者按家庭账号（用户）选择；参与人物不是读者。
  const memberRows = canCapture ? listDraftReaders(context) : [];

  return (
    <main className={`capture-page ${styles.page}`}>
      <header className={styles.heading}>
        <div>
          <span className={styles.eyebrow}>小美成长记</span>
          <h1>记录一刻</h1>
          <p>把今天的小美好，留给未来。</p>
        </div>
        <Link href="/timeline" className={styles.back}><Icon name="arrow-left" size={18} /><span>回到成长记</span></Link>
      </header>

      {canCapture ? (
        <PersistentCaptureEditor
          initialServerDraft={canCapture && query.draft ? getDraft(context, query.draft) : undefined}
          initialLocalDraftId={query.localDraft}
          scope={`${userId}:${familyId}`}
          timezone={familyTimezone}
          canArchive={canArchive}
          aiSettings={hasFamilyCapability(role, "ai:review") ? getAiOperationalStatus(context) : null}
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
