export type NameKind = "asset" | "inbox_item" | "memory_event";
export type NameReview = {
  target: { kind: NameKind; id: string; text: string | null; source: string; revision: number };
  suggestions: { id: string; title: string; status: string; revision: number; targetRevision: number | null; valid: boolean; canUndo: boolean }[];
};
export const NAME_SOURCE_LABELS: Record<string, string> = {
  manual: "人工名称", accepted_ai: "已采用 AI 建议", ai_suggested: "AI 建议", rule_generated: "规则名称", legacy_unknown: "保留的旧名称",
};
