import { AIError } from "./error";
import type { DailyQuestionCache, Library, LocalRecord, Stored, YearPicks, RecordDraft, RecordContent } from "../local/model";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { dateLabel, toDayKey } from "../local/dates";
import { monthKey, recordTitle, yearKey } from "../local/model";
import type { AIJob, AIProposal, AIResult, WritingMode } from "./types";
/** 单次润色的正文上限；超限必须明确提示，不允许静默截断。与服务端一致。 */
export const POLISH_BODY_LIMIT = 2000;
/** 服务端对 context 的整体上限；标题过长时先在本机说明，避免笼统的输入无效。 */
export const POLISH_CONTEXT_LIMIT = 4000;
export function sourceFingerprint(draft: RecordDraft) {
  return bytesToHex(
    sha256(
      new TextEncoder().encode(
        JSON.stringify({
          content: draft.content,
        }),
      ),
    ),
  );
}
/** 只发送当前事情的标题、正文与落款；不发送照片，也不截断超限文字。 */
export function polishRequest(event: {
  by?: string;
  title: string;
  text: string;
}): { context: string; error?: string } {
  const body = event.text.trim();
  if (!body)
    return {
      context: "",
      error: "还没有可润色的正文。先写下几句话，再来润色。",
    };
  if (event.text.length > POLISH_BODY_LIMIT)
    return {
      context: "",
      error: `正文已有 ${event.text.length} 字，一次最多润色 ${POLISH_BODY_LIMIT} 字。请先精简或分成几段，不会自动截断。`,
    };
  const context = `${event.by?.trim() ? `落款：${event.by.trim()}\n` : ""}${event.title.trim() ? `标题：${event.title.trim()}\n` : ""}正文：\n${event.text}`;
  if (context.length > POLISH_CONTEXT_LIMIT)
    return {
      context: "",
      error: `标题和正文合计超过 ${POLISH_CONTEXT_LIMIT} 字，请精简标题后再试。`,
    };
  return { context };
}
const modeOf = (value: { writingMode: WritingMode }): WritingMode =>
  value.writingMode;
/** 不同写作模式即使输入指纹相同也不能复用彼此的请求与结果。 */
export function sameJob(
  previous: AIJob | undefined,
  next: Omit<AIJob, "steps">,
): previous is AIJob {
  return (
    !!previous &&
    previous.fingerprint === next.fingerprint &&
    previous.kind === next.kind &&
    previous.eventIndex === next.eventIndex &&
    previous.model === next.model &&
    modeOf(previous) === modeOf(next)
  );
}
/** 采用建议只写回当前草稿的标题与正文。 */
export function proposalPatch(
  draft: RecordDraft,
  proposal: AIProposal,
  part?: "title" | "text",
): Pick<RecordDraft, "content"> {
  const accepted = part === "title" ? { ...proposal, text: undefined }
    : part === "text" ? { ...proposal, title: undefined } : proposal;
  return { content: proposalEvents(draft, accepted)[0]! };
}
export function validateResult(
  value: unknown,
  mode: WritingMode,
): AIResult {
  if (mode === "ask" || mode === "question") {
    const invalid = () => new AIError("INVALID_RESULT", "AI 问得不合规矩，请重试。");
    if (!value || typeof value !== "object") throw invalid();
    const result = value as AIResult;
    const validQuestion = (q: unknown): q is string =>
      typeof q === "string" && !!q.trim() && q.length <= 30;
    if (mode === "question") {
      if (!validQuestion(result.question)) throw invalid();
      return { question: result.question };
    }
    if (
      !Array.isArray(result.questions) ||
      result.questions.length < 1 ||
      result.questions.length > 3 ||
      !result.questions.every(validQuestion) ||
      typeof result.first !== "boolean"
    ) throw invalid();
    return {
      questions: result.questions,
      first: result.first,
    };
  }
  if (!value || typeof value !== "object") throw new Error("AI 建议无效。");
  const result = value as AIResult;
  if (
    typeof result.title !== "string" || result.title.length > 100 ||
    typeof result.text !== "string" || result.text.length > 2000
  ) throw new Error("AI 文案不完整。");
  return { title: result.title, text: result.text };
}
export function proposalEvents(draft: RecordDraft, proposal: AIProposal): RecordContent[] {
  if (sourceFingerprint(draft) !== proposal.fingerprint)
    throw new Error("你已修改记录内容，请重新生成建议，当前编辑已保留。");
  return [{ ...draft.content, title: proposal.title ?? draft.content.title, text: proposal.text ?? draft.content.text }];
}
export function validateStoredAI(value: unknown): boolean {
  if (value === undefined) return true;
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (
    typeof v.fingerprint !== "string" ||
    !/^[a-f0-9]{64}$/.test(v.fingerprint) ||
    v.kind !== "write" ||
    !Number.isInteger(v.eventIndex) ||
    !["polish", "recap", "ask", "question", "editor"].includes(String(v.writingMode)) ||
    typeof v.model !== "string"
  )
    return false;
  try {
    if ("steps" in v) {
      if (!Array.isArray(v.steps) || v.steps.length > 120) return false;
      for (const step of v.steps) {
        if (typeof step.key !== "string" || typeof step.requestId !== "string")
          return false;
        if (step.result)
          validateResult(step.result, v.writingMode as WritingMode);
      }
    } else validateResult(v, v.writingMode as WritingMode);
    return true;
  } catch {
    return false;
  }
}

