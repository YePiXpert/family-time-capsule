import type { Metadata } from "next";
import Link from "next/link";
import { after } from "next/server";
import { requireFamilyCapability } from "@/lib/authz/context";
import {
  listFamilyInvitations,
  listInvitationPersonCandidates,
  reconcileFamilyInvitationProvisioning,
  type InvitationStatus,
} from "@/lib/invitations/service";
import { CreateInvitationForm } from "./create-invitation-form";
import { RevokeInvitationButton } from "./revoke-invitation-button";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "账号邀请 · Family Time Capsule",
};

const ROLE_LABEL = {
  admin: "管理员",
  editor: "编辑者",
  contributor: "贡献者",
  viewer: "查看者",
} as const;

const STATUS_LABEL: Record<InvitationStatus, string> = {
  active: "待接受",
  claimed: "接受处理中",
  expired: "已过期",
  revoked: "已撤销",
  used: "已使用",
};

export default async function InvitationsPage() {
  const context = await requireFamilyCapability("account:invite");
  const [invitations, people] = await Promise.all([
    listFamilyInvitations(context.familyId, context.userId),
    listInvitationPersonCandidates(context.familyId, context.userId),
  ]);
  if (!invitations || !people) {
    throw new Error("invitation administration authorization changed");
  }
  // Reap terminal crash receipts after rendering, not as a render side effect.
  // The durable tombstone remains, so a late old INSERT is fenced and reaped
  // again on the next admin visit.
  after(async () => {
    await reconcileFamilyInvitationProvisioning(
      context.familyId,
      context.userId,
    );
  });

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-12 sm:px-6 sm:py-16">
      <Link
        href="/settings"
        className="inline-flex min-h-11 items-center rounded-lg text-sm text-foreground/70 underline decoration-foreground/30 underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        返回设置
      </Link>
      <h1 className="mt-3 text-2xl font-semibold">账号邀请</h1>
      <p className="mt-2 max-w-2xl text-base leading-7 text-foreground/70">
        Family Time Capsule 不开放注册。只有持有一次性邀请链接的人才能创建账号；链接可撤销、会过期，并在首次成功使用后失效。
      </p>

      <section
        aria-labelledby="create-invitation-heading"
        className="mt-8 rounded-2xl border border-foreground/10 bg-foreground/[0.02] p-5 sm:p-6"
      >
        <h2 id="create-invitation-heading" className="text-lg font-medium">
          创建新邀请
        </h2>
        <CreateInvitationForm people={people} />
      </section>

      <section aria-labelledby="invitation-history-heading" className="mt-10">
        <h2 id="invitation-history-heading" className="text-lg font-medium">
          邀请记录
        </h2>
        {invitations.length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed border-foreground/20 p-5 text-sm leading-6 text-foreground/60">
            还没有邀请。创建后，原始链接只会显示一次。
          </p>
        ) : (
          <ul className="mt-4 flex flex-col gap-3">
            {invitations.map((invitation) => (
              <li
                key={invitation.id}
                className="rounded-xl border border-foreground/10 p-4 sm:flex sm:items-start sm:justify-between sm:gap-5"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">
                      {ROLE_LABEL[invitation.role]}
                    </span>
                    <span className="rounded-full border border-foreground/15 px-2 py-0.5 text-xs text-foreground/70">
                      {STATUS_LABEL[invitation.status]}
                    </span>
                  </div>
                  <dl className="mt-2 grid gap-1 text-sm leading-6 text-foreground/70">
                    <div>
                      <dt className="inline text-foreground/50">邮箱：</dt>
                      <dd className="inline break-all">
                        {invitation.email ?? "不限定"}
                      </dd>
                    </div>
                    <div>
                      <dt className="inline text-foreground/50">家人档案：</dt>
                      <dd className="inline">
                        {invitation.personName ?? "暂不绑定"}
                      </dd>
                    </div>
                    <div>
                      <dt className="inline text-foreground/50">有效至：</dt>
                      <dd className="inline">
                        {new Intl.DateTimeFormat("zh-CN", {
                          dateStyle: "medium",
                          timeStyle: "short",
                        }).format(invitation.expiresAt)}
                      </dd>
                    </div>
                  </dl>
                </div>
                {(invitation.status === "active" ||
                  invitation.status === "claimed") && (
                  <div className="mt-4 sm:mt-0">
                    <RevokeInvitationButton invitationId={invitation.id} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
