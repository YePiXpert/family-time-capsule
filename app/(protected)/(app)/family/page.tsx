import type { Metadata } from "next";
import Link from "next/link";
import { requireFamily } from "@/lib/family/context";
import { getFamily, listPeople } from "@/lib/family/service";
import { listRecentFamilyContributions } from "@/lib/contributions/service";
import { AddPersonForm } from "./add-person-form";
import { hasFamilyCapability } from "@/lib/authz/policy";
import {
  ChildUnlockControl,
  GuardianControl,
  UnlockAgeForm,
} from "./policy-controls";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "家人 · Family Time Capsule" };

export default async function FamilyPage() {
  const { familyId, role } = await requireFamily();
  const canManageFamily = hasFamilyCapability(role, "family:manage");
  const [family, people, recentContributions] = await Promise.all([
    getFamily(familyId),
    listPeople(familyId),
    listRecentFamilyContributions(familyId, 5),
  ]);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-12 sm:px-6 sm:py-16">
      <h1 className="text-2xl font-semibold">家人</h1>
      <p className="mt-2 text-sm leading-6 text-foreground/60">
        {family?.name} · {family?.timezone}。家人是现实中的人，不要求有登录账号；
        祖辈、孩子都可以先出现在记忆里，以后再开账号。
      </p>

      <nav aria-label="家人相关入口" className="mt-6 grid gap-3 sm:grid-cols-3">
        <Link href="/requests" className="rounded-xl border border-foreground/10 bg-foreground/[0.02] p-4 transition-colors hover:border-accent/50">
          <span className="font-medium">问题与原声</span>
          <span className="mt-1 block text-sm text-foreground/60">向家人发起口述史问题，收集他们的讲述与声音</span>
        </Link>
        <Link href="/contributions" className="rounded-xl border border-foreground/10 bg-foreground/[0.02] p-4 transition-colors hover:border-accent/50">
          <span className="font-medium">家庭投递箱</span>
          <span className="mt-1 block text-sm text-foreground/60">请没有账号的家人提交旧照片、录音与文字</span>
        </Link>
        {canManageFamily ? (
          <Link href="/settings/invitations" className="rounded-xl border border-foreground/10 bg-foreground/[0.02] p-4 transition-colors hover:border-accent/50">
            <span className="font-medium">邀请家人加入</span>
            <span className="mt-1 block text-sm text-foreground/60">生成可撤销的邀请链接或二维码</span>
          </Link>
        ) : null}
      </nav>

      {recentContributions.length > 0 ? (
        <section aria-label="最近补充" className="mt-10">
          <h2 className="text-lg font-medium">最近补充</h2>
          <p className="mt-1 text-sm leading-6 text-foreground/60">
            家人最近留下的讲述；私密讲述只对本人与授权范围可见，不在这里出现。
          </p>
          <ul className="mt-3 flex flex-col gap-2">
            {recentContributions.map((item) => (
              <li key={item.id}>
                <Link
                  href={`/memories/${item.memoryEventId}`}
                  className="block rounded-xl border border-foreground/10 bg-foreground/[0.02] p-4 transition-colors hover:border-accent/50"
                >
                  <span className="text-sm text-foreground/60">
                    {item.authorName}
                    {item.authorRelation ? ` · ${item.authorRelation}` : ""}
                    {item.hasAudio ? " · 含原声" : ""} 补充于「{item.eventTitle}」
                  </span>
                  {item.preview ? (
                    <span className="mt-1 block truncate text-sm">{item.preview}</span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-label="成员列表" className="mt-10 flex flex-col gap-3">
        <h2 className="text-lg font-medium">人物</h2>
        {people.map((p) => (
          <div
            key={p.id}
            className="rounded-xl border border-foreground/10 bg-foreground/[0.02] p-4 sm:flex sm:items-start sm:justify-between sm:gap-5"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <Link
                  href={`/family/${p.id}`}
                  className="font-medium underline-offset-4 hover:underline"
                  aria-label={`查看${p.displayName}的人物主页`}
                >
                  {p.displayName}
                </Link>
                {p.relationToChild && (
                  <span className="text-sm text-foreground/60">
                    {p.relationToChild}
                  </span>
                )}
                {p.isGuardian && (
                  <span className="rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-xs">
                    监护人
                  </span>
                )}
              </div>
              <Link
                href={`/family/${p.id}`}
                className="mt-2 inline-flex min-h-11 items-center text-sm font-medium text-accent underline-offset-4 hover:underline"
              >
                查看共同记忆与讲述
              </Link>
              <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-foreground/50">
                {p.isChild && <span>孩子</span>}
                {p.birthDate && <span>生于 {p.birthDate}</span>}
              </div>
              {canManageFamily && p.isChild && (
                <ChildUnlockControl
                  childPersonId={p.id}
                  alreadyUnlocked={p.childLaterUnlockedAt !== null}
                />
              )}
            </div>
            {canManageFamily && !p.isChild && (
              <div className="mt-4 sm:mt-0">
                <GuardianControl personId={p.id} isGuardian={p.isGuardian} />
              </div>
            )}
          </div>
        ))}
      </section>

      {canManageFamily && (
        <>
          <section
            aria-labelledby="child-later-policy-heading"
            className="mt-10 rounded-2xl border border-foreground/10 bg-foreground/[0.02] p-5 sm:p-6"
          >
            <h2 id="child-later-policy-heading" className="text-lg font-medium">
              “长大后可见”策略
            </h2>
            <p className="mt-1 text-sm leading-6 text-foreground/60">
              监护人可提前查看；孩子本人到龄后自动开放。手工解锁按孩子分别生效且不可撤销。
            </p>
            <UnlockAgeForm currentAge={family?.childLaterUnlockAge ?? 18} />
          </section>

          <section aria-label="添加家人" className="mt-10">
            <h2 className="text-lg font-medium">添加家人</h2>
            <p className="mt-1 text-sm leading-6 text-foreground/60">
              添加没有账号的成员（外公、外婆等），他们可以出现在照片、事件与留言里。
            </p>
            <AddPersonForm />
          </section>
        </>
      )}
    </main>
  );
}
