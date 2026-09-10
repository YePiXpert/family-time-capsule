import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { Readable } from "node:stream";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { afterAll, expect, it, vi } from "vitest";
const root = mkdtempSync(path.join(tmpdir(), "ftc-media-derivations-"));
process.env.DATA_DIR = root;
process.env.INITIAL_SETUP_TOKEN = "media-test-setup";
process.env.AUTH_SECRET = "media-test-secret";
process.env.AI_ENABLED = "false";
const { getDb, closeDatabase } = await import("@/db");
const { performSetup } = await import("@/lib/auth/setup");
await performSetup({
  token: "media-test-setup",
  displayName: "虚构爸爸",
  email: "media@example.test",
  password: "media-test-password",
});
const { user, session } = await import("@/db/schema/auth");
const { person, family } = await import("@/db/schema/family");
const { asset } = await import("@/db/schema/asset");
const { contribution } = await import("@/db/schema/contribution");
const { memoryEvent } = await import("@/db/schema/memory");
const { mediaJob } = await import("@/db/schema/media-job");
const { completeOnboarding, getUserBinding } =
  await import("@/lib/family/service");
const actor = getDb().select().from(user).get()!;
await completeOnboarding(actor.id, {
  familyName: "虚构家庭",
  timezone: "Asia/Shanghai",
  childDisplayName: "小雨",
  childBirthDate: "2026-01-01",
  selfDisplayName: "爸爸",
  selfRelationToChild: "爸爸",
});
const binding = await getUserBinding(actor.id);
const context = {
  ...binding,
  familyId: binding.familyId!,
  userId: actor.id,
  userName: actor.name,
  familyTimezone: binding.familyTimezone!,
  childLaterUnlockAge: binding.childLaterUnlockAge!,
};
const { storeOriginal } = await import("@/lib/assets/service");
const { getAssetStorage } = await import("@/lib/assets/storage");
const { requestMediaDerivation, getMediaDerivations, runMediaWorkerOnce } =
  await import("@/lib/media/jobs");
const { GET: mediaGet } = await import("@/app/api/media/[assetId]/route");
const { POST, GET } =
  await import("@/app/api/media/[assetId]/derivations/route");
  const { POST: begin } = await import("@/app/api/uploads/route");
  const { PATCH: chunk } = await import("@/app/api/uploads/[id]/route");
  const { POST: complete } = await import("@/app/api/uploads/[id]/complete/route");
const token = randomUUID();
getDb()
  .insert(session)
  .values({
    id: randomUUID(),
    token,
    userId: actor.id,
    expiresAt: new Date(Date.now() + 3600000),
  })
  .run();
const headers = {
  authorization: `Bearer ${token}`,
  "content-type": "application/json",
};
afterAll(() => {
  closeDatabase();
  rmSync(root, { recursive: true, force: true });
});


