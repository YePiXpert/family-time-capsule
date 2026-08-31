import type { Metadata } from "next";
import { requireFamily } from "@/lib/family/context";
import { getFamily, listPeople } from "@/lib/family/service";
import { AddPersonForm } from "./add-person-form";
import { hasFamilyCapability } from "@/lib/authz/policy";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "家人 · Family Time Capsule" };

export default async function FamilyPage() {
  const { familyId, role } = await requireFamily();
  const [family, people] = await Promise.all([
    getFamily(familyId),
    listPeople(familyId),
  ]);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-16">
      <h1 className="text-2xl font-semibold">家人</h1>
      <p className="mt-2 text-sm leading-6 text-foreground/60">
        {family?.name} · {family?.timezone}。家人是现实中的人，不要求有登录账号；
        祖辈、孩子都可以先出现在记忆里，以后再开账号。
      </p>

      <section aria-label="成员列表" className="mt-8 flex flex-col gap-2">
        {people.map((p) => (
          <div
            key={p.id}
            className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-lg border border-foreground/10 bg-foreground/[0.02] px-4 py-3"
          >
            <div className="flex flex-wrap items-baseline gap-x-3">
              <span className="font-medium">{p.displayName}</span>
              {p.relationToChild && (
                <span className="text-sm text-foreground/60">
                  {p.relationToChild}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 text-sm text-foreground/50">
              {p.isChild && <span>孩子</span>}
              {p.birthDate && <span>生于 {p.birthDate}</span>}
            </div>
          </div>
        ))}
      </section>

      {hasFamilyCapability(role, "family:manage") && (
        <section aria-label="添加家人" className="mt-10">
          <h2 className="text-lg font-medium">添加家人</h2>
          <p className="mt-1 text-sm leading-6 text-foreground/60">
            添加没有账号的成员（外公、外婆等），他们可以出现在照片、事件与留言里。
          </p>
          <AddPersonForm />
        </section>
      )}
    </main>
  );
}
