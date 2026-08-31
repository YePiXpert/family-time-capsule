import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireFamily } from "@/lib/family/context";
import { listPeople } from "@/lib/family/service";
import { getCapsuleDetail } from "@/lib/capsules/service";
import { listMemoryEvents } from "@/lib/memories/service";
import { CapsuleActions } from "./capsule-actions";
import { hasFamilyCapability } from "@/lib/authz/policy";
import {
  createContributionAccessSnapshot,
  listVisibleContributionsForFamily,
} from "@/lib/authz/contribution-access";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "胶囊 · Family Time Capsule" };

const STATUS_LABEL: Record<string, string> = {
  draft: "内容收集中",
  sealed: "已封存",
  opened: "已开启",
};

export default async function CapsuleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const context = await requireFamily();
  const { familyId } = context;
  const canWrite = hasFamilyCapability(context.role, "capsule:write");
  const contributionAccess = createContributionAccessSnapshot(context);
  const { id } = await params;
  const people = await listPeople(familyId);
  const childBirthDate = people.find((p) => p.isChild)?.birthDate ?? null;
  const timezone = context.familyTimezone;
  const detail = await getCapsuleDetail(
    contributionAccess,
    id,
    childBirthDate,
  );
  if (!detail) notFound();

  const { capsule, events, contributions, unlocked } = detail;
  const locked = capsule.status === "sealed" && !unlocked;
  const eventOptions =
    canWrite && capsule.status === "draft"
      ? (await listMemoryEvents(familyId)).map((e) => ({ id: e.id, title: e.title }))
      : [];
  const contributionOptions =
    canWrite && capsule.status === "draft"
      ? (await listVisibleContributionsForFamily(contributionAccess))
          .filter(
            (contribution) =>
              !contributions.some((linked) => linked.id === contribution.id),
          )
          .map((contribution) => {
            const text =
              contribution.editedText ??
              contribution.rawText ??
              contribution.transcript ??
              "音频讲述";
            const excerpt = text.replace(/\s+/g, " ").trim();
            return {
              id: contribution.id,
              label: `${contribution.authorName} · ${
                excerpt.length > 48 ? `${excerpt.slice(0, 48)}…` : excerpt
              }`,
            };
          })
      : [];

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-16">
      <Link href="/capsules" className="text-sm text-foreground/60 hover:text-foreground">
        ← 胶囊
      </Link>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight">{capsule.title}</h1>
      <p className="mt-2 text-sm text-foreground/70">
        {capsule.unlockType === "date"
          ? `${capsule.unlockValue} 开启`
          : `孩子 ${capsule.unlockValue} 岁开启`}{" "}
        · {STATUS_LABEL[capsule.status] ?? capsule.status}
        {capsule.sealedAt &&
          ` · 封存于 ${new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeZone: timezone }).format(capsule.sealedAt)}`}
        {capsule.openedAt &&
          ` · 开启于 ${new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeZone: timezone }).format(capsule.openedAt)}`}
      </p>

      {canWrite && (
        <CapsuleActions
          capsuleId={capsule.id}
          status={capsule.status}
          unlocked={unlocked}
          eventOptions={eventOptions}
          contributionOptions={contributionOptions}
        />
      )}

      {locked ? (
        <section
          aria-label="封存内容"
          className="mt-10 rounded-xl border border-dashed border-foreground/20 p-10 text-center"
        >
          <p className="text-sm leading-7 text-foreground/55">
            内容已封存。
            <br />
            到达开启条件的那一刻，这里会重新亮起来。
          </p>
        </section>
      ) : (
        <section aria-label="胶囊内容" className="mt-10 flex flex-col gap-6">
          {events.length === 0 && contributions.length === 0 && (
            <p className="text-sm text-foreground/50">
              {capsule.status === "draft" ? "还没有放入内容。" : "（空）"}
            </p>
          )}
          {events.length > 0 && (
            <div>
              <h2 className="text-sm font-medium text-foreground/60">记忆事件</h2>
              <ul className="mt-2 flex flex-col gap-2">
                {events.map((e) => (
                  <li key={e.id}>
                    <Link
                      href={`/memories/${e.id}`}
                      className="block rounded-lg border border-foreground/10 px-4 py-3 text-sm hover:border-accent/50"
                    >
                      {e.title}
                      <span className="ml-3 text-foreground/50">
                        {new Intl.DateTimeFormat("zh-CN", {
                          dateStyle: "medium",
                          timeZone: timezone,
                        }).format(e.occurredAt)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {contributions.length > 0 && (
            <div>
              <h2 className="text-sm font-medium text-foreground/60">给未来的话</h2>
              <ul className="mt-2 flex flex-col gap-2">
                {contributions.map((c) => (
                  <li
                    key={c.id}
                    className="rounded-lg border border-foreground/10 px-4 py-3 text-sm"
                  >
                    <span className="font-medium">{c.authorName}</span>
                    <p className="mt-1 whitespace-pre-wrap leading-7">
                      {c.editedText ?? c.rawText}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
