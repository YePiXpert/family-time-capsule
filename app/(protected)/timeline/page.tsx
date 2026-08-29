import type { Metadata } from "next";
import { Placeholder } from "@/components/placeholder";

export const metadata: Metadata = { title: "时光轴 · Family Time Capsule" };

export default function TimelinePage() {
  return (
    <Placeholder
      title="时光轴"
      hint="按真实发生时间排列的记忆事件将在后续 Issue 实现（PRD §9.3）。"
    />
  );
}
