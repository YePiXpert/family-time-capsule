import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { createMemoryAssistant } from "@/lib/ai/server";
import { consumeAiDailyQuota, UNLIMITED_AI_DAILY_QUOTA } from "@/lib/ai/quota";

const env = { AI_PROVIDER: "openai-compatible", AI_BASE_URL: "http://127.0.0.1:19876/v1", AI_API_KEY: "synthetic-dispatch-key", AI_MODEL: "test-text", AI_TRANSCRIPTION_MODEL: "test-audio", AI_DAILY_MAX_REQUESTS: "1" };
const fetch = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }] }), { headers: { "content-type": "application/json" } }));
const input = { messages: [{ role: "user" as const, content: "synthetic test" }] };
const execution = () => ({ kind: "diagnostic" as const, operationId: randomUUID() });
const usage = () => getDb().get<{ requests: number; audio_seconds: number }>(sql`select requests,audio_seconds from ai_daily_usage where day=${new Date().toISOString().slice(0,10)}`);
beforeEach(() => { fetch.mockClear(); getDb().run(sql`delete from ai_daily_usage`); });

describe("production factory dispatch boundary", () => {
  it("requires an explicit server execution context before a model can receive anything", async () => {
    const assistant = createMemoryAssistant(env, { fetch });
    await expect(assistant.generateText(input)).rejects.toMatchObject({ code: "ai_execution_forbidden" });
    expect(fetch).not.toHaveBeenCalled(); expect(usage()).toBeUndefined();
  });

  it("counts diagnostics even with unlimited limits and refuses the next call at the shared limit", async () => {
    await createMemoryAssistant({ ...env, AI_DAILY_MAX_REQUESTS: "0" }, { fetch, execution: execution() }).generateText(input);
    expect(usage()).toMatchObject({ requests: 1 });
    await expect(createMemoryAssistant(env, { fetch, execution: execution() }).generateText(input)).rejects.toMatchObject({ code: "ai_quota_exceeded" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("local validation and cancellation reserve no quota; uncertain network failures remain counted", async () => {
    const assistant = createMemoryAssistant(env, { fetch, execution: execution() });
    await expect(assistant.generateText({ messages: [] })).rejects.toMatchObject({ code: "ai_input_invalid" });
    await expect(assistant.generateText({ ...input, signal: AbortSignal.abort() })).rejects.toMatchObject({ code: "ai_aborted" });
    expect(usage()).toBeUndefined();
    fetch.mockRejectedValueOnce(new Error("synthetic connection loss"));
    await expect(assistant.generateText(input)).rejects.toMatchObject({ code: "ai_network_error" });
    expect(usage()).toMatchObject({ requests: 1 });
    expect(getDb().get(sql`select state from ai_dispatch order by created_at desc limit 1`)).toMatchObject({ state: "uncertain" });
  });

  it("probes real audio and rounds up subsecond duration; supplied zero cannot bypass the limit", async () => {
    const bytes = Buffer.alloc(44 + 16000 * 2 / 10);
    bytes.write("RIFF"); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write("WAVEfmt ",8); bytes.writeUInt32LE(16,16); bytes.writeUInt16LE(1,20); bytes.writeUInt16LE(1,22); bytes.writeUInt32LE(16000,24); bytes.writeUInt32LE(32000,28); bytes.writeUInt16LE(2,32); bytes.writeUInt16LE(16,34); bytes.write("data",36); bytes.writeUInt32LE(bytes.length - 44,40);
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ text: "synthetic" }), { headers: { "content-type": "application/json" } }));
    await createMemoryAssistant({ ...env, AI_DAILY_MAX_AUDIO_SECONDS: "1" }, { fetch, execution: execution() }).transcribeAudio({ audio: { bytes, mimeType: "audio/wav", fileName: "synthetic.wav" }, durationSeconds: 0 });
    expect(usage()).toMatchObject({ requests: 1, audio_seconds: 1 });
  });

  it("unknown audio is refused before dispatch even when its claimed duration looks valid", async () => {
    await expect(createMemoryAssistant(env, { fetch, execution: execution() }).transcribeAudio({ audio: { bytes: new Uint8Array([1,2,3]), mimeType: "audio/wav", fileName: "invalid.wav" }, durationSeconds: 3 })).rejects.toMatchObject({ code: "ai_input_invalid" });
    expect(fetch).not.toHaveBeenCalled(); expect(usage()).toBeUndefined();
  });
});

