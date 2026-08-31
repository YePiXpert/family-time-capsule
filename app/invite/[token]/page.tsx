import type { Metadata } from "next";
import Link from "next/link";
import { inspectInvitationToken } from "@/lib/invitations/service";
import { AcceptInvitationForm } from "./accept-invitation-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "接受家庭邀请 · Family Time Capsule",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

const ROLE_LABEL = {
  admin: "管理员",
  editor: "编辑者",
  contributor: "贡献者",
  viewer: "查看者",
} as const;

const UNAVAILABLE_MESSAGE = {
  invalid: "这个邀请链接无效。请向家庭管理员确认链接是否完整。",
  claimed: "这个邀请正在被处理。请稍等片刻后重新打开链接。",
  expired: "这个邀请已经过期。请联系家庭管理员创建新邀请。",
  revoked: "这个邀请已经撤销。请联系家庭管理员。",
  used: "这个邀请已经使用，不能再次创建账号。",
} as const;

export default async function InvitePage({
  params,
}: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const invitation = await inspectInvitationToken(token);

  return (
    <main className="mx-auto flex min-h-[calc(100vh-env(safe-area-inset-bottom))] w-full max-w-xl flex-1 items-center px-5 py-10 sm:px-6">
      <section className="w-full rounded-2xl border border-foreground/10 bg-foreground/[0.02] p-5 shadow-sm sm:p-8">
        <p className="text-sm font-medium text-accent">私人家庭档案</p>
        <h1 className="mt-2 text-2xl font-semibold">接受账号邀请</h1>
        {invitation.status === "invalid" ? (
          <UnavailableState message={UNAVAILABLE_MESSAGE.invalid} />
        ) : (
          <>
            <p className="mt-3 text-base leading-7 text-foreground/70">
              你受邀加入「{invitation.familyName}」，账号角色为
              <strong className="mx-1 font-semibold text-foreground">
                {ROLE_LABEL[invitation.role]}
              </strong>
              。现实中的家人档案与登录账号彼此独立。
            </p>
            <dl className="mt-4 grid gap-2 rounded-xl border border-foreground/10 bg-background p-4 text-sm leading-6">
              <div>
                <dt className="inline text-foreground/55">限定邮箱：</dt>
                <dd className="inline break-all">
                  {invitation.email ?? "未限定"}
                </dd>
              </div>
              <div>
                <dt className="inline text-foreground/55">关联家人：</dt>
                <dd className="inline">
                  {invitation.personName ?? "接受后暂不关联 Person"}
                </dd>
              </div>
              <div>
                <dt className="inline text-foreground/55">有效至：</dt>
                <dd className="inline">
                  {new Intl.DateTimeFormat("zh-CN", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(invitation.expiresAt)}
                </dd>
              </div>
            </dl>
            {invitation.status === "active" ? (
              <AcceptInvitationForm
                token={token}
                invitedEmail={invitation.email}
                suggestedName={invitation.personName}
              />
            ) : (
              <UnavailableState message={UNAVAILABLE_MESSAGE[invitation.status]} />
            )}
          </>
        )}
      </section>
    </main>
  );
}

function UnavailableState({ message }: { message: string }) {
  return (
    <div className="mt-6">
      <p role="status" className="text-base leading-7 text-foreground/70">
        {message}
      </p>
      <Link
        href="/login"
        className="mt-5 inline-flex min-h-11 items-center rounded-lg border border-foreground/20 px-4 py-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        已有账号？前往登录
      </Link>
    </div>
  );
}
