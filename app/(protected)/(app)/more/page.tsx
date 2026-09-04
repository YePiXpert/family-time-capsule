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
  const canReadBooks = hasFamilyCapability(role, "archive:view");
  const canManageFamily = hasFamilyCapability(role, "family:manage");
  const canWriteStories = hasFamilyCapability(role, "story:write");
  const canCreateContributions = hasFamilyCapability(role, "contribution:create");
  const canWriteCapsules = hasFamilyCapability(role, "capsule:write");
  const canWriteEvents = hasFamilyCapability(role, "event:write");
  return (
    <main className="page-container">
      <PageHeader title="更多" description="家人讲述、成品与档案管理都在这里。" />
      <section className="mt-8">
        <SectionHeader title="发现与讲述" />
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <QuickAction href="/search" icon="search" label="搜索" description="从记忆、讲述、标签与故事中寻找" />
          <QuickAction href="/review" icon="story" label="每周回顾" description="整理本周素材、家人声音与故事草稿" />
          {canManageFamily ? <QuickAction href="/family" icon="people" label="家人" description="查看每个人参与的记忆与声音" /> : null}
          {canWriteStories ? <QuickAction href="/stories" icon="story" label="故事" description="阅读周记、月章与年度故事" /> : null}
          {canCreateContributions ? <QuickAction href="/requests" icon="microphone" label="口述史" description="向家人发起一个讲述问题" /> : null}
          {canCreateContributions ? <QuickAction href="/contributions" icon="upload" label="家庭投递箱" description="请家人无需账号提交原件与文字" /> : null}
          {canWriteCapsules ? <QuickAction href="/capsules" icon="capsule" label="时间胶囊" description="封存此刻，等待未来开启" /> : null}
        </div>
      </section>
      <section className="mt-10">
        <SectionHeader title="档案管理" />
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {canReadBooks ? <QuickAction href="/books" icon="book" label="书籍与备份" description="年度成书、完整导出与远程备份" /> : null}
          <QuickAction href="/imports" icon="upload" label="批量导入" description="查看并继续持久化导入批次" />
          <QuickAction href="/settings" icon="settings" label="设置" description="家庭、账号与高级设置" />
          {canWriteEvents ? <QuickAction href="/trash" icon="trash" label="回收站" description="恢复或清除已删除内容" /> : null}
        </div>
      </section>
    </main>
  );
}
