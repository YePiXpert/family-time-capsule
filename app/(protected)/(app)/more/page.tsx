import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { QuickAction } from "@/components/quick-action";
import { SectionHeader } from "@/components/section-header";
import { requireFamily } from "@/lib/family/context";
import { hasFamilyCapability } from "@/lib/authz/policy";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "我的 · Family Time Capsule" };

/**
 * 正式 1.0「我的」页(M1):同步与保全、下载与作品、隐私、账号与高级设置。
 * 面向「这一个成员自己」的入口;家庭公共内容(记忆/家人)不在一级导航之外重复。
 */
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
      <PageHeader title="我的" description="你的同步、下载、隐私、账号与家庭保全都在这里。" />

      <section className="mt-8" aria-label="同步与保全">
        <SectionHeader title="同步与保全" description="家庭档案的备份、导出与恢复" />
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {canReadBooks ? <QuickAction href="/settings/backup" icon="archive" label="备份与导出" description="完整家庭档案 ZIP、远程备份与恢复" /> : null}
          {canReadBooks ? <QuickAction href="/books" icon="book" label="书籍与作品" description="年度成书、相册作品与下载" /> : null}
          <QuickAction href="/imports" icon="upload" label="批量导入" description="查看并继续持久化导入批次" />
        </div>
      </section>

      <section className="mt-10" aria-label="隐私">
        <SectionHeader title="隐私" description="AI 外发授权与可见范围" />
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <QuickAction href="/settings/ai" icon="spark" label="AI 与隐私" description="分能力的处理授权、接收方与关闭方式" />
        </div>
      </section>

      <section className="mt-10" aria-label="账号">
        <SectionHeader title="账号" />
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <QuickAction href="/settings" icon="settings" label="设置" description="家庭、账号与高级设置" />
          {canManageFamily ? <QuickAction href="/settings/accounts" icon="people" label="成员与账号" description="家庭账号、角色与停用" /> : null}
          {canManageFamily ? <QuickAction href="/settings/invitations" icon="upload" label="邀请家人" description="生成与撤销加入邀请" /> : null}
        </div>
      </section>

      <section className="mt-10" aria-label="家庭内容">
        <SectionHeader title="家庭内容" description="故事、回顾与胶囊的直达入口" />
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <QuickAction href="/search" icon="search" label="搜索" description="从记忆、讲述、标签与故事中寻找" />
          <QuickAction href="/review" icon="story" label="每周回顾" description="整理本周素材、家人声音与故事草稿" />
          {canWriteStories ? <QuickAction href="/stories" icon="story" label="故事" description="阅读周记、月章与年度故事" /> : null}
          {canCreateContributions ? <QuickAction href="/requests" icon="microphone" label="口述史" description="向家人发起一个讲述问题" /> : null}
          {canCreateContributions ? <QuickAction href="/contributions" icon="upload" label="家庭投递箱" description="请家人无需账号提交原件与文字" /> : null}
          {canWriteCapsules ? <QuickAction href="/capsules" icon="capsule" label="时间胶囊" description="封存此刻,等待未来开启" /> : null}
          {canWriteEvents ? <QuickAction href="/trash" icon="trash" label="回收站" description="恢复或清除已删除内容" /> : null}
        </div>
      </section>
    </main>
  );
}