async function original(
  type: "image" | "video" | "audio",
  mimeType: string,
  buffer: Buffer,
) {
  const r = await storeOriginal({
    familyId: context.familyId,
    createdByUserId: actor.id,
    type,
    mimeType,
    buffer,
    extension: mimeType.split("/")[1],
    originalFilename: "fictional-source",
    timeSource: "import_time",
  });
  if (r.status !== "stored") throw new Error("duplicate fixture");
  return r.asset;
}
it("creates a real orientation-correct preview with AI off, streams original and derivative hashes, deduplicates jobs and checks API scope", async () => {
  const source = await original(
    "image",
    "image/jpeg",
    await sharp({
      create: { width: 3000, height: 1200, channels: 3, background: "#dac8b4" },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer(),
  );
  const request = () =>
    POST(
      new Request(`http://localhost/api/media/${source.id}/derivations`, {
        method: "POST",
        headers,
        body: JSON.stringify({ kind: "preview" }),
      }),
      { params: Promise.resolve({ assetId: source.id }) },
    );
  expect((await request()).status).toBe(200);
  expect((await request()).status).toBe(200);
  expect(getDb().select().from(mediaJob).all()).toHaveLength(1);
  expect(await runMediaWorkerOnce()).toBe("succeeded");
  const job = getMediaDerivations(context, source.id)[0]!;
  expect(job.status).toBe("succeeded");
  const output = getDb()
    .select()
    .from(asset)
    .where(eq(asset.id, job.outputAssetId!))
    .get()!;
  const metadata = await sharp(
    getAssetStorage().resolvePath(output.storageKey),
  ).metadata();
  expect(metadata.width).toBe(819);
  expect(metadata.height).toBe(2048);
  expect(metadata.orientation).toBeUndefined();
  for (const row of [source, output]) {
    const response = await mediaGet(
      new Request(`http://localhost/api/media/${row.id}`, { headers }),
      { params: Promise.resolve({ assetId: row.id }) },
    );
    expect(response.status).toBe(200);
    const hash = createHash("sha256");
    let size = 0;
    for await (const chunk of Readable.fromWeb(
      response.body! as import("node:stream/web").ReadableStream,
    )) {
      hash.update(chunk);
      size += chunk.length;
    }
    expect(hash.digest("hex")).toBe(row.sha256);
    expect(size).toBe(row.bytes);
  }
  const otherFamily = randomUUID();
  getDb()
    .insert(family)
    .values({ id: otherFamily, name: "另一虚构家庭" })
    .run();
  expect(() =>
    getMediaDerivations({ ...context, familyId: otherFamily }, source.id),
  ).toThrow("source_unavailable");
  const wrong = await POST(
    new Request(`http://localhost/api/media/${source.id}/derivations`, {
      method: "POST",
      headers,
      body: JSON.stringify({ kind: "preview", familyId: otherFamily }),
    }),
    { params: Promise.resolve({ assetId: source.id }) },
  );
  expect(wrong.status).toBe(400);
});
it("converts real synthetic video/audio, waveform and poster; handles missing codec and retry without changing original bytes", async () => {
  const input = path.join(root, "synthetic.mp4");
  const generated = spawnSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=0xcda786:s=160x96:r=10:d=1",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=1",
    "-c:v",
    "libx264",
    "-threads",
    "1",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-shortest",
    input,
  ]);
  expect(generated.status, generated.stderr?.toString()).toBe(0);
  const source = await original("video", "video/mp4", readFileSync(input));
  for (const kind of ["preview", "waveform", "transcode"] as const) {
    requestMediaDerivation(context, source.id, kind);
    expect(await runMediaWorkerOnce(), kind).toBe("succeeded");
  }
  const jobs = getMediaDerivations(context, source.id);
  expect(jobs).toHaveLength(3);
  for (const job of jobs) {
    const row = getDb()
      .select()
      .from(asset)
      .where(eq(asset.id, job.outputAssetId!))
      .get()!;
    if (job.kind === "transcode") {
      const probe = spawnSync("ffprobe", [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "json",
        getAssetStorage().resolvePath(row.storageKey),
      ]);
      expect(
        Number(JSON.parse(probe.stdout.toString()).format.duration),
      ).toBeGreaterThanOrEqual(1);
    } else {
      expect(
        (await sharp(getAssetStorage().resolvePath(row.storageKey)).metadata())
          .width,
      ).toBeGreaterThan(0);
    }
  }
  const wav = path.join(root, "synthetic.wav");
  expect(
    spawnSync("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=660:duration=0.5",
      wav,
    ]).status,
  ).toBe(0);
  const audio = await original("audio", "audio/wav", readFileSync(wav));
  requestMediaDerivation(context, audio.id, "transcode");
  process.env.FFMPEG_PATH = path.join(root, "missing-codec");
  expect(await runMediaWorkerOnce()).toBe("failed");
  expect(getMediaDerivations(context, audio.id)[0]?.errorCode).toBe(
    "codec_unavailable",
  );
  delete process.env.FFMPEG_PATH;
  requestMediaDerivation(context, audio.id, "transcode");
  expect(await runMediaWorkerOnce()).toBe("succeeded");
  expect(
    createHash("sha256")
      .update(readFileSync(getAssetStorage().resolvePath(source.storageKey)))
      .digest("hex"),
  ).toBe(source.sha256);
  expect(readdirSync(path.join(root, "work-media"))).toEqual([]);
}, 30_000);
it("tightened contribution permission denies previously issued derivative URLs and pending work", async () => {
  const source = await original(
    "audio",
    "audio/wav",
    Buffer.concat([
      readFileSync(path.join(root, "synthetic.wav")),
      Buffer.from("private-audio"),
    ]),
  );
  requestMediaDerivation(context, source.id, "waveform");
  expect(await runMediaWorkerOnce()).toBe("succeeded");
  const outputId = getMediaDerivations(context, source.id)[0]!.outputAssetId!;
  const authorId = randomUUID(),
    eventId = randomUUID();
  getDb()
    .insert(person)
    .values({
      id: authorId,
      familyId: context.familyId,
      displayName: "虚构妈妈",
    })
    .run();
  getDb()
    .insert(memoryEvent)
    .values({
      id: eventId,
      familyId: context.familyId,
      title: "私密讲述来源",
      childPersonId: getDb()
        .select()
        .from(person)
        .where(eq(person.isChild, true))
        .get()!.id,
      occurredAt: new Date(),
    })
    .run();
  getDb()
    .insert(contribution)
    .values({
      id: randomUUID(),
      memoryEventId: eventId,
      authorPersonId: authorId,
      audioAssetId: source.id,
      visibility: "family",
      rawText: "私密原话",
    })
    .run();
  const { getPersonProfile } = await import("@/lib/family/profile");
  expect(
    (await getPersonProfile(context, authorId))?.voices.map(
      (v) => v.memoryEventId,
    ),
  ).toEqual([eventId]);
  getDb()
    .update(contribution)
    .set({ visibility: "private" })
    .where(eq(contribution.audioAssetId, source.id))
    .run();
  expect((await getPersonProfile(context, authorId))?.voices).toEqual([]);
  expect(
    (
      await mediaGet(
        new Request(`http://localhost/api/media/${outputId}`, { headers }),
        { params: Promise.resolve({ assetId: outputId }) },
      )
    ).status,
  ).toBe(404);
  expect(
    (
      await GET(
        new Request(`http://localhost/api/media/${source.id}/derivations`, {
          headers,
        }),
        { params: Promise.resolve({ assetId: source.id }) },
      )
    ).status,
  ).toBe(403);
  expect(() => requestMediaDerivation(context, source.id, "waveform")).toThrow(
    "source_unavailable",
  );
  // A public sibling must remain visible when the outer SQL table is named asset.
  const publicAudio=await original('audio','audio/wav',Buffer.concat([readFileSync(path.join(root,'synthetic.wav')),Buffer.from('public-sibling')]));
  getDb().insert(contribution).values({id:randomUUID(),memoryEventId:eventId,authorPersonId:authorId,audioAssetId:publicAudio.id,visibility:'family',rawText:'公开的虚构家人声音'}).run();
  expect((await getPersonProfile(context,authorId))?.voices.map(v=>v.assetId)).toEqual([publicAudio.id]);

});
it("bounded derivative stream rejects overflow without publishing a partial file", async () => {
  const storage = getAssetStorage(),
    id = randomUUID();
  await expect(
    storage.putDerivativeStream(
      "preview",
      context.familyId,
      id,
      "webp",
      Readable.from([Buffer.alloc(33)]),
      new Date(),
      32,
    ),
  ).rejects.toThrow("derivative_output_limit");
  const { buildDerivativeStorageKey } = await import("@/lib/assets/storage");
  expect(
    storage.exists(
      buildDerivativeStorageKey(
        "preview",
        context.familyId,
        id,
        "webp",
        new Date(),
      ),
    ),
  ).toBe(false);
});