it("a missed conditional reservation never becomes an uncounted success", () => {
  const db = { run: vi.fn(() => ({ changes: 0 })), get: vi.fn(() => undefined) };
  expect(consumeAiDailyQuota({ requests: 1, images: 0, audioSeconds: 0 }, UNLIMITED_AI_DAILY_QUOTA, { db: db as never }).ok).toBe(false);
});

it("a recreated runtime cannot resend an uncertain operation after restart", async () => {
  const intent=execution();
  fetch.mockRejectedValueOnce(new Error("lost response"));
  await expect(createMemoryAssistant({ ...env,AI_DAILY_MAX_REQUESTS:"0" },{fetch,execution:intent}).generateText(input)).rejects.toMatchObject({code:"ai_network_error"});
  await expect(createMemoryAssistant({ ...env,AI_DAILY_MAX_REQUESTS:"0" },{fetch,execution:intent}).generateText(input)).rejects.toMatchObject({code:"ai_dispatch_duplicate"});
  expect(fetch).toHaveBeenCalledTimes(1); expect(usage()).toMatchObject({requests:1});
});

it("independent processes contend for one SQLite quota without exceeding it", async () => {
  const { spawn } = await import("node:child_process");
  const source = `import { consumeAiDailyQuota } from './lib/ai/quota.ts'; import { closeDatabase } from './db/index.ts'; let accepted=0; for(let n=0;n<5;n++) if(consumeAiDailyQuota({requests:1,images:0,audioSeconds:0.1},{maxRequests:7,maxImages:0,maxAudioSeconds:7},{now:new Date('2026-09-21T23:59:59.999Z')}).ok) accepted++; closeDatabase(); process.stdout.write(String(accepted));`;
  const run = () => new Promise<number>((resolve,reject)=> {
    const child=spawn(process.execPath,["--import","tsx","--conditions=react-server","--input-type=module","-e",source],{cwd:process.cwd(),env:{...process.env},stdio:["ignore","pipe","pipe"]});
    let out="",err="";child.stdout.on("data",chunk=>out+=chunk);child.stderr.on("data",chunk=>err+=chunk);
    child.on("error",reject);child.on("close",code=>code===0?resolve(Number(out)):reject(new Error(err)));
  });
  const accepted=await Promise.all(Array.from({length:6},run));
  expect(accepted.reduce((a,b)=>a+b,0)).toBe(7);
  expect(getDb().get(sql`select requests,audio_seconds from ai_daily_usage where day='2026-09-21'`)).toEqual({requests:7,audio_seconds:7});
  expect(consumeAiDailyQuota({requests:1,images:0,audioSeconds:0.1},{maxRequests:7,maxImages:0,maxAudioSeconds:7},{now:new Date('2026-09-22T00:00:00.000Z')}).ok).toBe(true);
},20000);

it("a separate process revoking between reservation and send prevents dispatch and refunds the known unsent call", async () => {
  const { spawnSync } = await import("node:child_process");
  const { AiError } = await import("@/lib/ai/errors");
  const db=getDb();
  db.run(sql`create table if not exists test_ai_authorization (active integer not null)`);
  db.run(sql`delete from test_ai_authorization`); db.run(sql`insert into test_ai_authorization values (1)`);
  const original=db.transaction.bind(db);
  let transactions=0;
  const spy=vi.spyOn(db,"transaction").mockImplementation(((...args: Parameters<typeof db.transaction>)=>{
    const result=original(...args);
    if (++transactions===1) {
      const child=spawnSync(process.execPath,["--import","tsx","--conditions=react-server","--input-type=module","-e",`import {getDb,closeDatabase} from './db/index.ts'; import {sql} from 'drizzle-orm';getDb().run(sql\`update test_ai_authorization set active=0\`);closeDatabase();`],{cwd:process.cwd(),env:{...process.env},encoding:"utf8",timeout:10000});
      expect(child.status,child.stderr).toBe(0);
    }
    return result;
  }) as typeof db.transaction);
  try {
    const authorize=()=>{ if (!db.get<{active:number}>(sql`select active from test_ai_authorization`)?.active) throw new AiError("ai_execution_forbidden","revoked"); };
    await expect(createMemoryAssistant(env,{fetch,execution:{kind:"search",operationId:randomUUID(),familyId:"test",userId:"test",authorize}}).generateText(input)).rejects.toMatchObject({code:"ai_execution_forbidden"});
    expect(fetch).not.toHaveBeenCalled(); expect(usage()).toMatchObject({requests:0});
    expect(db.get(sql`select state from ai_dispatch order by created_at desc limit 1`)).toEqual({state:"cancelled"});
  } finally {spy.mockRestore();db.run(sql`drop table test_ai_authorization`);}
},15000);