/** 年度寄语起草的输入：标题、第一次、她说的话与已写寄语，不发送其他记录正文与照片。 */
export function recapContext(
  records: { title: string; date: string; first: boolean }[],
  existingNote = "",
  quotes: string[] = [],
): string {
  const titleOf = (r: { title: string; date: string }) =>
    r.title.trim() || `（无标题）· ${dateLabel(r.date)}`;
  const firsts = records.filter((r) => r.first).map(titleOf);
  const parts = [
    `这一年共有 ${records.length} 条记录。`,
    firsts.length ? `第一次：${firsts.join("、")}` : "",
    quotes.length ? `她说的话：${quotes.slice(0, 20).map((q) => q.slice(0, 60)).join("、")}` : "",
    `记录标题：\n${records.map(titleOf).slice(0, 80).join("\n")}`,
    existingNote.trim()
      ? `已写的寄语（仅参考语气与已覆盖内容，不要重复）：\n${existingNote.trim().slice(0, 500)}`
      : "",
  ].filter(Boolean);
  return parts.join("\n").slice(0, 3800);
}

/** 失败后的重试选项；RESULT_EXPIRED 表示原请求已终结，只能重新生成并计入新额度。 */
export function retryPlan(errorCode: string | null): {
  retryOriginal: boolean;
  notice: string;
} {
  return errorCode === "RESULT_EXPIRED"
    ? {
        retryOriginal: false,
        notice: "这次请求已结束，结果无法恢复；点「重新生成」才会计入今日额度。",
      }
    : { retryOriginal: true, notice: "" };
}

/** 显式投影标题与日期：即使调用者传来完整记录，也不序列化其他字段。 */
const recentTitles = (recent: { title: string; date: string }[]) =>
  recent.slice(0, 10).map(({ title, date }) => `${date.slice(0, 10)} ${title.slice(0, 40)}`).join("\n");
const signature = (by?: string, limit = 20) =>
  by?.trim() ? `落款：${by.trim().slice(0, limit)}\n` : "";
const ageContext = (ageLabel: string | null) => `她的月龄：${ageLabel?.slice(0, 40) || "（未填写或尚未出生）"}`;