it("serializes concurrent workers and rejects cancelled work before publishing", async () => {
  const source = await original(
    "image",
    "image/jpeg",
    await sharp({
      create: { width: 1500, height: 900, channels: 3, background: "#766f61" },
    })
      .jpeg()
      .toBuffer(),
  );
  requestMediaDerivation(context, source.id, "preview");
  const results = await Promise.all([
    runMediaWorkerOnce(),
    runMediaWorkerOnce(),
  ]);
  expect(results.sort()).toEqual(["idle", "succeeded"]);
  const cancelled = await original(
    "image",
    "image/jpeg",
    await sharp({
      create: { width: 300, height: 300, channels: 3, background: "#ac8973" },
    })
      .jpeg()
      .toBuffer(),
  );
  requestMediaDerivation(context, cancelled.id, "preview");
  const controller = new AbortController();
  controller.abort();
  expect(await runMediaWorkerOnce({ signal: controller.signal })).toBe(
    "failed",
  );
  const job = getMediaDerivations(context, cancelled.id)[0]!;
  expect(job.errorCode).toBe("cancelled");
  expect(job.outputAssetId).toBeNull();
  expect(
    getDb()
      .select()
      .from(asset)
      .where(eq(asset.originalAssetId, cancelled.id))
      .all(),
  ).toEqual([]);
});

