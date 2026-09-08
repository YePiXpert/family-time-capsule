import "server-only";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { probeMedia } from "@/lib/metadata/ffprobe";
import { getInstanceId } from "@/lib/instance/service";
import { AiError, AiInputError, AiProviderError } from "./errors";
import { consumeAiDailyQuota, loadAiDailyQuotaLimits, quotaError } from "./quota";
import type { AiEnvironment } from "./config";
import type { AiAudioInput, AiCapability } from "./types";
import type { AiFetch } from "./openai-compatible";
import { prepareAiFetch } from "./outbound";

/** Created by trusted server entry points, never parsed from an HTTP payload. */
export type AiExecutionContext =
  | { kind: "diagnostic"; operationId: string }
  | { kind: "job" | "search"; operationId: string | (() => string); familyId: string; userId: string; authorize: (capability: AiCapability) => void };
export type AiDispatchRequest = {
  capability: AiCapability; configurationId: string; baseUrl: string;
  url: string; init: RequestInit; audio?: AiAudioInput;
};
export type AiDispatch = (request: AiDispatchRequest) => Promise<Response>;

function assertActive(request: AiDispatchRequest) {
  if (request.init.signal?.aborted) throw new AiProviderError({ capability: request.capability, code: "ai_aborted", message: "AI request was aborted before dispatch.", retryable: false });
}

/** Probe the bytes actually being sent, not a caller-supplied duration estimate. */
export async function measureAiAudio(audio: AiAudioInput): Promise<number> {
  const directory = mkdtempSync(path.join(tmpdir(), "ftc-ai-duration-"));
  try {
    const file = path.join(directory, "audio");
    writeFileSync(file, audio.bytes, { mode: 0o600 });
    const result = await probeMedia(file);
    if (!result || result.durationMs === null || result.durationMs <= 0 || !Number.isFinite(result.durationMs)) throw new AiInputError("音频时长无法确认，请核对原件或媒体探测工具后再转写。");
    return result.durationMs / 1000;
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

export function createAiDispatcher(execution: AiExecutionContext | undefined, env: AiEnvironment, fetch?: AiFetch): AiDispatch {
  let call = 0;
  return async request => {
    if (!execution) throw new AiError("ai_execution_forbidden", "AI calls require an authorized server execution context.");
    assertActive(request);
    const audioSeconds = request.capability === "transcription"
      ? request.audio ? Math.ceil(await measureAiAudio(request.audio)) : (() => { throw new AiInputError("Audio duration cannot be verified."); })()
      : 0;
    const instanceId = await getInstanceId();
    const send = fetch ? () => fetch(request.url,request.init) : await prepareAiFetch(request.url,request.init,request.baseUrl,env);
    const operationId = typeof execution.operationId === "function" ? execution.operationId() : execution.operationId;
    if (!/^[A-Za-z0-9_.:-]{1,200}$/.test(operationId)) throw new AiInputError("AI operation identity is invalid.");
    // Resolve, probe and encode before taking the SQLite writer lock.
    assertActive(request);
    const amounts = { requests: 1, images: request.capability === "vision" ? 1 : 0, audioSeconds };
    const now = new Date(), day = now.toISOString().slice(0,10), timestamp = now.getTime();
    const id = createHash("sha256").update(JSON.stringify([instanceId, execution.kind, operationId, request.configurationId, request.capability, call])).digest("hex");
    const db = getDb();
    db.transaction(tx => {
      assertActive(request);
      if (execution.kind !== "diagnostic") execution.authorize(request.capability);
      if (tx.get(sql`select 1 from ai_dispatch where id=${id}`)) throw new AiError("ai_dispatch_duplicate", "This AI request was already dispatched; its previous result may be uncertain.");
      const reserved = consumeAiDailyQuota(amounts, loadAiDailyQuotaLimits(env), { db: tx, now });
      if (!reserved.ok) throw quotaError(reserved.exceeded, reserved.retryAfterMs);
      tx.run(sql`insert into ai_dispatch(id,operation_id,kind,family_id,user_id,configuration_id,capability,day,requests,images,audio_seconds,state,created_at,updated_at)
        values(${id},${operationId},${execution.kind},${execution.kind === "diagnostic" ? null : execution.familyId},${execution.kind === "diagnostic" ? null : execution.userId},${request.configurationId},${request.capability},${day},1,${amounts.images},${audioSeconds},'reserved',${timestamp},${timestamp})`);
    }, { behavior: "immediate" });
    call++;
    let sendStarted = false;
    try {
      // Commit the debit first so a crash or failed second commit cannot make a
      // possibly billable request free. Recheck authorization under the writer
      // lock: a revocation from another process cannot commit before send starts.
      const pending = db.transaction(tx => {
        assertActive(request);
        if (execution.kind !== "diagnostic") execution.authorize(request.capability);
        sendStarted = true;
        const response = send();
        // Observe rejection even if updating/committing this transaction fails.
        void response.catch(() => undefined);
        tx.run(sql`update ai_dispatch set state='dispatched',updated_at=${Date.now()} where id=${id}`);
        return { response };
      }, { behavior: "immediate" });
      const result = await pending.response;
      db.run(sql`update ai_dispatch set state='responded',updated_at=${Date.now()} where id=${id}`);
      return result;
    } catch (error) {
      if (!sendStarted) {
        // A known pre-send refusal can be refunded. A crash leaves the durable
        // reservation counted because its disposition cannot be established.
        db.transaction(tx => {
          const changed = tx.run(sql`update ai_dispatch set state='cancelled',updated_at=${Date.now()} where id=${id} and state='reserved'`);
          if (changed.changes === 1) tx.run(sql`update ai_daily_usage set requests=requests-1,images=images-${amounts.images},audio_seconds=audio_seconds-${audioSeconds} where day=${day}`);
        }, { behavior: "immediate" });
      } else {
        // No refund: timeout/reset or process crash may follow provider billing.
        try { db.run(sql`update ai_dispatch set state='uncertain',updated_at=${Date.now()} where id=${id}`); } catch { /* durable reservation remains counted */ }
      }
      throw error;
    }
  };
}
