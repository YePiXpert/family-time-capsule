import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireFamily } from "@/lib/family/context";
import { listPeople } from "@/lib/family/service";
import { getCapsuleDetail } from "@/lib/capsules/service";
import { listMemoryEvents } from "@/lib/memories/service";
import { CapsuleActions } from "./capsule-actions";
import { AddQuestionForm, ReplyForm, RemoveQuestionButton } from "./dialogue-ui";
import { getCapsuleDialogue } from "@/lib/capsules/dialogue";
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
  const dialogue = await getCapsuleDialogue(familyId, capsule.id);
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

      <section aria-label="胶囊对话" className="mt-10 flex flex-col gap-4">
        <h2 className="text-lg font-medium">跨时空对话</h2>
        {capsule.status === "draft" ? (
          <>
            <p className="text-sm leading-6 text-foreground/50">
              在封存前写下想问未来的他/她的问题；胶囊开启后，家人可以用文字、录音、
              照片或视频回答。封存后问题不再改变，已封存的内容也不会因回答被修改。
            </p>
            {dialogue.map((q) => (
              <div
                key={q.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-foreground/10 px-4 py-2.5 text-sm"
              >
                <span>{q.questionText}</span>
                {canWrite && (
                  <RemoveQuestionButton capsuleId={capsule.id} questionId={q.id} />
                )}
              </div>
            ))}
            {canWrite && <AddQuestionForm capsuleId={capsule.id} />}
          </>
        ) : (
          <>
            {locked && (
              <p className="text-sm leading-6 text-foreground/50">
                封存了 {dialogue.length} 个问题；开启后可以回答。
              </p>
            )}
            {dialogue.map((q) => (
              <article
                key={q.id}
                className="rounded-xl border border-foreground/10 bg-foreground/[0.02] p-4"
              >
                <p className="text-base font-medium leading-7">{q.questionText}</p>
                <ul className="mt-3 flex flex-col gap-2">
                  {q.replies.map((r) => (
                    <li
                      key={r.id}
                      className="rounded-lg border border-foreground/10 bg-background px-3 py-2 text-sm"
                    >
                      <span className="text-xs text-foreground/50">
                        {r.authorName ?? "家人"} ·{" "}
                        {new Intl.DateTimeFormat("zh-CN", {
                          dateStyle: "medium",
                          timeZone: timezone,
                        }).format(r.createdAt)}
                      </span>
                      {r.text && (
                        <p className="mt-1 whitespace-pre-wrap leading-7">{r.text}</p>
                      )}
                      {r.assetId && (
                        <p className="mt-1 text-xs text-foreground/50">
                          （附带一份媒体，见 /api/media/{r.assetId}）
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
                {unlocked && canWrite && (
                  <div className="mt-3">
                    <ReplyForm capsuleId={capsule.id} questionId={q.id} />
                  </div>
                )}
              </article>
            ))}
            {dialogue.length === 0 && (
              <p className="text-sm text-foreground/50">
                这个胶囊没有留下未来问题。
              </p>
            )}
          </>
        )}
      </section>

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