it("restores original SHA values and regenerates real derivatives while keeping processing jobs out of the portable archive", async () => {
  const { buildDisasterExport } = await import("@/lib/export/service");
  const archive = await buildDisasterExport(context.familyId),
    bytes = readFileSync(archive.filePath);
  const oldAssets = getDb().select().from(asset).all();
  const expectedPreview = oldAssets.find(row => row.derivativeType === 'preview' && oldAssets.some(source=>source.id===row.originalAssetId&&source.type==='image'))!;
  const expected = getDb()
    .select()
    .from(asset)
    .all()
    .filter(row => row.originalAssetId === null)
    .map((row) => ({
      id: row.id,
      sha: row.sha256,
      original: row.originalAssetId,
      kind: row.derivativeType,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const target = mkdtempSync(path.join(tmpdir(), "ftc-media-restored-"));
  process.env.DATA_DIR = target;
  vi.resetModules();
  const targetDb = await import("@/db");
  try {
    const setup = await import("@/lib/auth/setup");
    await setup.performSetup({
      token: "media-test-setup",
      displayName: "虚构恢复管理员",
      email: "restore-media@example.test",
      password: "restore-media-test-password",
    });
    const targetUser = (await import("@/db/schema/auth")).user;
    const targetActor = targetDb.getDb().select().from(targetUser).get()!;
    const restore = await import("@/lib/restore/service");
    await restore.restoreFromZip(bytes, targetActor.id);
    const restoredAsset = (await import("@/db/schema/asset")).asset;
    const actual = targetDb.getDb().select().from(restoredAsset).all();
    expect(
      actual
        .map((row) => ({
          id: row.id,
          sha: row.sha256,
          original: row.originalAssetId,
          kind: row.derivativeType,
        }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    ).toEqual(expected);
    const storage = (await import("@/lib/assets/storage")).getAssetStorage();
    for (const row of actual)
      expect(
        createHash("sha256")
          .update(readFileSync(storage.resolvePath(row.storageKey)))
          .digest("hex"),
      ).toBe(row.sha256);
    expect(
      targetDb
        .getDb()
        .select()
        .from((await import("@/db/schema/media-job")).mediaJob)
        .all(),
    ).toEqual([]);
    const familyService = await import('@/lib/family/service');
    expect((await familyService.bindRestoredFamily(targetActor.id,context.personId!)).ok).toBe(true);
    const restoredBinding=await familyService.getUserBinding(targetActor.id);
    const ctx={...restoredBinding,userId:targetActor.id,userName:targetActor.name,familyId:restoredBinding.familyId!,familyTimezone:restoredBinding.familyTimezone!,childLaterUnlockAge:restoredBinding.childLaterUnlockAge!};
    const jobs=await import('@/lib/media/jobs');
    jobs.requestMediaDerivation(ctx,expectedPreview.originalAssetId!,'preview');expect(await jobs.runMediaWorkerOnce()).toBe('succeeded');
    const regenerated=targetDb.getDb().select().from(restoredAsset).where(eq(restoredAsset.id,jobs.getMediaDerivations(ctx,expectedPreview.originalAssetId!)[0]!.outputAssetId!)).get()!;
    expect(regenerated.sha256).toBe(expectedPreview.sha256);
  } finally {
    targetDb.closeDatabase();
    rmSync(target, { recursive: true, force: true });
    process.env.DATA_DIR = root;
  }
});

it("makes a real 10-bit HEVC MOV playable as H.264 without changing the original", async () => {
  const input = path.join(root, "phone-hevc.mov");
  const generated = spawnSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=0xe8bca9:s=96x64:r=12:d=1", "-c:v", "libx265", "-pix_fmt", "yuv420p10le", "-x265-params", "pools=1:frame-threads=1:log-level=error", "-tag:v", "hvc1", input]);
  expect(generated.status, generated.stderr?.toString()).toBe(0);
  const bytes = readFileSync(input);
  const source = await original("video", "video/quicktime", bytes);
  requestMediaDerivation(context, source.id, "transcode");
  expect(await runMediaWorkerOnce()).toBe("succeeded");
  const job = getMediaDerivations(context, source.id).find(job => job.kind === "transcode")!;
  const output = getDb().select().from(asset).where(eq(asset.id, job.outputAssetId!)).get()!;
  const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_name,pix_fmt,width,height", "-of", "json", getAssetStorage().resolvePath(output.storageKey)]);
  expect(probe.status).toBe(0);
  expect(JSON.parse(probe.stdout.toString()).streams[0]).toMatchObject({ codec_name: "h264", pix_fmt: "yuv420p" });
  expect(readFileSync(getAssetStorage().resolvePath(source.storageKey))).toEqual(bytes);
});

it.each([
  { filename: "program.mpg", mime: "video/mpeg", format: "mpeg", options: [] },
  { filename: "dvd.mpg", mime: "video/mpeg", format: "dvd", options: [] },
  { filename: "transport.ts", mime: "video/mp2t", format: "mpegts", options: [] },
  { filename: "camera.m2ts", mime: "video/mp2t", format: "mpegts", options: ["-mpegts_m2ts_mode", "1"] },
])("uploads $filename with MPEG-2/AC-3 and creates a real H.264/AAC playback copy", async ({ filename, mime, format, options }) => {
  const input = path.join(root, filename);
  const generated = spawnSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=0xe8bca9:s=96x64:r=25:d=1", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=1", "-c:v", "mpeg2video", "-c:a", "ac3", "-shortest", "-f", format, ...options, input]);
  expect(generated.status, generated.stderr?.toString()).toBe(0);
  const bytes = readFileSync(input);
  const started = await begin(new Request("http://localhost/api/uploads", { method: "POST", headers, body: JSON.stringify({ captureId: randomUUID(), filename, declaredMime: mime, totalBytes: bytes.length, source: "web", importSessionId: null, lastModified: null }) }));
  expect(started.status).toBe(201);
  const upload = await started.json();
  const parameters = { params: Promise.resolve({ id: upload.uploadId }) };
  const uploaded = await chunk(new Request(`http://localhost/api/uploads/${upload.uploadId}`, { method: "PATCH", headers: { authorization: headers.authorization, "content-type": "application/offset+octet-stream", "upload-offset": "0", "content-length": String(bytes.length) }, body: new Blob([Uint8Array.from(bytes)]) }), parameters);
  expect(uploaded.status).toBe(204);
  const completed = await complete(new Request(`http://localhost/api/uploads/${upload.uploadId}/complete`, { method: "POST", headers }), parameters);
  expect(completed.status).toBe(201);
  const saved = await completed.json();
  const source = getDb().select().from(asset).where(eq(asset.id, saved.assetId)).get()!;
  expect(source).toMatchObject({ type: "video", mimeType: mime });
  expect(source.durationMs).toBeGreaterThan(500);
  expect(source.width).toBe(96);
  expect(source.height).toBe(64);
  requestMediaDerivation(context, source.id, "transcode");
  for (let i = 0; i < 12 && !getMediaDerivations(context, source.id).some(j => j.kind === "transcode" && j.status === "succeeded"); i++) await runMediaWorkerOnce();
  const job = getMediaDerivations(context, source.id).find(j => j.kind === "transcode")!;
  expect(job.status).toBe("succeeded");
  const output = getDb().select().from(asset).where(eq(asset.id, job.outputAssetId!)).get()!;
  const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_name,pix_fmt,width,height", "-of", "json", getAssetStorage().resolvePath(output.storageKey)]);
  expect(probe.status).toBe(0);
  expect(JSON.parse(probe.stdout.toString()).streams[0]).toMatchObject({ codec_name: "h264", pix_fmt: "yuv420p" });
  expect(JSON.parse(probe.stdout.toString()).streams[1]).toMatchObject({ codec_name: "aac" });
  expect(JSON.parse(probe.stdout.toString()).streams[0]).toMatchObject({ width: 96, height: 64 });
  expect(readFileSync(getAssetStorage().resolvePath(source.storageKey))).toEqual(bytes);
});

it("also transcodes a bare MPEG video sequence without treating it as a program stream", async () => {
  const input = path.join(root, "sequence.m2v");
  const generated = spawnSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=0x345678:s=96x64:r=25:d=1", "-c:v", "mpeg2video", "-f", "mpeg2video", input]);
  expect(generated.status, generated.stderr?.toString()).toBe(0);
  const bytes = readFileSync(input);
  const source = await original("video", "video/mpeg", bytes);
  requestMediaDerivation(context, source.id, "transcode");
  expect(await runMediaWorkerOnce()).toBe("succeeded");
  expect(getMediaDerivations(context, source.id).find(j => j.kind === "transcode")?.status).toBe("succeeded");
  expect(readFileSync(getAssetStorage().resolvePath(source.storageKey))).toEqual(bytes);
});
