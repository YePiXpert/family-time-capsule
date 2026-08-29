import type { Metadata } from "next";
import { Placeholder } from "@/components/placeholder";

export const metadata: Metadata = { title: "胶囊 · Family Time Capsule" };

export default function CapsulesPage() {
  return (
    <Placeholder
      title="胶囊"
      hint="时间胶囊将在 #013 实现（PRD §15）。"
    />
  );
}
