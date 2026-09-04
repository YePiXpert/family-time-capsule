import type { Metadata } from "next";
import Link from "next/link";
import { requireFamily } from "@/lib/family/context";
import { listPeople } from "@/lib/family/service";
import { listCapsules } from "@/lib/capsules/service";
import { CreateCapsuleForm } from "./create-capsule-form";
import { hasFamilyCapability } from "@/lib/authz/policy";
import { createContributionAccessSnapshot } from "@/lib/authz/contribution-access";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "胶囊 · Family Time Capsule" };

const STATUS_LABEL: Record<string, string> = {
  draft: "内容收集中",
  sealed: "已封存",
  opened: "已开启",
};

function unlockLabel(type: string, value: string): string {
  return type === "date" ? `${value} 开启` : `孩子 ${value} 岁开启`;
}

export default async function CapsulesPage() {
  const context = await requireFamily();
  const canWrite = hasFamilyCapability(context.role, "capsule:write");
  const people = await listPeople(context.familyId);
  const childBirthDate = people.find((p) => p.isChild)?.birthDate ?? null;
  const items = await listCapsules(
    createContributionAccessSnapshot(context),
    childBirthDate,
  );

  return (
    <main className="page-container max-w-5xl">
      <PageHeader
        eyebrow="For the future"
        title="时间胶囊"
        description="把此刻的记忆和想说的话放进去，按日期或孩子年龄等待未来开启。完整备份始终保留封存内容，避免珍贵资料意外丢失。"
      />

      <section aria-label="胶囊列表" className="mt-8 grid gap-4 sm:grid-cols-2">
        {items.length === 0 && (
          <div className="sm:col-span-2">
            <EmptyState
              icon="capsule"
              title="还没有写给未来的胶囊"
              description="可以先创建一个草稿，慢慢放入记忆、家人的话和想留给未来的问题。"
              action={canWrite ? "在下方创建胶囊" : "浏览家庭记忆"}
              actionHref={canWrite ? "#create-capsule" : "/timeline"}
            />
          </div>
        )}
        {items.map((c) => (
          <Link
            key={c.id}
            href={`/capsules/${c.id}`}
            className="group flex min-h-52 flex-col justify-between rounded-2xl border border-line bg-surface p-5 transition-colors hover:border-accent/50"
          >
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <StatusBadge tone={c.status === "opened" ? "success" : c.unlocked ? "accent" : "neutral"}>
                  {STATUS_LABEL[c.status] ?? c.status}
                </StatusBadge>
                <span className="text-xs font-medium text-accent">{c.countdownLabel}</span>
              </div>
              <h2 className="mt-6 text-xl font-semibold leading-7">{c.title}</h2>
              <p className="mt-2 text-sm text-muted">
                {unlockLabel(c.unlockType, c.unlockValue)}
              </p>
            </div>
            <span className="mt-6 inline-flex min-h-11 items-center justify-between border-t border-line pt-3 text-sm font-semibold text-accent">
              {c.status === "opened" ? "重新打开" : c.status === "draft" ? "继续准备" : c.unlocked ? "开启胶囊" : "查看封存状态"}
              <span>{c.itemCount} 份内容</span>
            </span>
          </Link>
        ))}
      </section>

      {canWrite && (
        <section id="create-capsule" aria-label="创建胶囊" className="mt-10 rounded-2xl border border-line bg-surface p-5 sm:p-6">
          <h2 className="text-lg font-medium">创建胶囊</h2>
          <CreateCapsuleForm />
        </section>
      )}
    </main>
  );
}