export function askContext(input: {
  by?: string;
  ageLabel: string | null;
  date: string;
  title: string;
  text: string;
  first: boolean;
  recent: { title: string; date: string }[];
}): string {
  const header = `${signature(input.by)}${ageContext(input.ageLabel)}\n记录日期：${input.date.slice(0, 10)}\n已标第一次：${input.first ? "是" : "否"}\n标题：${input.title.slice(0, 100)}\n正文：\n`;
  const tail = `\n最近的记录（只有标题与日期）：\n${recentTitles(input.recent)}`;
  const clipped = input.text.length > 3000 ? "\n（正文较长，只送前 3000 字）" : "";
  return `${header}${input.text.slice(0, Math.min(3000, 3800 - header.length - tail.length - clipped.length))}${clipped}${tail}`;
}
export function questionContext(input: {
  ageLabel: string | null;
  today: string;
  recent: { title: string; date: string }[];
  asked: string[];
}): string {
  return `${ageContext(input.ageLabel)}\n今天日期：${input.today.slice(0, 10)}\n最近的记录（只有标题与日期）：\n${recentTitles(input.recent)}\n最近 7 天问过的问题：\n${input.asked.slice(-7).map((q) => q.slice(0, 60)).join("\n")}`.slice(0, 2000);
}
export function questionPlan(
  cache: DailyQuestionCache | undefined,
  today: string,
): "cached" | "request" | "fallback" {
  if (cache?.day === today && cache.question) return "cached";
  return cache?.requestedDay === today ? "fallback" : "request";
}
export function recentQuestions(cache: DailyQuestionCache | undefined, today: string) {
  const end = Date.parse(today);
  return (cache?.asked ?? []).filter(({ day }) => {
    const age = end - Date.parse(day);
    return age >= 0 && age < 7 * 86400000;
  }).sort((a, b) => a.day.localeCompare(b.day)).slice(-7);
}
export function rememberQuestion(
  cache: DailyQuestionCache | undefined,
  today: string,
  question: string | null,
): DailyQuestionCache {
  const asked = recentQuestions(cache, today).filter((entry) => !question || entry.day !== today);
  if (question) asked.push({ day: today, question });
  return { ...cache, requestedDay: today, ...(question ? { day: today, question } : {}), asked: asked.slice(-7) };
}

/** 只投影本次确认的年份与文字；最多取最新 400 条，仍按日期升序发出。 */
export function editorContext(year: string, records: readonly Stored<LocalRecord>[], media: Library["media"]): string {
  const selected = records.filter((r) => yearKey(r.date) === year)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)).slice(-400);
  if (!/^\d{4}$/.test(year) || !selected.length ||
    new Set(selected.map((r) => r.id)).size !== selected.length ||
    selected.some((r) => !r.id || r.id.length > 100))
    throw new AIError("INVALID_INPUT", "这一年的记录清单格式不对，请检查后重试。");
  // slice 的限额含省略号，JSON 转义的体积也算在整体限额里。
  const clip = (text: string, max: number) => text.length > max ? `${text.slice(0, max - 1)}…` : text;
  for (const limit of [4000, 1500, 600, 200]) {
    const context = JSON.stringify({ year, records: selected.map((r) => ({
      id: r.id, date: toDayKey(new Date(r.date)), ...(r.by ? { by: r.by.slice(0, 20) } : {}),
      title: recordTitle(r).slice(0, 100), text: clip(r.text, limit),
      first: r.first, quote: r.quote === true,
      photos: r.mediaIds.some((id) => media[id]?.kind === "image"),
    })) });
    if (context.length <= 60000) return context;
  }
  throw new AIError("INVALID_INPUT", "这一年的记录太多，AI 暂时帮不了。");
}

// 与 server/src/prompts.ts BANNED_WORDS 对齐；只约束 AI 建议，家人的原句不受此限制。
const editorBannedWords = ["温馨", "时光", "岁月", "静好", "成长的足迹", "珍贵", "满满的爱", "点滴", "绽放", "闪闪发光", "治愈", "见证", "美好", "感恩", "天使", "小公主", "快乐成长", "健康成长", "茁壮"];
const editorInvalid = () => new AIError("INVALID_RESULT", "AI 的目录建议不合规矩，请重试。");
const objectWithKeys = (value: unknown, keys: string[]): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).every((key) => keys.includes(key));
const originalQuote = (record: Stored<LocalRecord>, text: string) =>
  record.text.includes(text) || recordTitle(record).includes(text);

