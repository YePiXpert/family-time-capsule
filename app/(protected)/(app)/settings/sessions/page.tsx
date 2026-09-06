import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireFamilyCapability } from "@/lib/authz/context";
import { requireCurrentSessionId } from "@/lib/family/context";
import { listOwnSessions } from "@/lib/accounts/service";
import { RevokeSessionsButton } from "./revoke-button";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "活动设备 · Family Time Capsule",
};

function deviceLabel(userAgent: string | null): string {
  if (!userAgent) return "未知设备";
  if (/FamilyTimeCapsule|Expo|okhttp/i.test(userAgent)) return "手机 App";
  if (/iPhone|iPad|Android/i.test(userAgent)) return "移动浏览器";
  if (/Macintosh/i.test(userAgent)) return "Mac 浏览器";
  if (/Windows/i.test(userAgent)) return "Windows 浏览器";
  if (/Linux/i.test(userAgent)) return "Linux 浏览器";
  return "浏览器";
}

export default async function SessionsPage() {
  const context = await requireFamilyCapability("archive:view");
  const currentSessionId = await requireCurrentSessionId();
  const sessions = listOwnSessions(context, currentSessionId);
  if (!Array.isArray(sessions)) {
    redirect("/settings?authorizationChanged=1");
  }
  const list = sessions;
  const others = list.filter((entry) => !entry.isCurrent);
  const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-12 sm:px-6 sm:py-16">
      <Link
        href="/settings"
        className="inline-flex min-h-11 items-center rounded-lg text-sm text-foreground/70 underline decoration-foreground/30 underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        返回设置
      </Link>
      <h1 className="mt-3 text-2xl font-semibold">活动设备</h1>
      <p className="mt-2 max-w-2xl text-base leading-7 text-foreground/70">
        这里是当前账号的全部登录会话，包括手机 App 与浏览器。撤销其他设备会让对方下次请求即失效，
        不会删除任何人的本机记录、原件或待上传内容。
      </p>

      <ul className="mt-8 flex flex-col gap-3">
        {list.map((entry) => (
          <li
            key={entry.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-foreground/10 bg-foreground/[0.02] p-4"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{deviceLabel(entry.userAgent)}</span>
                {entry.isCurrent ? (
                  <span className="rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-xs">
                    当前设备
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-sm text-foreground/60">
                登录于 {dateFormatter.format(entry.createdAt)} · 过期于{" "}
                {dateFormatter.format(entry.expiresAt)}
                {entry.ipAddress ? ` · IP ${entry.ipAddress}` : ""}
              </p>
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-8">
        <RevokeSessionsButton otherCount={others.length} />
      </div>
      <p className="mt-4 text-xs leading-5 text-foreground/55">
        改密码后建议同时撤销其他设备；手机端被撤销后需要重新登录，本机照片与录音不会被动到。
      </p>
    </main>
  );
}
