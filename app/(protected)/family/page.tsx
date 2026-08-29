import type { Metadata } from "next";
import { Placeholder } from "@/components/placeholder";

export const metadata: Metadata = { title: "家人 · Family Time Capsule" };

export default function FamilyPage() {
  return (
    <Placeholder
      title="家人"
      hint="家庭成员与声音档案将在 #003 起实现（PRD §9.5）。"
    />
  );
}
