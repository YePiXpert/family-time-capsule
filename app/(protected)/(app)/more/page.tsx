import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { QuickAction } from "@/components/quick-action";
import { SectionHeader } from "@/components/section-header";
import { requireFamily } from "@/lib/family/context";
import { hasFamilyCapability } from "@/lib/authz/policy";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "更多 · Family Time Capsule" };

export default async function MorePage() {
  const { role } = await requireFamily();
  const canBackup = hasFamilyCapability(role, "archive:export");
  return (
    <main className="page-container">
      <PageHeader title="更多" description="家人讲述、成品与档案管理都在这里。" />
      <section className="mt-8">
        <SectionHeader title="发现与讲述" />
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <QuickAction href="/search" icon="search" label="搜索" description="从记忆、讲述、标签与故事中寻找" />
          <QuickAction href="/family" icon="people" label="家人" description="查看每个人参与的记忆与声音" />
          <QuickAction href="/stories" icon="story" label="故事" description="阅读周记、月章与年度故事" />
          <QuickAction href="/requests" icon="microphone" label="口述史" description="向家人发起一个讲述问题" />
          <QuickAction href="/capsules" icon="capsule" label="时间胶囊" description="封存此刻，等待未来开启" />
        </div>
      </section>
      <section className="mt-10">
        <SectionHeader title="档案管理" />
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {canBackup ? <QuickAction href="/settings/backup" icon="book" label="书籍与备份" description="成书、完整导出与远程备份" /> : null}
          <QuickAction href="/settings" icon="settings" label="设置" description="家庭、账号与高级设置" />
          <QuickAction href="/trash" icon="trash" label="回收站" description="恢复或清除已删除内容" />
        </div>
      </section>
    </main>
  );
}
