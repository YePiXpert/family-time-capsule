import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { family, person } from "@/db/schema/family";
import { user, session } from "@/db/schema/auth";
import { memoryEvent } from "@/db/schema/memory";
import { createMemoryAssistant } from "@/lib/ai/server";
import { enableAiProcessingConsent, enqueueAiJob, revokeAiProcessingConsent } from "@/lib/ai/jobs";
import { runAiWorkerOnce } from "@/jobs/runtime";
import { AiJobRegistry } from "@/jobs/registry";
import { runNaturalSearchOperation, readNaturalSearchOperation } from "@/lib/search/operations";
import { POST } from "@/app/api/search/natural/route";
import type { FamilyContext } from "@/lib/family/context";

let server: Server, calls = 0;
const originalEnv = { ...process.env };
const familyId = randomUUID(), ownerId = randomUUID(), editorId = randomUUID(), chosenPerson = randomUUID(), eventId = randomUUID(), token = randomUUID();
const owner: FamilyContext = { familyId, userId: ownerId, userName: "维护者", personId: null, role: "owner", accountEnabled: true, isGuardian: false, familyTimezone: "Asia/Shanghai", childLaterUnlockAge: 18 };
const editor: FamilyContext = { ...owner, userId: editorId, userName: "作者", role: "editor" };
const plan = { keywords: ["公园"], synonyms: [], personNames: [], year: 2024, month: 2, mediaType: "image" };
beforeAll(async () => {
  server = createServer(async (req,res) => {
    for await (const _ of req) { void _; }
    calls++; res.setHeader("content-type","application/json");
    res.end(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(plan) } }] }));
  });
  await new Promise<void>(resolve => server.listen(0,"127.0.0.1",resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("test server unavailable");
  Object.assign(process.env,{ AUTH_SECRET: "synthetic-ai-search-auth-secret", AI_PROVIDER: "openai-compatible", AI_BASE_URL: `http://127.0.0.1:${address.port}/v1`, AI_API_KEY: "synthetic-shared-budget-key", AI_MODEL: "query-test", AI_DAILY_MAX_REQUESTS: "1" });
  getDb().insert(family).values({ id: familyId, name: "隔离 AI 搜索家庭" }).run();
  getDb().insert(user).values([{ id: ownerId, familyId, name: owner.userName, role:"owner", email:"ai-search-owner@example.invalid" },{ id: editorId,familyId,name:editor.userName,role:"editor",email:"ai-search-editor@example.invalid" }]).run();
  getDb().insert(session).values({ id:randomUUID(),userId:editorId,token,expiresAt:new Date(Date.now()+3600000) }).run();
  getDb().insert(person).values({ id:chosenPerson,familyId,displayName:"用户明确选择的人物",isChild:false }).run();
  getDb().insert(memoryEvent).values({ id:eventId,familyId,title:"原始来源",occurredAt:new Date(),visibility:"private",createdByUserId:editorId }).run();
});
beforeEach(() => {
  calls=0; getDb().run(sql`delete from ai_daily_usage`); getDb().run(sql`delete from ai_search_operation`);
  expect(enableAiProcessingConsent(owner,{ capability:"text",allowAutomaticFamilyContent:false,configurationId:createMemoryAssistant().provider.configurationId }).ok).toBe(true);
});
afterAll(async () => {
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env,originalEnv);
  server?.closeAllConnections(); if (server) await new Promise<void>(resolve=>server.close(()=>resolve()));
});
const post = (id:string, extra:Record<string,string> = {}) => POST(new Request("http://localhost/api/search/natural",{ method:"POST",headers:{ authorization:`Bearer ${token}`,"content-type":"application/x-www-form-urlencoded",host:"localhost",origin:"http://localhost" },body:new URLSearchParams({q:"去公园的回忆",operation_id:id,...extra}) }));

it("real worker, natural-search POST and diagnostic share one durable quota", async () => {
  const job = enqueueAiJob({familyId,requestedByUserId:editorId,jobType:"test.shared-budget.v1",entityType:"memory_event",entityId:eventId,requiredCapability:"text",triggerMode:"manual",sources:[{kind:"memory_event",id:eventId}]});
  expect(job.ok).toBe(true);
  const registry = new AiJobRegistry().register("test.shared-budget.v1",async({assistant})=>{ await assistant.generateText({messages:[{role:"user",content:"synthetic worker input"}]}); return {commit:()=>{}}; });
  expect(await runAiWorkerOnce({registry})).toMatchObject({status:"completed"});
  const operationId=randomUUID(); const response=await post(operationId);
  expect(response.status).toBe(303);
  expect(await readNaturalSearchOperation(editor,operationId,{q:"去公园的回忆"})).toEqual({state:"failed",error:"ai_quota_exceeded"});
  await expect(createMemoryAssistant(process.env,{execution:{kind:"diagnostic",operationId:randomUUID()}}).generateText({messages:[{role:"user",content:"synthetic diagnostic"}]})).rejects.toMatchObject({code:"ai_quota_exceeded"});
  expect(calls).toBe(1);
});

it("ordinary author's concurrent POST retries and result reads do not repeat model conversion", async () => {
  const id=randomUUID();
  const extra={person:chosenPerson,from:"2025-01-01",to:"2025-12-31",media:"audio",tag:"旅行"};
  const [a,b]=await Promise.all([post(id,extra),post(id,extra)]);
  expect(a.status).toBe(303);expect(b.status).toBe(303);
  await post(id,extra);
  const input={q:"去公园的回忆",personId:chosenPerson,dateFrom:extra.from,dateTo:extra.to,mediaType:"audio" as const,tag:extra.tag};
  const result=await readNaturalSearchOperation(editor,id,input);
  expect(result).toMatchObject({state:"completed",params:{q:"公园",personId:chosenPerson,dateFrom:extra.from,dateTo:extra.to,mediaType:"audio",tag:"旅行"}});
  expect(await readNaturalSearchOperation(editor,id,input)).toEqual(result);
  expect(await readNaturalSearchOperation(owner,id,input)).toBeNull();
  expect(calls).toBe(1);
});

it("revoked consent cannot dispatch a new search or revive a previous private result", async () => {
  const id=randomUUID(); await runNaturalSearchOperation(editor,id,{q:"公园"});
  revokeAiProcessingConsent(owner,"text");
  await expect(runNaturalSearchOperation(editor,randomUUID(),{q:"公园"})).rejects.toMatchObject({code:"ai_execution_forbidden"});
  expect(await readNaturalSearchOperation(editor,id,{q:"公园"})).toBeNull();
  expect(enableAiProcessingConsent(owner,{capability:"text",allowAutomaticFamilyContent:false,configurationId:createMemoryAssistant().provider.configurationId}).ok).toBe(true);
  expect(await readNaturalSearchOperation(editor,id,{q:"公园"})).toBeNull();
  await expect(runNaturalSearchOperation(editor,id,{q:"公园"})).rejects.toMatchObject({code:"ai_input_invalid"});
  expect(calls).toBe(1);
});
