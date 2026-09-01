import type { Metadata } from "next";
import { resolveGuestRequest } from "@/lib/oral-history/service";
import { GuestMediaForm, GuestTextForm } from "./guest-forms";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "家人的提问 · Family Time Capsule",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

/**
 * 匿名讲述页（M5）：访客凭 token 回答家人的提问。
 * 页面只显示称呼与问题——不暴露家庭名、人物、时间轴或任何媒体；
 * 提交进入收件箱审核，绝不直接发布。
 */
export default async function RespondPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const resolved = resolveGuestRequest(token);

  return (
    <main className="mx-auto flex min-h-[calc(100vh-env(safe-area-inset-bottom))] w-full max-w-xl flex-1 items-center px-5 py-10 sm:px-6">
      <section className="w-full rounded-2xl border border-foreground/10 bg-foreground/[0.02] p-5 shadow-sm sm:p-8">
        <p className="text-sm font-medium text-accent">私人家庭档案</p>
        {resolved.ok ? (
          <>
            <h1 className="mt-2 text-2xl font-semibold">
              给{resolved.request.recipientLabel}的一封信
            </h1>
            <p className="mt-4 rounded-xl border border-foreground/10 bg-background p-4 text-base leading-7">
              {resolved.request.promptText}
            </p>
            <div className="mt-6 flex flex-col gap-6">
              <GuestTextForm token={token} />
              <div className="border-t border-foreground/10 pt-6">
                <p className="mb-2 text-xs text-foreground/50">
                  也可以用录音、照片或视频来回答（可选）。
                </p>
                <GuestMediaForm token={token} />
              </div>
            </div>
            <p className="mt-6 text-xs leading-5 text-foreground/40">
              你的回答会先交给家人整理，确认后才会收进家庭时间轴。
              链接有效期至{" "}
              {new Intl.DateTimeFormat("zh-CN", { dateStyle: "long" }).format(
                resolved.request.expiresAt,
              )}
              。
            </p>
          </>
        ) : (
          <>
            <h1 className="mt-2 text-2xl font-semibold">链接不可用</h1>
            <p className="mt-3 text-base leading-7 text-foreground/70">
              {resolved.error === "expired"
                ? "这个链接已过期。请让家人重新发一个。"
                : resolved.error === "closed"
                  ? "这个链接已被关闭。"
                  : "这个链接无效。请向家人确认链接是否完整。"}
            </p>
          </>
        )}
      </section>
    </main>
  );
}
