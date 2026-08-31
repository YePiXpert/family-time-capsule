import type { Metadata } from "next";
import Link from "next/link";
import { requireFamily } from "@/lib/family/context";
import { listPeople } from "@/lib/family/service";
import { listCapsules } from "@/lib/capsules/service";
import { CreateCapsuleForm } from "./create-capsule-form";
import { hasFamilyCapability } from "@/lib/authz/policy";
import { createContributionAccessSnapshot } from "@/lib/authz/contribution-access";

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
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-16">
      <h1 className="text-2xl font-semibold">胶囊</h1>
      <p className="mt-2 text-sm leading-6 text-foreground/60">
        封存此刻，等未来开启。封存后正文在到达条件前不会显示，
        但备份与导出永远完整（这是仪式，不是加密）。
      </p>

      <section aria-label="胶囊列表" className="mt-8 flex flex-col gap-3">
        {items.length === 0 && (
          <p className="text-sm text-foreground/50">还没有胶囊。</p>
        )}
        {items.map((c) => (
          <Link
            key={c.id}
            href={`/capsules/${c.id}`}
            className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-xl border border-foreground/10 bg-foreground/[0.02] px-4 py-4 transition-colors hover:border-accent/50"
          >
            <div className="flex min-w-0 flex-col">
              <span className="font-medium">{c.title}</span>
              <span className="text-sm text-foreground/60">
                {unlockLabel(c.unlockType, c.unlockValue)} · {c.itemCount} 份内容
              </span>
            </div>
            <span
              className={`rounded border px-2 py-0.5 text-xs ${
                c.status === "opened"
                  ? "border-accent/50 text-accent"
                  : c.status === "sealed"
                    ? "border-foreground/20 text-foreground/60"
                    : "border-foreground/10 text-foreground/50"
              }`}
            >
              {STATUS_LABEL[c.status] ?? c.status}
              {c.status === "sealed" && (c.unlocked ? " · 可开启" : " · 未到时间")}
            </span>
          </Link>
        ))}
      </section>

      {canWrite && (
        <section aria-label="创建胶囊" className="mt-10">
          <h2 className="text-lg font-medium">创建胶囊</h2>
          <CreateCapsuleForm />
        </section>
      )}
    </main>
  );
}
