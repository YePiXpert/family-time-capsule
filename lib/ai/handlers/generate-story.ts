import { AiJobHandlerError, type AiJobHandler } from "@/jobs/types";
import { regenerateOrCreateStory } from "@/lib/stories/service";
import {
  collectStoryMaterial,
  collectTranscriptMaterial,
  periodForKind,
  planDeterministicDraft,
  verifyQuoteLock,
  MAX_PARAGRAPH_CHARS,
  type StoryKind,
  type DraftParagraphPlan,
} from "@/lib/stories/service";
import type { FamilyContext } from "@/lib/family/context";

/**
 * Production handler for `generate.story.v1`（M4 故事生成）。
 *
 * - 输入白名单（服务层强制）：本周期内 user_confirmed Fact、family 可见
 *   Contribution、用户修订 Transcript。ai_suggested 事实与 private/parents/
 *   child_later 讲述永不进入 prompt；
 * - 别名协议：F#/C#/T# 一次性别名，内部行 id 不进 prompt；
 * - Quote Lock（服务层，不靠 prompt）：quote 段落文本必须与来源当前文本
 *   逐字一致；narrative 段落禁止携带引号字符；全部段落校验失败则回退
 *   确定性草稿（绝不产出无来源引文）；
 * - 再生保护：regenerateOrCreateStory 永不覆盖已编辑/已发布故事。
 */

const MAX_PARAGRAPHS = 60;
const MAX_CONTEXT_CHARS = 20_000;

const STORY_KINDS: StoryKind[] = ["weekly", "monthly", "yearly"];