/** Year 的编者路径直接调用：无年度记录上下文的通用 validateResult 不负责目录。 */
export function checkEditorResult(result: unknown, year: string, records: readonly Stored<LocalRecord>[]): YearPicks {
  if (!/^\d{4}$/.test(year) || !objectWithKeys(result, ["requestId", "model", "title", "chapters", "notes"]) ||
    typeof result.title !== "string" || [...result.title].length < 4 || [...result.title].length > 8 || !result.title.trim() ||
    typeof result.notes !== "string" || [...result.notes].length > 200 ||
    editorBannedWords.some((word) => (result.title as string).includes(word) || (result.notes as string).includes(word)) ||
    !Array.isArray(result.chapters) || result.chapters.length < 1 || result.chapters.length > 12) throw editorInvalid();
  const byId = new Map(records.filter((r) => yearKey(r.date) === year).map((r) => [r.id, r]));
  const seen = new Set<string>();
  const months: YearPicks["months"] = {};
  for (const chapter of result.chapters) {
    if (!objectWithKeys(chapter, ["month", "picks", "quote"]) || typeof chapter.month !== "string" ||
      !/^\d{4}-(0[1-9]|1[0-2])$/.test(chapter.month) || !chapter.month.startsWith(`${year}-`) || months[chapter.month] ||
      !Array.isArray(chapter.picks) || chapter.picks.length < 1 || chapter.picks.length > 3) throw editorInvalid();
    const recordIds: string[] = [];
    for (const id of chapter.picks) {
      const record = typeof id === "string" ? byId.get(id) : undefined;
      if (!record || monthKey(record.date) !== chapter.month || seen.has(id)) throw editorInvalid();
      seen.add(id);
      recordIds.push(id);
    }
    let quote: YearPicks["months"][string]["quote"];
    if (chapter.quote !== undefined) {
      const q = chapter.quote;
      if (!objectWithKeys(q, ["recordId", "text"]) || typeof q.recordId !== "string" || typeof q.text !== "string") throw editorInvalid();
      const text = q.text.trim(), record = byId.get(q.recordId);
      if (!record || monthKey(record.date) !== chapter.month || !text || [...text].length > 40 || !originalQuote(record, text)) throw editorInvalid();
      quote = { recordId: q.recordId, text };
    }
    months[chapter.month] = { recordIds, ...(quote ? { quote } : {}) };
  }
  return { title: result.title.trim(), months, notes: result.notes, updatedAt: new Date().toISOString() };
}

/** 装订前再核原文；不写回目录，也不把改后的正文当成原引语。 */
export function applyYearPicks(picks: YearPicks | undefined, records: readonly Stored<LocalRecord>[]): {
  months: YearPicks["months"]; droppedQuotes: number; droppedRecords: number;
} | undefined {
  if (!picks) return undefined;
  const byId = new Map(records.map((r) => [r.id, r]));
  const months: YearPicks["months"] = {};
  let droppedQuotes = 0, droppedRecords = 0;
  for (const [month, entry] of Object.entries(picks.months)) {
    const recordIds = entry.recordIds.filter((id) => {
      const r = byId.get(id);
      return r && monthKey(r.date) === month;
    });
    droppedRecords += entry.recordIds.length - recordIds.length;
    let quote = entry.quote;
    if (quote) {
      const r = byId.get(quote.recordId);
      if (!recordIds.length || !r || monthKey(r.date) !== month || !originalQuote(r, quote.text)) {
        quote = undefined;
        droppedQuotes++;
      }
    }
    if (recordIds.length) months[month] = { recordIds, ...(quote ? { quote } : {}) };
  }
  return { months, droppedQuotes, droppedRecords };
}
