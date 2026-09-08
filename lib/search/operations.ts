import "server-only";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { getInstanceId } from "@/lib/instance/service";
import { getAiSearchAuthorization } from "@/lib/ai/jobs";
import { createMemoryAssistant } from "@/lib/ai/server";
import { AiError, AiInputError } from "@/lib/ai/errors";
import type { AiFetch } from "@/lib/ai/openai-compatible";
import type { AiEnvironment } from "@/lib/ai/config";
import type { FamilyContext } from "@/lib/family/context";
import { expandNaturalLanguageQuery, planToSearchParams } from "./natural-language";
import type { SearchParams } from "./service";

const OPERATION_TTL_MS = 24 * 60 * 60 * 1000;
const PROMPT_VERSION = "natural-query-v2";
type Operation = { id: string; instance_id: string; family_id: string; user_id: string; configuration_id: string; input_hash: string; consent_version: number; state: "running" | "completed" | "failed"; result_json: string | null; error_code: string | null; created_at: number; expires_at: number };
export type SearchOperationResult = { state: "completed"; params: SearchParams; note: string } | { state: "running" | "failed"; error: string };
function hash(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function inputHash(input: SearchParams) { return hash([PROMPT_VERSION, input.q, input.personId ?? "", input.dateFrom ?? "", input.dateTo ?? "", input.tag ?? "", input.mediaType ?? ""]); }
function operationKey(context: FamilyContext, id: string) { return hash([context.familyId, context.userId, id]); }
function validId(id: string) { return /^[A-Za-z0-9_-]{16,100}$/.test(id); }
function result(row: Operation): SearchOperationResult {
  if (row.state !== "completed" || !row.result_json) return { state: row.state === "running" ? "running" : "failed", error: row.error_code ?? "operation_pending" };
  return { state: "completed", ...JSON.parse(row.result_json) };
}

/** Read a completed conversion only. GET/render never creates work or invokes AI. */
export async function readNaturalSearchOperation(context: FamilyContext, id: string, input: SearchParams): Promise<SearchOperationResult | null> {
  if (!validId(id)) return null;
  const row = getDb().get<Operation>(sql`select * from ai_search_operation where id=${operationKey(context,id)} and family_id=${context.familyId} and user_id=${context.userId} and expires_at>${Date.now()}`);
  if (!row || row.input_hash !== inputHash(input) || row.instance_id !== await getInstanceId()) return null;
  const authorization = getAiSearchAuthorization(context);
  if (!authorization || authorization.configurationId !== row.configuration_id || authorization.consentVersion !== row.consent_version) return null;
  return result(row);
}

/** One explicit POST intent, persisted before any await that could dispatch a model. */
export async function runNaturalSearchOperation(context: FamilyContext, id: string, input: SearchParams, dependencies: { env?: AiEnvironment; fetch?: AiFetch } = {}): Promise<SearchOperationResult> {
  if (!validId(id) || !input.q.trim() || input.q.length > 300) throw new AiInputError("搜索请求无效。");
  const env = dependencies.env ?? process.env;
  const metadata = createMemoryAssistant(env);
  const authorization = getAiSearchAuthorization(context, { runtime: metadata });
  if (!authorization) throw new AiError("ai_execution_forbidden", "尚未授权这次文字处理，请核对当前账号与 AI 处理同意。");
  const instanceId = await getInstanceId(), key = operationKey(context,id), fingerprint = inputHash(input), now = Date.now();
  const existing = getDb().transaction(tx => {
    const row = tx.get<Operation>(sql`select * from ai_search_operation where id=${key}`);
    if (row) {
      if (row.consent_version !== authorization.consentVersion || row.input_hash !== fingerprint || row.configuration_id !== authorization.configurationId || row.instance_id !== instanceId || row.expires_at <= now) throw new AiInputError("这次搜索已过期或内容已改变，请重新提交。");
      return row;
    }
    const recent = tx.get<{ n: number }>(sql`select count(*) n from ai_search_operation where family_id=${context.familyId} and user_id=${context.userId} and created_at>${now-60_000}`)!;
    if (recent.n >= 5) throw new AiError("ai_execution_forbidden", "搜索转换过于频繁，请一分钟后再试。");
    tx.run(sql`delete from ai_search_operation where id in (select id from ai_search_operation where expires_at<${now} limit 100)`);
    tx.run(sql`insert into ai_search_operation(id,instance_id,family_id,user_id,configuration_id,input_hash,consent_version,state,created_at,expires_at)
      values(${key},${instanceId},${context.familyId},${context.userId},${authorization.configurationId},${fingerprint},${authorization.consentVersion},'running',${now},${now+OPERATION_TTL_MS})`);
    return null;
  }, { behavior: "immediate" });
  if (existing) return result(existing);
  const authorize = () => {
    const live = getAiSearchAuthorization(context, { runtime: metadata });
    if (!live || live.configurationId !== authorization.configurationId || live.consentVersion !== authorization.consentVersion) throw new AiError("ai_execution_forbidden", "这次搜索的账号或处理同意已改变。");
  };
  try {
    const assistant = createMemoryAssistant(env, { fetch: dependencies.fetch, execution: { kind: "search", operationId: key, familyId: context.familyId, userId: context.userId, authorize } });
    const expansion = await expandNaturalLanguageQuery(assistant, input.q);
    if (!expansion.ok) throw new AiInputError("无法生成可靠检索条件，请调整描述或使用关键词搜索。");
    const params = planToSearchParams(context, expansion.plan, input);
    const note = `AI 转换的检索词：${expansion.terms.join(" / ")}。手动筛选优先，结果仍来自本地索引并按当前权限过滤。`;
    getDb().transaction(tx => {
      authorize();
      tx.run(sql`update ai_search_operation set state='completed',result_json=${JSON.stringify({ params, note })} where id=${key} and state='running'`);
    }, { behavior: "immediate" });
    return { state: "completed", params, note };
  } catch (error) {
    const code = error instanceof AiError ? error.code : "invalid_model_output";
    getDb().run(sql`update ai_search_operation set state='failed',error_code=${code} where id=${key} and state='running'`);
    return { state: "failed", error: code };
  }
}