export const generateStoryHandler: AiJobHandler = async ({
  lease,
  assistant,
  signal,
}) => {
  // entityId 约定：`<kind>#<anchor-ISO>`，由请求侧构造
  const [kindRaw, anchorRaw] = lease.entityId.split("@");
  if (!STORY_KINDS.includes(kindRaw as StoryKind) || !anchorRaw) {
    throw new AiJobHandlerError("invalid_story_request", false);
  }
  const kind = kindRaw as StoryKind;
  const anchor = new Date(anchorRaw);
  if (Number.isNaN(anchor.getTime())) {
    throw new AiJobHandlerError("invalid_story_request", false);
  }

  const period = periodForKind(kind, anchor);
  const material = collectStoryMaterial(lease.familyId, period);
  const transcripts = collectTranscriptMaterial(lease.familyId, period);

  // 别名注册表（一次性别名 → 真实行）
  const aliasToFact = new Map<string, typeof material.facts[number]>();
  const aliasToContribution = new Map<string, typeof material.contributions[number]>();
  const aliasToTranscript = new Map<string, typeof transcripts[number]>();
  const sourceBlocks: string[] = [];
  let fSerial = 0;
  for (const f of material.facts) {
    fSerial += 1;
    aliasToFact.set(`F${fSerial}`, f);
    sourceBlocks.push(`[F${fSerial}] 已确认事实（${f.eventId}）：${f.statement}`);
  }
  let cSerial = 0;
  for (const c of material.contributions) {
    cSerial += 1;
    aliasToContribution.set(`C${cSerial}`, c);
    sourceBlocks.push(`[C${cSerial}] 家人讲述原文：${c.text}`);
  }
  let tSerial = 0;
  for (const t of transcripts) {
    tSerial += 1;
    aliasToTranscript.set(`T${tSerial}`, t);
    sourceBlocks.push(`[T${tSerial}] 转录（人工修订）：${t.text}`);
  }

  // 无素材：确定性草稿也无法生成 → 非重试失败
  if (sourceBlocks.length === 0) {
    throw new AiJobHandlerError("no_story_material", false);
  }

  // 上下文截断（从最后一块开始移除，并同步下线别名）
  while (
    sourceBlocks.join("\n").length > MAX_CONTEXT_CHARS &&
    sourceBlocks.length > 1
  ) {
    const removed = sourceBlocks.pop()!;
    const alias = removed.match(/^\[([FCT]\d+)\]/)?.[1];
    if (alias) {
      aliasToFact.delete(alias);
      aliasToContribution.delete(alias);
      aliasToTranscript.delete(alias);
    }
  }

  const prompt = [
    "你正在为一份家庭时间胶囊撰写「" +
      (kind === "weekly" ? "周记" : kind === "monthly" ? "月章" : "年章") +
      "」故事草稿。草稿之后会由家人审阅、编辑、发布。",
    "",
    "来源资料（每块开头的 F#/C#/T# 是来源别名，paragraphs 的 sources 只能引用这些别名）：",
    ...sourceBlocks,
    "",
    "输出要求：",
    "- 严格返回 JSON 对象，不要任何 JSON 之外的说明。",
    '- 格式：{ "title": string, "paragraphs": [{ "kind": "narrative"|"quote", "text": string, "sources": [{ "ref": "F1" }] }] }',
    "- title：简洁的故事标题（≤30 字）。",
    "- narrative 段：基于来源内容的连贯叙述；禁止出现引号字符「」“”；不得包含来源中没有的信息。",
    "- quote 段：必须逐字摘录某条讲述/转录原文（text 与原文完全一致），sources 指向其别名。",
    "- sources[].ref 只能引用出现过的别名，禁止编造别名或写任何其他 ID。",
    "- 每段至少一个来源；最多 " + MAX_PARAGRAPHS + " 段。",
  ].join("\n");

  let plans: DraftParagraphPlan[] = [];
  let title: string | undefined;

  try {
    const result = await assistant.generateText({
      messages: [{ role: "user", content: prompt }],
      responseFormat: "json",
      signal,
    });
    const text = result.text;
    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");
    if (firstBrace === -1 || lastBrace <= firstBrace) {
      throw new Error("no json");
    }
    const parsed = JSON.parse(text.slice(firstBrace, lastBrace + 1)) as {
      title?: unknown;
      paragraphs?: unknown;
    };
    if (typeof parsed.title === "string") title = parsed.title.trim().slice(0, 100);
    if (!Array.isArray(parsed.paragraphs)) throw new Error("bad paragraphs");

    for (const item of parsed.paragraphs) {
      if (item === null || typeof item !== "object") continue;
      const p = item as Record<string, unknown>;
      if (typeof p.text !== "string") continue;
      const text2 = p.text.trim().slice(0, MAX_PARAGRAPH_CHARS);
      if (!text2) continue;
      const kind2 = p.kind === "quote" ? "quote" : "narrative";
      const sources: DraftParagraphPlan["sources"] = [];
      if (Array.isArray(p.sources)) {
        for (const refItem of p.sources) {
          if (refItem === null || typeof refItem !== "object") continue;
          const ref = (refItem as Record<string, unknown>).ref;
          if (typeof ref !== "string") continue;
          if (aliasToFact.has(ref)) {
            sources.push({
              sourceType: "fact",
              sourceId: aliasToFact.get(ref)!.factId,
              quote: null,
            });
          } else if (aliasToContribution.has(ref)) {
            const row = aliasToContribution.get(ref)!;
            sources.push({
              sourceType: "contribution",
              sourceId: row.contributionId,
              quote: kind2 === "quote" ? text2 : null,
            });
          } else if (aliasToTranscript.has(ref)) {
            const row = aliasToTranscript.get(ref)!;
            sources.push({
              sourceType: "transcript",
              sourceId: row.transcriptId,
              quote: kind2 === "quote" ? text2 : null,
            });
          }
          // 未知别名（编造/注入）：静默丢弃
        }
      }
      if (sources.length === 0) continue; // 无有效来源的段落丢弃
      // 引文锁（服务层语义在此复检）：quote 必须逐字命中来源
      const plan: DraftParagraphPlan = { kind: kind2, text: text2, sources };
      if (!verifyQuoteLock(plan, material, transcripts)) continue;
      plans.push(plan);
      if (plans.length >= MAX_PARAGRAPHS) break;
    }
  } catch {
    // provider 输出不可用 → 回退确定性草稿（不失败：故事是可重建产物）
  }

  // AI 输出全部被拒/为空 → 确定性草稿兜底（无 AI 也可用同一能力）
  if (plans.length === 0) {
    plans = planDeterministicDraft(material, transcripts);
    title = undefined;
  }
  if (plans.length === 0) {
    throw new AiJobHandlerError("no_story_material", false);
  }

  // 队列在 claim 时已重验发起者持有 ai:review（仅 admin/editor），
  // 且 story:write 与 ai:review 的角色集合一致，因此这里不会造成越权。
  const context: FamilyContext = {
    userId: lease.requestedByUserId,
    userName: "",
    familyId: lease.familyId,
    personId: null,
    role: "editor",
    accountEnabled: true,
    isGuardian: false,
    familyTimezone: "UTC",
    childLaterUnlockAge: 18,
  };

  const result = regenerateOrCreateStory(
    context,
    { kind, anchor, title, createdByJobId: lease.jobId },
    plans,
  );
  if (!result.ok) {
    throw new AiJobHandlerError(`story_${result.error}`, false);
  }

  return {
    commit: () => {
      // 故事行已在上方 regenerateOrCreateStory 内落库（SQLite 同步事务）。
      // 幂等性：若 worker 在写库后、finalize 前崩溃，job 过期重试会再次生成——
      // regenerate 对未编辑草稿是替换语义，最终收敛为一份草稿，绝不重复叠加。
      void lease;
    },
  };
};
