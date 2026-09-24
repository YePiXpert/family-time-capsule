import type { DailyQuestionCache } from "./model";
import { questionPlan, rememberQuestion, validateResult } from "../ai/state";

export function dailyQuestionSource(cache: DailyQuestionCache | undefined, today: string, changed: boolean) {
  return !changed && questionPlan(cache, today) === "cached" ? "ai" : "local";
}

/** 先把今日尝试落盘，再访问服务；失败、重开编辑页也不会重复花额度。 */
export async function requestDailyQuestion(input: {
  today: string;
  getCache: () => DailyQuestionCache | undefined;
  save: (cache: DailyQuestionCache) => Promise<unknown>;
  getToken: () => Promise<string | null>;
  request: () => Promise<unknown>;
  changed?: boolean;
}) {
  if (input.changed || questionPlan(input.getCache(), input.today) !== "request") return;
  await input.save(rememberQuestion(input.getCache(), input.today, null));
  try {
    if (!(await input.getToken())) return;
    const result = validateResult(await input.request(), "question");
    await input.save(rememberQuestion(input.getCache(), input.today, result.question!));
  } catch {
    // 今日尝试已经保存，失败安静地保留本机问题。
  }
}
