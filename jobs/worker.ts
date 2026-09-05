import "server-only";

import { runMediaWorkerOnce, runMediaWorkerLoop } from "@/lib/media/jobs";
import { runAiWorkerLoop, runAiWorkerOnce } from "./runtime";

function pollInterval(): number | undefined {
  const raw = process.env.AI_WORKER_POLL_MS;
  if (raw === undefined || raw === "") return undefined;
  if (!/^\d+$/u.test(raw)) throw new Error("invalid AI_WORKER_POLL_MS");
  return Number(raw);
}

const once = process.argv.includes("--once");

if (once) {
  const media = await runMediaWorkerOnce();
  console.log(`[media-worker] ${media}`);
  const result = await runAiWorkerOnce();
  // Operational status only; never print prompts, source text or provider data.
  console.log(`[ai-worker] ${result.status}`);
} else {
  const controller = new AbortController();
  process.once("SIGINT", () => controller.abort());
  process.once("SIGTERM", () => controller.abort());
  await Promise.all([
    runMediaWorkerLoop(controller.signal),
    runAiWorkerLoop({
      signal: controller.signal,
      pollMs: pollInterval(),
    }),
  ]);
}
