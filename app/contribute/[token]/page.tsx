import type { Metadata } from "next";
import { headers } from "next/headers";
import { resolveContributionPortal } from "@/lib/contribution-portals/service";
import { anonymousRequestSubject } from "@/lib/security/anonymous-subject";
import { GuestContributionForm } from "./guest-contribution-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "家庭投递箱 · Family Time Capsule",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export default async function ContributionPage({ params }: PageProps<"/contribute/[token]">) {
  const { token } = await params;
  const requestHeaders = await headers();
  const resolved = resolveContributionPortal(token, anonymousRequestSubject(requestHeaders));
  return (
    <main className="mx-auto min-h-[calc(100vh-env(safe-area-inset-bottom))] w-full max-w-2xl px-5 py-10 sm:px-6">
      <section className="rounded-2xl border border-line bg-surface p-5 shadow-sm sm:p-8">
        <p className="text-sm font-medium text-accent">私人家庭投递箱</p>
        {resolved.ok ? (
          <>
            <h1 className="mt-2 text-2xl font-semibold">{resolved.publicPortal.title}</h1>
            <p className="mt-2 text-sm text-muted">来自 {resolved.publicPortal.familyName}</p>
            <p className="mt-5 whitespace-pre-wrap rounded-xl border border-line bg-background p-4 leading-7">{resolved.publicPortal.description}</p>
            <GuestContributionForm
              token={token}
              maxFiles={resolved.publicPortal.maxFilesPerSubmission}
              allowImages={resolved.publicPortal.allowImages}
              allowAudio={resolved.publicPortal.allowAudio}
              allowVideo={resolved.publicPortal.allowVideo}
              allowDocuments={resolved.publicPortal.allowDocuments}
              allowText={resolved.publicPortal.allowText}
              allowRecording={resolved.publicPortal.allowBrowserRecording}
              allowGuestName={resolved.publicPortal.allowGuestName}
            />
            <p className="mt-6 text-xs leading-5 text-muted">提交内容只会进入家庭收件箱，家人审核确认前不会出现在时间轴。此页不能浏览或搜索任何家庭内容。链接有效期至 {new Intl.DateTimeFormat("zh-CN", { dateStyle: "long" }).format(resolved.publicPortal.expiresAt)}。</p>
          </>
        ) : (
          <>
            <h1 className="mt-2 text-2xl font-semibold">投递箱暂不可用</h1>
            <p className="mt-3 text-muted">{resolved.error === "paused" ? "家人暂时暂停了这个投递箱。" : resolved.error === "expired" ? "这个链接已过期。" : resolved.error === "rate_limited" ? "尝试次数过多，请稍后再试。" : "链接无效或已撤销，请向家人确认。"}</p>
          </>
        )}
      </section>
    </main>
  );
}
