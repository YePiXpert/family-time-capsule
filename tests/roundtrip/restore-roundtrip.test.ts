import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * RH-005：灾难恢复 roundtrip（真实文件系统 + 真实服务器，零 mock）。
 *
 * create archive A → export → **destroy A** → clean B → restore →
 * boot app against B → login/setup（按恢复设计）→ visit Timeline →
 * verify records → media accessible（含 Range）→ export B → verify B export。
 */

const PORT = "3201";
const BASE = `http://localhost:${PORT}`;

const dirA = mkdtempSync(path.join(tmpdir(), "ftc-rt-a-"));
const dirB = mkdtempSync(path.join(tmpdir(), "ftc-rt-b-"));
process.env.INITIAL_SETUP_TOKEN = "rt-token";
process.env.AUTH_SECRET = "rt-test-secret-0123456789abcdef";

const fixtures = path.join(__dirname, "..", "fixtures");
const read = (name: string) => readFileSync(path.join(fixtures, name));

type Expectation = {
  zipPath: string;
  familyId: string;
  familyUnlockAge: number;
  eventTitle: string;
  eventDate: string; // 详情页可见文本（家庭时区）
  ageLabel: string;
  assetId: string;
  assetSha256: string;
  photoEventId: string;
  confirmedTextEventId: string;
  confirmedTextBody: string;
  peoplePolicy: Array<{
    id: string;
    isChild: boolean;
    isGuardian: boolean;
    childLaterUnlockedAt: string | null;
  }>;
  contributions: Array<{
    id: string;
    memoryEventId: string;
    authorPersonId: string;
    recordedByPersonId: string | null;
    recordedByNameSnapshot: string | null;
    recordingMode: string;
    rawText: string | null;
    transcript: string | null;
    editedText: string | null;
    audioAssetId: string | null;
    visibility: string;
    createdAt: string;
    updatedAt: string;
  }>;
  inboxItems: Array<{
    id: string;
    familyId: string;
    kind: string;
    status: string;
    rawText: string | null;
    draftTitle: string | null;
    draftOccurredAt: string | null;
    draftLocationText: string | null;
    participantPersonIds: string[];
    memoryEventId: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  inboxItemAssets: Array<{
    id: string;
    inboxItemId: string;
    assetId: string;
    familyId: string;
    createdAt: string;
  }>;
  // M3 durable：转录 / 事实 locator / 标签 / date_only 精度
  audioAssetId: string;
  transcriptId: string;
  editedTranscript: string;
  factStatement: string;
  factQuote: string;
  tags: string[];
  textEventDateOnly: string;
  publishedStoryId: string;
  publishedStoryTitle: string;
  dialogueQuestionId: string;
  dialogueReplyText: string;
  documentAssetId: string;
  documentSha256: string;
  importSessionId: string;
  portalId: string;
  portalSubmissionId: string;
  reviewPeriodId: string;
};

let expect_: Expectation;
let serverProcess: ReturnType<typeof spawn> | undefined;
let cookie = "";

async function freshModules() {
  vi.resetModules();
  return {
    db: await import("@/db"),
    setup: await import("@/lib/auth/setup"),
    family: await import("@/lib/family/service"),
    ingest: await import("@/lib/assets/ingest"),
    inbox: await import("@/lib/inbox/service"),
    memories: await import("@/lib/memories/service"),
    contributions: await import("@/lib/contributions/service"),
    exportSvc: await import("@/lib/export/service"),
    restoreSvc: await import("@/lib/restore/service"),
    schemaAuth: await import("@/db/schema/auth"),
    schemaFamily: await import("@/db/schema/family"),
    schemaContribution: await import("@/db/schema/contribution"),
    schemaInbox: await import("@/db/schema/inbox"),
  };
}

async function startServer() {
  const nextBin = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
  serverProcess = spawn(process.execPath, [nextBin, "start", "--port", PORT], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATA_DIR: dirB,
      BETTER_AUTH_URL: BASE,
      AUTH_SECRET: process.env.AUTH_SECRET,
      INITIAL_SETUP_TOKEN: "rt-token",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  serverProcess.stdout?.on("data", () => {});
  serverProcess.stderr?.on("data", () => {});
  // 等待就绪
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/login`);
      if (res.status === 200) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("server did not start within 90s（请先 npm run build）");
}

function stopServer() {
  return new Promise<void>((resolve) => {
    if (!serverProcess) return resolve();
    serverProcess.once("exit", () => resolve());
    serverProcess.kill();
    setTimeout(() => {
      serverProcess?.kill("SIGKILL");
      resolve();
    }, 10_000);
  });
}

beforeAll(async () => {
  // ---- Phase A：建档 + 导出（DATA_DIR=A）----
  process.env.DATA_DIR = dirA;
  {
    const m = await freshModules();
    const ok = await m.setup.performSetup({
      token: "rt-token",
      displayName: "爸爸",
      email: "a@example.com",
      password: "a-long-enough-password",
    });
    if (!ok.ok) throw new Error("setup A failed");
    const adminId = (
      await m.db.getDb().select({ id: m.schemaAuth.user.id }).from(m.schemaAuth.user)
    )[0].id;
    const on = await m.family.completeOnboarding(adminId, {
      familyName: "我们一家",
      timezone: "Asia/Shanghai",
      childDisplayName: "小满",
      childBirthDate: "2026-08-10",
      selfDisplayName: "爸爸",
      selfRelationToChild: "爸爸",
      selfIsGuardian: true,
    });
    if (!on.ok) throw new Error("onboarding A failed");
    const stored = await m.ingest.ingestImage({
      familyId: on.familyId,
      createdByUserId: adminId,
      filename: "出生照片.jpg",
      declaredMime: "image/jpeg",
      buffer: read("sample-exif.jpg"),
      clientLastModifiedMs: null,
    });
    if (stored.status !== "stored") throw new Error("ingest failed");
    const item = await m.inbox.createInboxItemForAsset(on.familyId, stored.asset);
    const entry = (await m.inbox.getInboxEntry(on.familyId, item.id))!;
    const ev = await m.memories.confirmInboxEntry(on.familyId, entry, {
      title: "出生后的第一天",
    });
    if (!ev.ok) throw new Error("confirm failed");

    const pendingTextBody =
      "这是一条超过一百个字符、仍然等待整理的文字记录，用来验证生产构建下的导出、销毁、恢复和再次导出都不会截断内容。".repeat(
        3,
      );
    const pendingTextItem = await m.inbox.createTextInboxItem(
      on.familyId,
      pendingTextBody,
    );
    await m.inbox.createInboxItemForAsset(on.familyId, stored.asset);
    await m.inbox.createInboxItemForAsset(on.familyId, {
      ...stored.asset,
      timeSource: "import_time",
    });
    const discarded = await m.inbox.createTextInboxItem(
      on.familyId,
      "这条记录已经被家人丢弃。",
    );
    await m.inbox.discardInboxItem(on.familyId, discarded.id);
    const confirmedTextBody =
      "小满今天第一次认真看了很久的树影。\n这句确认后的原始文字必须完整留下。";
    const confirmedText = await m.inbox.createTextInboxItem(
      on.familyId,
      confirmedTextBody,
    );
    const confirmedTextEntry = (await m.inbox.getInboxEntry(
      on.familyId,
      confirmedText.id,
    ))!;
    const textEvent = await m.memories.confirmInboxEntry(
      on.familyId,
      confirmedTextEntry,
      { title: "窗边的树影" },
    );
    if (!textEvent.ok) throw new Error("text confirm failed");

    const grandma = await m.family.addPerson(on.familyId, {
      displayName: "外婆",
      relationToChild: "外婆",
    });
    if (!grandma.ok) throw new Error("add grandma failed");
    const people = await m.family.listPeople(on.familyId);
    const dad = people.find((p) => p.displayName === "爸爸")!;
    const child = people.find((p) => p.isChild)!;
    const draftOccurredAt = new Date("2026-08-12T09:15:00.000Z");
    const draft = await m.inbox.updateInboxDraft(
      on.familyId,
      pendingTextItem.id,
      {
        title: "还没整理的树影",
        occurredAt: draftOccurredAt,
        locationText: "家里窗边",
        participantPersonIds: [dad.id, grandma.personId],
      },
    );
    if (!draft) throw new Error("inbox draft failed");
    const { eq } = await import("drizzle-orm");
    await m.db
      .getDb()
      .update(m.schemaFamily.family)
      .set({
        childLaterUnlockAge: 21,
        weekStartsOn: 0,
        reviewReminderWeekday: 6,
        reviewReminderLocalTime: "08:45",
        remindPendingInbox: false,
        remindPendingRequests: true,
        remindUpcomingCapsules: false,
      })
      .where(eq(m.schemaFamily.family.id, on.familyId));
    await m.db
      .getDb()
      .update(m.schemaFamily.person)
      .set({ childLaterUnlockedAt: new Date("2035-02-28T16:00:00.000Z") })
      .where(eq(m.schemaFamily.person.id, child.id));

    const childLaterContribution = await m.contributions.createContribution(
      on.familyId,
      {
        memoryEventId: ev.eventId,
        authorPersonId: grandma.personId,
        recordedByUserId: adminId,
        rawText: "外婆留给孩子长大后看的话。",
        visibility: "child_later",
      },
    );
    if (!childLaterContribution.ok) throw new Error("child later contribution failed");
    await m.db
      .getDb()
      .update(m.schemaContribution.contribution)
      .set({ transcript: "外婆留给孩子长大后看的话。" })
      .where(
        eq(
          m.schemaContribution.contribution.id,
          childLaterContribution.contributionId,
        ),
      );
    const privateContribution = await m.contributions.createContribution(
      on.familyId,
      {
        memoryEventId: ev.eventId,
        authorPersonId: dad.id,
        recordedByUserId: adminId,
        rawText: "爸爸的私人备忘。",
        visibility: "private",
      },
    );
    if (!privateContribution.ok) throw new Error("private contribution failed");

    // ---- M3 durable：edited transcript / confirmed fact locator / accepted tags ----
    const { createHash, randomUUID } = await import("node:crypto");
    const storageModule = await import("@/lib/assets/storage");
    const schemaMemoryTable = await import("@/db/schema/memory");
    const schemaTranscript = await import("@/db/schema/transcript");
    const schemaSuggestion = await import("@/db/schema/suggestion");

    const audioAssetId = randomUUID();
    const audioBytes = Buffer.from("roundtrip-audio-bytes-m3");
    const audioPut = storageModule
      .getAssetStorage()
      .putOriginal(on.familyId, audioAssetId, "wav", audioBytes, new Date());
    const schemaAssetTable = await import("@/db/schema/asset");
    m.db
      .getDb()
      .insert(schemaAssetTable.asset)
      .values({
        id: audioAssetId,
        familyId: on.familyId,
        type: "audio",
        originalFilename: "出生当天的录音.wav",
        mimeType: "audio/wav",
        bytes: audioBytes.byteLength,
        sha256: createHash("sha256").update(audioBytes).digest("hex"),
        storageKey: audioPut.storageKey,
        capturedAt: new Date("2026-08-10T01:30:00.000Z"),
        importedAt: new Date("2026-08-11T00:00:00.000Z"),
        timeSource: "file_metadata",
        width: null,
        height: null,
        durationMs: 61_000,
        createdByUserId: adminId,
        originalAssetId: null,
        derivativeType: null,
        createdAt: new Date("2026-08-11T00:00:00.000Z"),
      })
      .run();
    m.db
      .getDb()
      .insert(schemaMemoryTable.memoryEventAsset)
      .values({
        id: randomUUID(),
        memoryEventId: ev.eventId,
        assetId: audioAssetId,
        familyId: on.familyId,
        createdAt: new Date(),
      })
      .run();

    const transcriptId = randomUUID();
    m.db
      .getDb()
      .insert(schemaTranscript.assetTranscript)
      .values({
        id: transcriptId,
        familyId: on.familyId,
        assetId: audioAssetId,
        language: "zh",
        provider: "legacy-stt",
        model: "stt-v1",
        rawTranscript: "机器第一版：妈妈哼歌哄睡。",
        editedTranscript: "妈妈那天哼着歌哄她入睡，一直到天亮。",
        segmentsJson: JSON.stringify([
          { startSeconds: 31, endSeconds: 37, text: "妈妈那天哼着歌哄她入睡" },
        ]),
        status: "user_edited",
        sourceSha256: createHash("sha256").update(audioBytes).digest("hex"),
        createdAt: new Date("2026-08-11T00:00:00.000Z"),
        updatedAt: new Date("2026-08-11T00:00:00.000Z"),
      })
      .run();

    const confirmedFactId = randomUUID();
    const schemaContributionTable = await import("@/db/schema/contribution");
    m.db
      .getDb()
      .insert(schemaContributionTable.fact)
      .values({
        id: confirmedFactId,
        memoryEventId: ev.eventId,
        statement: "出生第一天妈妈整夜哼歌陪着她。",
        status: "user_confirmed",
        createdAt: new Date("2026-08-11T00:00:00.000Z"),
        updatedAt: new Date("2026-08-11T00:00:00.000Z"),
      })
      .run();
    m.db
      .getDb()
      .insert(schemaSuggestion.factSource)
      .values({
        id: randomUUID(),
        familyId: on.familyId,
        factId: confirmedFactId,
        sourceType: "transcript",
        sourceId: transcriptId,
        quote: "妈妈那天哼着歌哄她入睡",
        startMs: 31_000,
        endMs: 37_000,
        createdAt: new Date("2026-08-11T00:00:00.000Z"),
      })
      .run();

    for (const tag of ["出生", "医院"]) {
      m.db
        .getDb()
        .insert(schemaSuggestion.memoryEventTag)
        .values({
          id: randomUUID(),
          familyId: on.familyId,
          memoryEventId: ev.eventId,
          tag,
          createdAt: new Date("2026-08-11T00:00:00.000Z"),
        })
        .run();
    }

    // accepted occurredAt suggestion 的 durable 结果：事件时间 + 精度
    m.db
      .getDb()
      .update(schemaMemoryTable.memoryEvent)
      .set({
        occurredAt: new Date("2026-08-10T01:30:00.000Z"),
        occurredAtPrecision: "date_only",
      })
      .where(eq(schemaMemoryTable.memoryEvent.id, textEvent.eventId))
      .run();
    const textEventDateOnly = "2026年8月10日";

    // M4 durable：已发布的故事（含逐字引文段与来源）
    const storyService = await import("@/lib/stories/service");
    const storyCtx = {
      userId: adminId,
      userName: "爸爸",
      familyId: on.familyId,
      personId: dad.id,
      role: "admin" as const,
      accountEnabled: true as const,
      isGuardian: true,
      familyTimezone: "Asia/Shanghai",
      childLaterUnlockAge: 21,
    };
    const familyContribution = await m.contributions.createContribution(on.familyId, {
      memoryEventId: ev.eventId,
      authorPersonId: dad.id,
      recordedByUserId: adminId,
      rawText: "出生那天清晨，我第一次抱起她。",
      visibility: "family",
    });
    if (!familyContribution.ok) throw new Error("family contribution failed");
    const storyAnchorDate = new Date("2026-08-12T00:00:00.000Z");
    const storyPeriod = storyService.periodForKind("weekly", storyAnchorDate);
    const storyMaterial = storyService.collectStoryMaterial(on.familyId, storyPeriod);
    const storyTranscripts = storyService.collectTranscriptMaterial(on.familyId, storyPeriod);
    const storyPlans = storyService.planDeterministicDraft(storyMaterial, storyTranscripts);
    expect(storyPlans.length).toBeGreaterThanOrEqual(2);
    const storyCreated = storyService.createStoryDraft(
      storyCtx,
      { kind: "weekly", anchor: storyAnchorDate, title: "出生的那一周" },
      storyPlans,
    );
    if (!storyCreated.ok) throw new Error("story draft failed");
    const storyPublished = storyService.publishStory(storyCtx, storyCreated.storyId);
    if (!storyPublished.ok) throw new Error("story publish failed");

    // M5 durable：胶囊未来问题 + 开启后的回答
    const dialogueService = await import("@/lib/capsules/dialogue");
    const schemaCapsule = await import("@/db/schema/capsule");
    const { randomUUID: uuid5 } = await import("node:crypto");
    const dialogueCapsuleId = uuid5();
    m.db.getDb().insert(schemaCapsule.capsule).values({
      id: dialogueCapsuleId,
      familyId: on.familyId,
      title: "写给十六岁",
      unlockType: "date",
      unlockValue: "2026-08-15",
      status: "draft",
      createdAt: new Date(),
      updatedAt: new Date(),
    }).run();
    const addedQuestion = await dialogueService.addFutureQuestion(
      storyCtx,
      dialogueCapsuleId,
      "十六岁的你，最想对现在的我们说什么？",
    );
    if (!addedQuestion.ok) throw new Error("question failed");
    // 直接置为 opened（构造已解锁状态）
    m.db.getDb().update(schemaCapsule.capsule)
      .set({ status: "opened", sealedAt: new Date(), openedAt: new Date(), updatedAt: new Date() })
      .where(eq(schemaCapsule.capsule.id, dialogueCapsuleId))
      .run();
    const dialogueReply = await dialogueService.addCapsuleReply(
      storyCtx,
      addedQuestion.questionId!,
      { text: "谢谢你们留下这些。我现在很好。" },
    );
    if (!dialogueReply.ok) throw new Error("reply failed");

    // 1.1 durable graph: document + import + guest portal + weekly review.
    const documentAssetId = randomUUID();
    const documentBytes = Buffer.from("%PDF-1.4\nFamily archive document\n%%EOF\n");
    const documentPut = storageModule
      .getAssetStorage()
      .putOriginal(on.familyId, documentAssetId, "pdf", documentBytes, new Date());
    m.db.getDb().insert(schemaAssetTable.asset).values({
      id: documentAssetId,
      familyId: on.familyId,
      type: "document",
      originalFilename: "外婆的家书.pdf",
      mimeType: "application/pdf",
      bytes: documentBytes.byteLength,
      sha256: createHash("sha256").update(documentBytes).digest("hex"),
      storageKey: documentPut.storageKey,
      capturedAt: null,
      importedAt: new Date("2026-08-13T00:00:00.000Z"),
      timeSource: "import_time",
      createdByUserId: adminId,
      createdAt: new Date("2026-08-13T00:00:00.000Z"),
    }).run();
    const documentInbox = await m.inbox.createInboxItemForAsset(on.familyId, {
      id: documentAssetId,
      familyId: on.familyId,
      type: "document",
      originalFilename: "外婆的家书.pdf",
      mimeType: "application/pdf",
      bytes: documentBytes.byteLength,
      sha256: createHash("sha256").update(documentBytes).digest("hex"),
      storageKey: documentPut.storageKey,
      capturedAt: null,
      importedAt: new Date("2026-08-13T00:00:00.000Z"),
      timeSource: "import_time",
      width: null,
      height: null,
      durationMs: null,
      metadataJson: null,
      createdByUserId: adminId,
      originalAssetId: null,
      derivativeType: null,
      createdAt: new Date("2026-08-13T00:00:00.000Z"),
    });
    const schemaImport = await import("@/db/schema/import");
    const schemaOralHistory = await import("@/db/schema/oral-history");
    const schemaReview = await import("@/db/schema/review");
    const importSessionId = randomUUID();
    const importItemId = randomUUID();
    m.db.getDb().insert(schemaImport.importSession).values({
      id: importSessionId,
      familyId: on.familyId,
      source: "guest",
      status: "completed",
      totalCount: 1,
      completedCount: 1,
      failedCount: 0,
      defaultTitle: "满月照片收集",
      defaultOccurredAt: null,
      defaultLocationText: "外婆家",
      createdByUserId: null,
      createdAt: new Date("2026-08-13T00:00:00.000Z"),
      updatedAt: new Date("2026-08-13T00:05:00.000Z"),
    }).run();
    m.db.getDb().insert(schemaImport.importSessionDefaultParticipant).values({
      id: randomUUID(),
      familyId: on.familyId,
      importSessionId,
      personId: grandma.personId,
      createdAt: new Date("2026-08-13T00:00:00.000Z"),
    }).run();
    m.db.getDb().insert(schemaImport.importSessionItem).values({
      id: importItemId,
      familyId: on.familyId,
      importSessionId,
      captureId: randomUUID(),
      filename: "外婆的家书.pdf",
      declaredMime: "application/pdf",
      totalBytes: documentBytes.byteLength,
      lastModified: null,
      clientFingerprint: "roundtrip-document",
      uploadSessionId: null,
      assetId: documentAssetId,
      inboxItemId: documentInbox.id,
      status: "completed",
      errorCode: null,
      sortOrder: 0,
      createdAt: new Date("2026-08-13T00:00:00.000Z"),
      updatedAt: new Date("2026-08-13T00:05:00.000Z"),
    }).run();
    const portalId = randomUUID();
    m.db.getDb().insert(schemaOralHistory.contributionRequest).values({
      id: portalId,
      familyId: on.familyId,
      tokenHash: createHash("sha256").update("roundtrip-guest-token").digest("hex"),
      kind: "portal",
      title: "满月照片收集",
      recipientLabel: "外婆",
      recipientPersonId: grandma.personId,
      promptText: "请留下照片、声音或家书。",
      topicKey: null,
      status: "open",
      maxSubmissions: 20,
      maxFilesPerSubmission: 10,
      allowImages: true,
      allowAudio: true,
      allowVideo: true,
      allowDocuments: true,
      allowText: true,
      allowBrowserRecording: true,
      allowGuestName: true,
      allowReuse: true,
      expiresAt: new Date("2026-09-13T00:00:00.000Z"),
      createdByUserId: adminId,
      createdAt: new Date("2026-08-13T00:00:00.000Z"),
      updatedAt: new Date("2026-08-13T00:00:00.000Z"),
    }).run();
    const portalSubmissionId = randomUUID();
    m.db.getDb().insert(schemaOralHistory.contributionPortalSubmission).values({
      id: portalSubmissionId,
      familyId: on.familyId,
      requestId: portalId,
      importSessionId,
      guestDisplayName: "外婆（访客填写）",
      status: "completed",
      completedAt: new Date("2026-08-13T00:05:00.000Z"),
      createdAt: new Date("2026-08-13T00:00:00.000Z"),
    }).run();
    const requestId = randomUUID();
    m.db.getDb().insert(schemaOralHistory.contributionRequest).values({
      id: requestId,
      familyId: on.familyId,
      tokenHash: createHash("sha256").update("roundtrip-request-token").digest("hex"),
      kind: "request",
      title: null,
      recipientLabel: "爸爸",
      recipientPersonId: dad.id,
      promptText: "那天你最先注意到了什么？",
      status: "closed",
      expiresAt: new Date("2026-09-13T00:00:00.000Z"),
      closedAt: new Date("2026-08-14T00:00:00.000Z"),
      closedByUserId: adminId,
      createdByUserId: adminId,
      createdAt: new Date("2026-08-13T00:00:00.000Z"),
      updatedAt: new Date("2026-08-14T00:00:00.000Z"),
    }).run();
    m.db.getDb().insert(schemaOralHistory.contributionRequestSubmission).values({
      id: randomUUID(),
      familyId: on.familyId,
      requestId,
      inboxItemId: pendingTextItem.id,
      createdAt: new Date("2026-08-13T00:00:00.000Z"),
    }).run();
    const reviewPeriodId = randomUUID();
    m.db.getDb().insert(schemaReview.reviewPeriod).values({
      id: reviewPeriodId,
      familyId: on.familyId,
      periodStart: storyPeriod.start,
      periodEnd: storyPeriod.end,
      status: "completed",
      storyId: storyCreated.storyId,
      startedAt: new Date("2026-08-13T00:00:00.000Z"),
      completedAt: new Date("2026-08-13T01:00:00.000Z"),
      createdAt: new Date("2026-08-13T00:00:00.000Z"),
      updatedAt: new Date("2026-08-13T01:00:00.000Z"),
    }).run();
    m.db.getDb().insert(schemaReview.reviewPeriodEvent).values({
      id: randomUUID(),
      familyId: on.familyId,
      reviewPeriodId,
      memoryEventId: ev.eventId,
      selectedByUserId: adminId,
      createdAt: new Date("2026-08-13T00:30:00.000Z"),
    }).run();

    const peoplePolicy = (await m.family.listPeople(on.familyId))
      .map((person) => ({
        id: person.id,
        isChild: person.isChild,
        isGuardian: person.isGuardian,
        childLaterUnlockedAt:
          person.childLaterUnlockedAt?.toISOString() ?? null,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
    const contributions = (
      await m.db.getDb().select().from(m.schemaContribution.contribution)
    )
      .map((row) => ({
        id: row.id,
        memoryEventId: row.memoryEventId,
        authorPersonId: row.authorPersonId,
        recordedByPersonId: row.recordedByPersonId,
        recordedByNameSnapshot: row.recordedByNameSnapshot,
        recordingMode: row.recordingMode,
        rawText: row.rawText,
        transcript: row.transcript,
        editedText: row.editedText,
        audioAssetId: row.audioAssetId,
        visibility: row.visibility,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      }))
      .sort((a, b) => a.id.localeCompare(b.id));

    const inboxItems = (
      await m.db.getDb().select().from(m.schemaInbox.inboxItem)
    )
      .map((inboxRow) => ({
        id: inboxRow.id,
        familyId: inboxRow.familyId,
        kind: inboxRow.kind,
        status: inboxRow.status,
        rawText: inboxRow.rawText,
        draftTitle: inboxRow.draftTitle,
        draftOccurredAt: inboxRow.draftOccurredAt?.toISOString() ?? null,
        draftLocationText: inboxRow.draftLocationText,
        participantPersonIds: [] as string[],
        memoryEventId: inboxRow.memoryEventId,
        createdAt: inboxRow.createdAt.toISOString(),
        updatedAt: inboxRow.updatedAt.toISOString(),
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
    const inboxParticipants = await m.db
      .getDb()
      .select()
      .from(m.schemaInbox.inboxItemParticipant);
    for (const inboxRow of inboxItems) {
      inboxRow.participantPersonIds = inboxParticipants
        .filter((link) => link.inboxItemId === inboxRow.id)
        .map((link) => link.personId);
    }
    const inboxItemAssets = (
      await m.db.getDb().select().from(m.schemaInbox.inboxItemAsset)
    )
      .map((link) => ({
        id: link.id,
        inboxItemId: link.inboxItemId,
        assetId: link.assetId,
        familyId: link.familyId,
        createdAt: link.createdAt.toISOString(),
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
    expect(pendingTextBody.length).toBeGreaterThan(100);
    expect(new Set(inboxItems.map((inboxRow) => inboxRow.status))).toEqual(
      new Set(["new", "needs_review", "confirmed", "discarded"]),
    );
    const zip = await m.exportSvc.buildFamilyExport(on.familyId);
    expect_ = {
      zipPath: zip.filePath,
      familyId: on.familyId,
      familyUnlockAge: 21,
      eventTitle: "出生后的第一天",
      eventDate: "2026年8月10日 09:30",
      ageLabel: "出生当天",
      assetId: stored.asset.id,
      assetSha256: stored.asset.sha256,
      photoEventId: ev.eventId,
      confirmedTextEventId: textEvent.eventId,
      confirmedTextBody,
      peoplePolicy,
      contributions,
      inboxItems,
      inboxItemAssets,
      // M3 durable
      audioAssetId,
      transcriptId,
      editedTranscript: "妈妈那天哼着歌哄她入睡，一直到天亮。",
      factStatement: "出生第一天妈妈整夜哼歌陪着她。",
      factQuote: "妈妈那天哼着歌哄她入睡",
      tags: ["出生", "医院"],
      textEventDateOnly,
      // M4 durable
      publishedStoryId: storyCreated.storyId,
      publishedStoryTitle: "出生的那一周",
      dialogueQuestionId: addedQuestion.questionId!,
      dialogueReplyText: "谢谢你们留下这些。我现在很好。",
      documentAssetId,
      documentSha256: createHash("sha256").update(documentBytes).digest("hex"),
      importSessionId,
      portalId,
      portalSubmissionId,
      reviewPeriodId,
    };
    m.db.closeDatabase();
  }

  // ---- 灾难：把备份转移到安全位置，然后销毁 A ----
  const safeZip = path.join(tmpdir(), `ftc-rt-survivor-${Date.now()}.zip`);
  const { copyFileSync } = await import("node:fs");
  copyFileSync(expect_.zipPath, safeZip);
  expect_.zipPath = safeZip;
  rmSync(dirA, { recursive: true, force: true });
  expect(() => readFileSync(dirA)).toThrow(); // A 确已不存在

  // ---- Phase B：干净实例 → setup → restore → 绑定 ----
  process.env.DATA_DIR = dirB;
  {
    const m = await freshModules();
    const ok = await m.setup.performSetup({
      token: "rt-token",
      displayName: "新管理员",
      email: "b@example.com",
      password: "b-long-enough-password",
    });
    if (!ok.ok) throw new Error("setup B failed");
    const adminId = (
      await m.db.getDb().select({ id: m.schemaAuth.user.id }).from(m.schemaAuth.user)
    )[0].id;
    const report = await m.restoreSvc.restoreFromZipFile(expect_.zipPath, adminId);
    expect(report.events).toBe(2);
    expect(report.contributions).toBe(expect_.contributions.length);
    expect(report.inboxItems).toBe(expect_.inboxItems.length);
    expect(report.inboxItemAssets).toBe(expect_.inboxItemAssets.length);
    expect(report.importSessions).toBe(1);
    expect(report.importSessionItems).toBe(1);
    expect(report.contributionRequests).toBe(2);
    expect(report.portalSubmissions).toBe(1);
    expect(report.reviewPeriods).toBe(1);

    const restoredInboxItems = (
      await m.db.getDb().select().from(m.schemaInbox.inboxItem)
    )
      .map((inboxRow) => ({
        id: inboxRow.id,
        familyId: inboxRow.familyId,
        kind: inboxRow.kind,
        status: inboxRow.status,
        rawText: inboxRow.rawText,
        draftTitle: inboxRow.draftTitle,
        draftOccurredAt: inboxRow.draftOccurredAt?.toISOString() ?? null,
        draftLocationText: inboxRow.draftLocationText,
        participantPersonIds: [] as string[],
        memoryEventId: inboxRow.memoryEventId,
        createdAt: inboxRow.createdAt.toISOString(),
        updatedAt: inboxRow.updatedAt.toISOString(),
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
    const restoredInboxParticipants = await m.db
      .getDb()
      .select()
      .from(m.schemaInbox.inboxItemParticipant);
    for (const inboxRow of restoredInboxItems) {
      inboxRow.participantPersonIds = restoredInboxParticipants
        .filter((link) => link.inboxItemId === inboxRow.id)
        .map((link) => link.personId);
    }
    const restoredInboxItemAssets = (
      await m.db.getDb().select().from(m.schemaInbox.inboxItemAsset)
    )
      .map((link) => ({
        id: link.id,
        inboxItemId: link.inboxItemId,
        assetId: link.assetId,
        familyId: link.familyId,
        createdAt: link.createdAt.toISOString(),
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
    expect(restoredInboxItems).toEqual(expect_.inboxItems);
    expect(restoredInboxItemAssets).toEqual(expect_.inboxItemAssets);
    const restoredFamily = await m.family.getFamily(expect_.familyId);
    expect(restoredFamily?.childLaterUnlockAge).toBe(expect_.familyUnlockAge);
    expect(restoredFamily).toMatchObject({
      weekStartsOn: 0,
      reviewReminderWeekday: 6,
      reviewReminderLocalTime: "08:45",
      remindPendingInbox: false,
      remindPendingRequests: true,
      remindUpcomingCapsules: false,
    });
    const schemaAsset = await import("@/db/schema/asset");
    const schemaImport = await import("@/db/schema/import");
    const schemaOralHistory = await import("@/db/schema/oral-history");
    const schemaReview = await import("@/db/schema/review");
    const { eq } = await import("drizzle-orm");
    const restoredDocument = m.db.getDb().select().from(schemaAsset.asset)
      .where(eq(schemaAsset.asset.id, expect_.documentAssetId)).get()!;
    expect(restoredDocument.type).toBe("document");
    expect(restoredDocument.sha256).toBe(expect_.documentSha256);
    const restoredImport = m.db.getDb().select().from(schemaImport.importSession)
      .where(eq(schemaImport.importSession.id, expect_.importSessionId)).get()!;
    expect(restoredImport).toMatchObject({ source: "guest", status: "completed", createdByUserId: adminId });
    const restoredImportItems = m.db.getDb().select().from(schemaImport.importSessionItem).all();
    expect(restoredImportItems).toEqual(expect.arrayContaining([
      expect.objectContaining({ assetId: expect_.documentAssetId, uploadSessionId: null, status: "completed" }),
    ]));
    const restoredPortals = m.db.getDb().select().from(schemaOralHistory.contributionRequest).all();
    expect(restoredPortals).toHaveLength(2);
    expect(restoredPortals.every((portal) =>
      portal.status === "closed" &&
      portal.tokenHash === null &&
      portal.createdByUserId === adminId &&
      portal.closedAt !== null
    )).toBe(true);
    expect(m.db.getDb().select().from(schemaOralHistory.contributionPortalSubmission)
      .where(eq(schemaOralHistory.contributionPortalSubmission.id, expect_.portalSubmissionId)).get())
      .toMatchObject({ requestId: expect_.portalId, importSessionId: expect_.importSessionId });
    expect(m.db.getDb().select().from(schemaReview.reviewPeriod)
      .where(eq(schemaReview.reviewPeriod.id, expect_.reviewPeriodId)).get())
      .toMatchObject({ storyId: expect_.publishedStoryId, status: "completed" });
    expect(m.db.getDb().select().from(schemaReview.reviewPeriodEvent).all())
      .toEqual(expect.arrayContaining([expect.objectContaining({ selectedByUserId: null })]));
    const restoredPeoplePolicy = (await m.family.listPeople(expect_.familyId))
      .map((person) => ({
        id: person.id,
        isChild: person.isChild,
        isGuardian: person.isGuardian,
        childLaterUnlockedAt:
          person.childLaterUnlockedAt?.toISOString() ?? null,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
    expect(restoredPeoplePolicy).toEqual(expect_.peoplePolicy);
    const restoredContributionDbRows = await m.db
      .getDb()
      .select()
      .from(m.schemaContribution.contribution);
    const restoredContributions = restoredContributionDbRows
      .map((row) => ({
        id: row.id,
        memoryEventId: row.memoryEventId,
        authorPersonId: row.authorPersonId,
        recordedByPersonId: row.recordedByPersonId,
        recordedByNameSnapshot: row.recordedByNameSnapshot,
        recordingMode: row.recordingMode,
        rawText: row.rawText,
        transcript: row.transcript,
        editedText: row.editedText,
        audioAssetId: row.audioAssetId,
        visibility: row.visibility,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
    expect(restoredContributions).toEqual(expect_.contributions);
    expect(
      restoredContributionDbRows.every((row) => row.recordedByUserId === null),
    ).toBe(true);
    expect(
      await m.contributions.listContributions(
        expect_.familyId,
        expect_.confirmedTextEventId,
      ),
    ).toHaveLength(0);

    // 绑定到「爸爸」
    const people = await m.family.listPeople(expect_.familyId);
    const dad = people.find((p) => p.relationToChild === "爸爸")!;
    const bind = await m.family.bindRestoredFamily(adminId, dad.id);
    expect(bind.ok).toBe(true);
    m.db.closeDatabase();
  }

  // ---- 启动应用（真实服务器，指向 B）----
  await startServer();
}, 180_000);

afterAll(async () => {
  await stopServer();
  // Windows 下句柄释放可能滞后：重试删除，失败不阻断结果
  for (let i = 0; i < 5; i++) {
    try {
      rmSync(dirB, { recursive: true, force: true });
      rmSync(expect_?.zipPath ?? "", { force: true });
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
});

describe("RH-005 灾难恢复 roundtrip", () => {
  it("服务器存活且登录页可用", async () => {
    const res = await fetch(`${BASE}/login`);
    expect(res.status).toBe(200);
  });

  it("按恢复设计登录（新管理员账号，认证不来自备份）", async () => {
    const res = await fetch(`${BASE}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: BASE },
      body: JSON.stringify({ email: "b@example.com", password: "b-long-enough-password" }),
    });
    expect(res.status).toBe(200);
    const cookies = res.headers.getSetCookie?.() ?? [];
    const session = cookies.find((c) => c.includes("better-auth.session_token"));
    expect(session, JSON.stringify(cookies)).toBeTruthy();
    cookie = session!.split(";")[0];
  });

  it("时间轴与事件详情展示恢复的事件：标题 / 真实日期 / 年龄一致", async () => {
    const res = await fetch(`${BASE}/timeline`, { headers: { cookie } });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(expect_.eventTitle);
    expect(html).toContain("2026年8月10日");
    expect(html).toContain(expect_.ageLabel);

    // 图片事件详情页含完整时刻
    const detail = await fetch(`${BASE}/memories/${expect_.photoEventId}`, {
      headers: { cookie },
    });
    expect(detail.status).toBe(200);
    const detailHtml = await detail.text();
    expect(detailHtml).toContain(expect_.eventDate); // 2026年8月10日 09:30
    expect(detailHtml).toContain(expect_.ageLabel);
    expect(detailHtml).toContain(expect_.factStatement);
    expect(detailHtml).not.toContain(expect_.editedTranscript);
    expect(detailHtml).not.toContain(expect_.factQuote);

    // M3 durable：重档案资料默认不读取；显式打开档案后，修订转录、locator 与标签全部回来。
    const archiveDetail = await fetch(
      `${BASE}/memories/${expect_.photoEventId}?mode=archive`,
      { headers: { cookie } },
    );
    expect(archiveDetail.status).toBe(200);
    const archiveHtml = await archiveDetail.text();
    expect(archiveHtml).toContain(expect_.editedTranscript);
    expect(archiveHtml).toContain(expect_.factQuote); // fact_source.locator quote
    expect(archiveHtml).toContain("00:31–00:37"); // segment 时间段
    for (const tag of expect_.tags) {
      expect(archiveHtml).toContain(tag);
    }

    // 已确认文字以无作者的原始来源记录显示，正文不截断，也不伪造 Contribution。
    const textDetail = await fetch(
      `${BASE}/memories/${expect_.confirmedTextEventId}`,
      { headers: { cookie } },
    );
    expect(textDetail.status).toBe(200);
    const textDetailHtml = await textDetail.text();
    for (const line of expect_.confirmedTextBody.split("\n")) {
      expect(textDetailHtml).toContain(line);
    }
    expect(textDetailHtml).toContain("这段记忆");
    // accepted occurredAt suggestion 的 durable 结果：date_only 事件不显示时分
    expect(textDetailHtml).toContain(expect_.textEventDateOnly);
    expect(textDetailHtml).not.toMatch(/2026年8月10日\s*\d{1,2}:\d{2}/);
  });

  it("恢复的媒体可访问：字节 SHA-256 与源一致；Range 206；未授权 401", async () => {
    const res = await fetch(`${BASE}/api/media/${expect_.assetId}`, { headers: { cookie } });
    expect(res.status).toBe(200);
    const buf = Buffer.from(await res.arrayBuffer());
    expect(createHash("sha256").update(buf).digest("hex")).toBe(expect_.assetSha256);

    const range = await fetch(`${BASE}/api/media/${expect_.assetId}`, {
      headers: { cookie, Range: "bytes=0-9" },
    });
    expect(range.status).toBe(206);
    expect(range.headers.get("content-range")).toMatch(/^bytes 0-9\//);

    const anon = await fetch(`${BASE}/api/media/${expect_.assetId}`);
    expect(anon.status).toBe(401);
  });

  it("导出 B 并独立校验（verify:export 全绿，哈希与源一致）", async () => {
    const res = await fetch(`${BASE}/api/export`, { headers: { cookie } });
    expect(res.status).toBe(200);
    const zipBuffer = Buffer.from(await res.arrayBuffer());

    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(zipBuffer);
    const manifest = JSON.parse(
      await zip.file("family-time-capsule-export/manifest.json")!.async("string"),
    );
    expect(manifest.familyId).toBe(expect_.familyId);
    // 自洽校验：manifest.fileCount = 原件数 + 当前 portable metadata 文件集。
    // ZIP 另含 5 个空 .keep 占位（stories/ + originals/*），不计入 fileCount。
    const zipFileNames = Object.entries(zip.files)
      .filter(([name, entry]) => name.startsWith("family-time-capsule-export/") && !entry.dir)
      .map(([name]) => name);
    const keepCount = zipFileNames.filter((n) => n.endsWith("/.keep")).length;
    expect(zipFileNames.length - keepCount).toBe(manifest.fileCount);
    expect(manifest.fileCount).toBe(manifest.assets.length + 34);

    // M4 durable：已发布故事 + 段落 + 来源（含逐字引文）往返
    const restoredStories = JSON.parse(
      await zip.file("family-time-capsule-export/stories.json")!.async("string"),
    );
    const publishedStory = restoredStories.find(
      (st: { id: string }) => st.id === expect_.publishedStoryId,
    );
    expect(publishedStory).toMatchObject({
      title: expect_.publishedStoryTitle,
      status: "published",
    });
    const restoredStoryParagraphs = JSON.parse(
      await zip.file("family-time-capsule-export/story-paragraphs.json")!.async("string"),
    );
    const quoteParagraph = restoredStoryParagraphs.find(
      (pp: { kind: string; text: string }) =>
        pp.kind === "quote" && pp.text.includes("我第一次抱起她"),
    );
    expect(quoteParagraph).toBeTruthy();
    const restoredStorySources = JSON.parse(
      await zip.file("family-time-capsule-export/story-sources.json")!.async("string"),
    );
    expect(
      restoredStorySources.some(
        (ss: { paragraphId: string; quote: string | null }) =>
          ss.paragraphId === quoteParagraph.id && ss.quote === quoteParagraph.text,
      ),
    ).toBe(true);

    // M5 durable：胶囊问题与回答往返
    const restoredQuestions = JSON.parse(
      await zip.file("family-time-capsule-export/capsule-questions.json")!.async("string"),
    );
    expect(
      restoredQuestions.some(
        (q: { id: string }) => q.id === expect_.dialogueQuestionId,
      ),
    ).toBe(true);
    const restoredReplies = JSON.parse(
      await zip.file("family-time-capsule-export/capsule-replies.json")!.async("string"),
    );
    expect(
      restoredReplies.some((r: { text: string | null }) => r.text === expect_.dialogueReplyText),
    ).toBe(true);

    // M3 durable：edited transcript / fact locator / tags / date_only 精度全部往返
    const transcripts = JSON.parse(
      await zip.file("family-time-capsule-export/transcripts.json")!.async("string"),
    );
    const restoredTranscript = transcripts.find(
      (t: { id: string }) => t.id === expect_.transcriptId,
    );
    expect(restoredTranscript.editedTranscript).toBe(expect_.editedTranscript);
    expect(restoredTranscript.rawTranscript).toBe("机器第一版：妈妈哼歌哄睡。");

    const restoredFactSources = JSON.parse(
      await zip.file("family-time-capsule-export/fact-sources.json")!.async("string"),
    );
    const locator = restoredFactSources.find(
      (s: { quote?: string }) => s.quote === expect_.factQuote,
    );
    expect(locator).toMatchObject({
      sourceType: "transcript",
      sourceId: expect_.transcriptId,
      startMs: 31_000,
      endMs: 37_000,
    });

    const restoredMemories = JSON.parse(
      await zip.file("family-time-capsule-export/memories.json")!.async("string"),
    );
    const photoEvent = restoredMemories.find(
      (m2: { id: string }) => m2.id === expect_.photoEventId,
    );
    expect([...photoEvent.tags].sort()).toEqual([...expect_.tags].sort());
    const textEventExport = restoredMemories.find(
      (m2: { id: string }) => m2.id === expect_.confirmedTextEventId,
    );
    expect(textEventExport.occurredAtPrecision).toBe("date_only");
    const shas = new Set(manifest.assets.map((a: { sha256: string }) => a.sha256));
    expect(shas.has(expect_.assetSha256)).toBe(true);
    const inboxItems = JSON.parse(
      await zip
        .file("family-time-capsule-export/inbox-items.json")!
        .async("string"),
    ).sort((a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id));
    const inboxItemAssets = JSON.parse(
      await zip
        .file("family-time-capsule-export/inbox-item-assets.json")!
        .async("string"),
    ).sort((a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id));
    expect(inboxItems).toEqual(expect_.inboxItems);
    expect(inboxItemAssets).toEqual(expect_.inboxItemAssets);
    const importSessions = JSON.parse(
      await zip.file("family-time-capsule-export/import-sessions.json")!.async("string"),
    );
    const importItems = JSON.parse(
      await zip.file("family-time-capsule-export/import-session-items.json")!.async("string"),
    );
    const portals = JSON.parse(
      await zip.file("family-time-capsule-export/contribution-requests.json")!.async("string"),
    );
    const portalSubmissions = JSON.parse(
      await zip.file("family-time-capsule-export/contribution-portal-submissions.json")!.async("string"),
    );
    const reviewPeriods = JSON.parse(
      await zip.file("family-time-capsule-export/review-periods.json")!.async("string"),
    );
    const reviewEvents = JSON.parse(
      await zip.file("family-time-capsule-export/review-period-events.json")!.async("string"),
    );
    expect(importSessions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: expect_.importSessionId, source: "guest", status: "completed" }),
    ]));
    expect(importItems).toEqual(expect.arrayContaining([
      expect.objectContaining({ assetId: expect_.documentAssetId, inboxItemId: expect.any(String) }),
    ]));
    expect(portals).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: expect_.portalId, kind: "portal" }),
    ]));
    expect(portals.every((portal: Record<string, unknown>) =>
      !("token" in portal) && !("tokenHash" in portal) && !("createdByUserId" in portal)
    )).toBe(true);
    expect(portalSubmissions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: expect_.portalSubmissionId, importSessionId: expect_.importSessionId }),
    ]));
    expect(reviewPeriods).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: expect_.reviewPeriodId, storyId: expect_.publishedStoryId }),
    ]));
    expect(reviewEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ reviewPeriodId: expect_.reviewPeriodId, memoryEventId: expect_.photoEventId }),
    ]));
    expect(manifest.assets.find(
      (entry: { assetId: string; sha256: string }) => entry.assetId === expect_.documentAssetId,
    )?.sha256).toBe(expect_.documentSha256);
    const exportedFamily = JSON.parse(
      await zip
        .file("family-time-capsule-export/family.json")!
        .async("string"),
    );
    const exportedPeople = JSON.parse(
      await zip
        .file("family-time-capsule-export/people.json")!
        .async("string"),
    );
    const exportedContributions = JSON.parse(
      await zip
        .file("family-time-capsule-export/contributions.json")!
        .async("string"),
    );
    expect(exportedFamily.childLaterUnlockAge).toBe(expect_.familyUnlockAge);
    expect(
      exportedPeople
        .map(
          (person: {
            id: string;
            isChild: boolean;
            isGuardian: boolean;
            childLaterUnlockedAt: string | null;
          }) => ({
            id: person.id,
            isChild: person.isChild,
            isGuardian: person.isGuardian,
            childLaterUnlockedAt: person.childLaterUnlockedAt,
          }),
        )
        .sort((a: { id: string }, b: { id: string }) =>
          a.id.localeCompare(b.id),
        ),
    ).toEqual(expect_.peoplePolicy);
    expect(
      exportedContributions
        .map(
          (row: (typeof expect_.contributions)[number]) => ({
            id: row.id,
            memoryEventId: row.memoryEventId,
            authorPersonId: row.authorPersonId,
            recordedByPersonId: row.recordedByPersonId,
            recordedByNameSnapshot: row.recordedByNameSnapshot,
            recordingMode: row.recordingMode,
            rawText: row.rawText,
            transcript: row.transcript,
            editedText: row.editedText,
            audioAssetId: row.audioAssetId,
            visibility: row.visibility,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
          }),
        )
        .sort((a: { id: string }, b: { id: string }) =>
          a.id.localeCompare(b.id),
        ),
    ).toEqual(expect_.contributions);

    // verify:export CLI 独立复核
    const tmpZip = path.join(dirB, "b-export.zip");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(tmpZip, zipBuffer);
    const verify = spawnSync(process.execPath, ["scripts/verify-export.mjs", tmpZip], {
      encoding: "utf8",
    });
    expect(verify.status, verify.stdout + verify.stderr).toBe(0);
  });

  it("登录限流持久化到 SQLite（v0.1.3）：窗口内超额 429，计数落库", async () => {
    // 说明：better-auth 限流挂在 HTTP 请求层（内部 api 不经过），本测试是真实
    // 生产服务器上的行为验证。此前“按恢复设计登录”测试已消耗 1 次（共 3 次/10s）。
    const attempt = async (password: string) => {
      const res = await fetch(`${BASE}/api/auth/sign-in/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: BASE },
        body: JSON.stringify({ email: "b@example.com", password }),
      });
      return res.status;
    };
    // 第 2、3 次：密码错误 → 401（不是 429，说明尚未触顶）
    expect(await attempt("wrong-1")).toBe(401);
    expect(await attempt("wrong-2")).toBe(401);
    // 第 4 次：即使密码正确也被限流 → 429
    expect(await attempt("b-long-enough-password")).toBe(429);

    // 计数确实落在 SQLite（另一连接只读 WAL 快照）
    const Database = (await import("better-sqlite3")).default;
    const db = new Database(path.join(dirB, "db", "capsule.sqlite"), { readonly: true });
    const rows = db
      .prepare(`SELECT key, count FROM rate_limit WHERE key LIKE '%sign-in%'`)
      .all() as Array<{ key: string; count: number }>;
    db.close();
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0].count).toBeGreaterThanOrEqual(3);
  });
});
