import { createServer } from "node:http";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, expect, it, vi } from "vitest";
const dir = mkdtempSync(path.join(tmpdir(), "ftc-video-audio-"));
process.env.DATA_DIR = dir; process.env.AUTH_SECRET = "video-fixture-secret-01234567890"; process.env.INITIAL_SETUP_TOKEN = "video-audio";
const { getDb, closeDatabase } = await import("@/db");
const { user } = await import("@/db/schema/auth");
const { asset } = await import("@/db/schema/asset");
const { assetTranscript } = await import("@/db/schema/transcript");
const { performSetup } = await import("@/lib/auth/setup");
const { completeOnboarding } = await import("@/lib/family/service");
const { ingestMedia } = await import("@/lib/assets/ingest");
const { getAssetStorage } = await import("@/lib/assets/storage");
const { enqueueAiJob } = await import("@/lib/ai/jobs");
const { runAiWorkerOnce } = await import("@/jobs/runtime");
const { DeterministicFakeMemoryAssistant } = await import("@/lib/ai/fake");
const { extractVideoAudio, extractVideoFrames } = await import("@/lib/media/ffmpeg");
const { probeMedia } = await import("@/lib/metadata/ffprobe");
afterAll(() => { closeDatabase(); rmSync(dir, { recursive: true, force: true }); });
expect((await performSetup({ token: "video-audio", displayName: "虚构管理员", email: "video@fixture.invalid", password: "video-fixture-password" })).ok).toBe(true);
const actor = getDb().select().from(user).get()!;
const family = await completeOnboarding(actor.id, { familyName: "虚构视频", timezone: "Asia/Shanghai", childDisplayName: "孩子", childBirthDate: "2020-01-01", selfDisplayName: "管理员", selfRelationToChild: "家人", selfIsGuardian: true });
if (!family.ok) throw new Error("fixture family failed");
const familyId = family.familyId;
function video(seconds: number, audio = true): string {
  const file = path.join(dir, `${randomUUID()}.mp4`);
  const result = spawnSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=red:s=32x32:r=1", ...(audio ? ["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=16000"] : []), "-t", String(seconds), "-c:v", "mpeg4", ...(audio ? ["-c:a", "aac"] : []), "-metadata", "comment=must-not-leave-original", "-y", file], { timeout: 30_000 });
  if (result.status !== 0) throw new Error(`ffmpeg fixture failed: ${result.stderr.toString()}`);
  return file;
}
async function ingest(file: string) {
  const result = await ingestMedia({ familyId, createdByUserId: actor.id, kind: "video", filename: "原始视频.mp4", declaredMime: "video/mp4", buffer: readFileSync(file), clientLastModifiedMs: null });
  if (result.status !== "stored") throw new Error("fixture ingest failed");
  return result.asset;
}

it("extracts a real 120-second audio track into bounded PCM and commits through the real queue", async () => {
  const fixture = video(120);
  const originalBytes = readFileSync(fixture);
  const original = await ingest(fixture);
  const assistant = new DeterministicFakeMemoryAssistant();
  const calls = vi.spyOn(assistant, "transcribeAudio").mockImplementation(async input => {
    const bytes = Buffer.from(input.audio.bytes);
    expect(input.audio.mimeType).toBe("audio/wav"); expect(input.audio.fileName).toBe("audio.wav");
    expect(bytes.subarray(0, 4).toString()).toBe("RIFF"); expect(bytes.length).toBeLessThanOrEqual(4 * 1024 * 1024);
    expect(bytes.includes(Buffer.from("must-not-leave-original"))).toBe(false);
    const decoded = path.join(dir, "extracted.wav"); writeFileSync(decoded, bytes);
    expect((await probeMedia(decoded))?.durationMs).toBe(120000);
    // Synthetic tone fixture: no claims about a live model recognizing speech.
    return { text: "", language: null, durationSeconds: null, segments: [], provenance: { providerId: assistant.provider.id, providerName: assistant.provider.displayName, model: assistant.capabilities.transcription.model! } };
  });
  const queued = enqueueAiJob({ familyId, requestedByUserId: actor.id, jobType: "transcribe.asset.v1", entityType: "asset", entityId: original.id, requiredCapability: "transcription", triggerMode: "manual", sources: [{ kind: "asset", id: original.id }] }, { runtime: assistant });
  expect(queued.ok).toBe(true);
  expect(await runAiWorkerOnce({ assistant })).toMatchObject({ status: "completed" });
  expect(calls).toHaveBeenCalledOnce();
  expect(getDb().select().from(assetTranscript).where(eq(assetTranscript.assetId, original.id)).get()).toMatchObject({ rawTranscript: "", segmentsJson: null, sourceSha256: original.sha256, status: "machine" });
  expect(getDb().select().from(asset).where(eq(asset.id, original.id)).get()).toEqual(original);
  expect(getAssetStorage().read(original.storageKey)).toEqual(originalBytes);
});

it("rejects long videos, silent videos and automatic video requests before calling the provider", async () => {
  const assistant = new DeterministicFakeMemoryAssistant(); const calls = vi.spyOn(assistant, "transcribeAudio");
  for (const [seconds, sound, automatic, code] of [[121, true, false, "video_duration_limit"], [1, false, false, "video_has_no_audio"], [2, true, true, "video_requires_manual_request"]] as const) {
    const original = await ingest(video(seconds, sound));
    expect(enqueueAiJob({ familyId, requestedByUserId: actor.id, jobType: "transcribe.asset.v1", entityType: "asset", entityId: original.id, requiredCapability: "transcription", triggerMode: automatic ? "automatic" : "manual", sources: [{ kind: "asset", id: original.id }] }, { runtime: assistant }).ok).toBe(true);
    expect(await runAiWorkerOnce({ assistant })).toMatchObject({ status: "failed", errorCode: code });
  }
  expect(calls).not.toHaveBeenCalled();
});

it("rejects playlists without reading their referenced input and honors cancellation", async () => {
  let requests = 0;
  const server = createServer((_req, response) => { requests++; response.end("unexpected media fetch"); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture server failed");
  try {
    const file = path.join(dir, "playlist.mp4");
    writeFileSync(file, `#EXTM3U\n#EXTINF:1,\nhttp://127.0.0.1:${address.port}/not-authorized.wav\n`);
    expect(await probeMedia(file)).toBeNull();
    expect(await extractVideoAudio(file, new AbortController().signal)).toMatchObject({ status: "failed" });
    expect(await extractVideoFrames(file, { durationSeconds: 1 })).toMatchObject({ status: "failed" });
    expect(requests).toBe(0);
    const cancelled = new AbortController(); cancelled.abort();
    expect(await extractVideoAudio(file, cancelled.signal)).toMatchObject({ status: "aborted" });
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
