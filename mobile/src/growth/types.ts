import type { GrowthStage } from "../design/growth-stages";
export type GrowthOverview = {
  child: { id: string; name: string; birthDate: string | null } | null;
  stages: GrowthStage[];
  month: number;
  title: string;
  stage: GrowthStage | null;
  memoryCount: number;
  bookId: string | null;
  canCreate: boolean;
  pendingBirthday: boolean;
  audience: "family";
};
export const growthErrorMessage = (code: string) => ({
  child_birthday_required: "请先在孩子档案中确认生日。",
  no_growth_memories: "这个月还没有可收入的记录。先记录一刻，或补充记录日期。",
  growth_book_too_large: "这个月的内容较多，请用自选成长册分册整理。",
  book_too_large: "成长册已达到容量限制，请用自选成长册分册整理。",
  revision_conflict: "家人刚刚修改了成长册，请重新打开。你的已有修改会保留。",
  forbidden: "当前账号没有整理成长册的权限。",
} as Record<string, string>)[code] ?? "暂时无法准备成长册，请重试。";
