import { readFileSync, mkdirSync, writeFileSync, renameSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { AI_ENV_KEYS, aiConfigurationStatus, aiConfigurationFingerprint, readAiCapabilityChecks, testAiCapability } from "../lib/ai/diagnostics";
import { createMemoryAssistant } from "../lib/ai/server";
import { AiError, AiProviderError } from "../lib/ai/errors";

async function main() {
  const [command, capability] = process.argv.slice(2);
  if (command === "status") {
    if (process.argv.includes("--check-effective")) {
      let input = "";
      for await (const chunk of process.stdin) {
        input += String(chunk);
        if (input.length > 64 * 1024) throw new Error("effective_config_too_large");
      }
      const expected = JSON.parse(input) as Record<string, unknown>;
      if (AI_ENV_KEYS.some(key => String(expected[key] ?? "") !== (process.env[key] ?? ""))) throw new Error("container_configuration_mismatch");
    }
    let workerAvailable = false;
    let database: InstanceType<typeof Database> | undefined;
    try {
      database = new Database(path.join(process.env.DATA_DIR ?? "/data", "db/capsule.sqlite"), { readonly: true, fileMustExist: true });
      workerAvailable = Boolean(database.prepare("SELECT 1 FROM ai_worker_heartbeat WHERE last_seen_at >= ? AND status <> 'stopping' LIMIT 1").get(Math.floor(Date.now() / 1000) - 90));
    } catch { /* Missing/old database is a status, never silently initialized by status. */ }
    finally { database?.close(); }
    console.log(JSON.stringify({ ...aiConfigurationStatus(), workerAvailable, checks: readAiCapabilityChecks() }));
    return;
  }
  if (command !== "test" || !["text", "vision", "transcription"].includes(capability ?? "")) throw new Error("invalid_diagnostic_command");
  const selected = capability as "text" | "vision" | "transcription";
  const stateDir = path.join(process.env.DATA_DIR ?? "/data", "ai-diagnostics");
  const configuration = aiConfigurationFingerprint();
  let result: { passed: boolean; code?: string; usage?: unknown; httpStatus?: number | null };
  try {
    const sample = selected === "transcription" ? readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "ai-smoke.wav")) : new Uint8Array();
    result = await testAiCapability(createMemoryAssistant(), selected, sample);
  } catch (error) {
    // Neither raw Provider error nor response/prompt content leaves this command.
    result = { passed: false, code: error instanceof AiError ? error.code : "capability_test_failed", httpStatus: error instanceof AiProviderError ? error.status : null };
  }
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const record = { ...result, capability: selected, configuration, testedAt: new Date().toISOString() };
  const temporary = path.join(stateDir, `${selected}.${process.pid}.tmp`);
  writeFileSync(temporary, JSON.stringify(record), { mode: 0o600 });
  renameSync(temporary, path.join(stateDir, `${selected}.json`));
  console.log(JSON.stringify(record));
  if (!result.passed) process.exitCode = 1;
}

void main().catch(error => {
  console.error(JSON.stringify({ passed: false, code: error instanceof AiError ? error.code : "ai_diagnostic_failed" }));
  process.exitCode = 1;
});
