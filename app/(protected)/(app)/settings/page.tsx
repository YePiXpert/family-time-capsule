import type { Metadata } from "next";
import { Placeholder } from "@/components/placeholder";

export const metadata: Metadata = { title: "设置 · Family Time Capsule" };

export default function SettingsPage() {
  return (
    <Placeholder
      title="设置"
      hint="家庭设置、备份与导出将放在二级菜单（PRD §8）。"
    />
  );
}
