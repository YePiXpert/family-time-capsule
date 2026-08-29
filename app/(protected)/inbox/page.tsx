import type { Metadata } from "next";
import { Placeholder } from "@/components/placeholder";

export const metadata: Metadata = { title: "收件箱 · Family Time Capsule" };

export default function InboxPage() {
  return (
    <Placeholder
      title="收件箱"
      hint="待整理素材的确认工作流将在后续 Issue 实现（PRD §9.2）。"
    />
  );
}
