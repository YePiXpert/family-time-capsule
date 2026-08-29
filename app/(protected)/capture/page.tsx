import type { Metadata } from "next";
import { Placeholder } from "@/components/placeholder";

export const metadata: Metadata = { title: "记录 · Family Time Capsule" };

export default function CapturePage() {
  return (
    <Placeholder
      title="记录"
      hint="低阻力输入入口将在后续 Issue 实现（PRD §9.1）。"
    />
  );
}
