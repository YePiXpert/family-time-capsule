import type { Metadata } from "next";
import Link from "next/link";
import { requireFamily } from "@/lib/family/context";
import { listInbox } from "@/lib/inbox/service";
import { getThumbnailMap } from "@/lib/assets/service";
import { InboxBoard } from "./inbox-board";
import { hasFamilyCapability } from "@/lib/authz/policy";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "收件箱 · Family Time Capsule" };

export default async function InboxPage() {
  const { familyId, role } = await requireFamily();
  const canReview = hasFamilyCapability(role, "inbox:review");
  const entries = await listInbox(familyId);
  // 收件箱封面优先用缩略图（避免列表加载全尺寸原件）
  const thumbMap = await getThumbnailMap(
    familyId,
    entries.map((e) => e.assets[0]?.id).filter((id): id is string => Boolean(id)),
  );
  const withThumbs = entries.map((e) => ({
    ...e,
    coverThumbAssetId: e.assets[0] ? (thumbMap.get(e.assets[0].id)?.id ?? null) : null,
  }));

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-16">
      <h1 className="text-2xl font-semibold">收件箱</h1>
      <p className="mt-2 text-sm leading-6 text-foreground/60">
        {canReview
          ? "新内容先在这里整理：确认真实时间后进入时间轴。勾选多项可以合并成一件事。"
          : "这里列出尚待整理的内容；当前角色可以查看，但整理与确认由管理员或编辑完成。"}
      </p>

      {entries.length === 0 ? (
        <div className="mt-10 rounded-xl border border-dashed border-foreground/20 p-8 text-center text-sm text-foreground/50">
          没有待整理的内容。去
          <Link href="/capture" className="mx-1 underline underline-offset-2">
            记录
          </Link>
          页上传照片、录音或写下一段话。
        </div>
      ) : (
        <InboxBoard entries={withThumbs} canReview={canReview} />
      )}
    </main>
  );
}
