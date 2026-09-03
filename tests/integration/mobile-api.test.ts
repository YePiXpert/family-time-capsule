import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const dataDir = mkdtempSync(path.join(tmpdir(), "ftc-mobile-api-"));
process.env.DATA_DIR = dataDir;
process.env.INITIAL_SETUP_TOKEN = "mobile-api-setup-token";
process.env.AUTH_SECRET = "mobile-api-test-secret-with-sufficient-entropy";
process.env.AUTH_SIGNIN_RATE_LIMIT_MAX = "100";

afterAll(async () => {
  const { closeDatabase } = await import("@/db");
  closeDatabase();
  rmSync(dataDir, { recursive: true, force: true });
});

const { getDb } = await import("@/db");
const { user } = await import("@/db/schema/auth");
const { performSetup } = await import("@/lib/auth/setup");
const { getAuth } = await import("@/lib/auth/auth");
const { completeOnboarding } = await import("@/lib/family/service");
const { createTextInboxItem, getInboxEntry, listInbox } = await import(
  "@/lib/inbox/service"
);
const { confirmInboxEntry } = await import("@/lib/memories/service");
const { GET: syncGet } = await import("@/app/api/mobile/v1/sync/route");
const { POST: textCapturePost } = await import(
  "@/app/api/mobile/v1/captures/text/route"
);
const { POST: imageUploadPost } = await import("@/app/api/upload/image/route");
const { POST: mediaUploadPost } = await import("@/app/api/upload/media/route");

const email = "mobile@example.com";
const password = "a-long-mobile-test-password";
let bearerToken = "";

function mobileUploadRequest(input: {
  endpoint: "image" | "media";
  token?: string;
  captureId?: string;
  filename: string;
  mimeType: string;
  bytes: Buffer;
}): Request {
  const form = new FormData();
  form.append(
    "file",
    new File([Uint8Array.from(input.bytes)], input.filename, {
      type: input.mimeType,
    }),
  );
  form.append("filename", input.filename);
  form.append("lastModified", "1788422400000");
  if (input.captureId) form.append("captureId", input.captureId);
  return new Request(`http://localhost/api/upload/${input.endpoint}`, {
    method: "POST",
    headers: {
      ...(input.token ? { authorization: `Bearer ${input.token}` } : {}),
      // Native URLSession/OkHttp compute the complete multipart length before
      // sending. Route-level tests supply the same finite transport contract.
      "content-length": String(input.bytes.byteLength + 4096),
    },
    body: form,
  });
}

describe("native mobile API", () => {
  it("boots a family archive and issues a bearer-compatible session", async () => {
    expect(
      await performSetup({
        token: "mobile-api-setup-token",
        displayName: "妈妈",
        email,
        password,
      }),
    ).toEqual({ ok: true });
    const admin = (await getDb().select({ id: user.id }).from(user))[0];
    expect(admin).toBeDefined();
    expect(
      await completeOnboarding(admin!.id, {
        familyName: "小满家",
        timezone: "Asia/Shanghai",
        childDisplayName: "小满",
        childBirthDate: "2024-02-03",
        selfDisplayName: "妈妈",
        selfRelationToChild: "妈妈",
        selfIsGuardian: true,
      }),
    ).toMatchObject({ ok: true });

    const signedIn = await getAuth().api.signInEmail({
      body: { email, password },
    });
    bearerToken = signedIn.token;
    expect(bearerToken.length).toBeGreaterThan(20);
  });

  it("returns a minimized timeline snapshot through Authorization bearer", async () => {
    const admin = (await getDb().select().from(user))[0]!;
    const item = await createTextInboxItem(
      admin.familyId!,
      "第一次在原生客户端看到时间轴。",
    );
    const entry = await getInboxEntry(admin.familyId!, item.id);
    expect(entry).toBeDefined();
    expect(await confirmInboxEntry(admin.familyId!, entry!)).toMatchObject({
      ok: true,
    });

    const response = await syncGet(
      new Request("http://localhost/api/mobile/v1/sync?limit=50", {
        headers: { authorization: `Bearer ${bearerToken}` },
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = (await response.json()) as {
      apiVersion: number;
      family: { name: string };
      viewer: { canCapture: boolean };
      people: unknown[];
      events: Array<{ title: string; occurredAt: string }>;
    };
    expect(body.apiVersion).toBe(1);
    expect(body.family.name).toBe("小满家");
    expect(body.viewer.canCapture).toBe(true);
    expect(body.people).toHaveLength(2);
    expect(body.events[0]?.title).toBe("第一次在原生客户端看到时间轴。");
    expect(new Date(body.events[0]!.occurredAt).toString()).not.toBe("Invalid Date");
  });

  it("queues offline text idempotently and rejects an id reused for other content", async () => {
    const id = "8f181908-885d-4c65-b4cb-999ac07bd24c";
    const request = (text: string) =>
      new Request("http://localhost/api/mobile/v1/captures/text", {
        method: "POST",
        headers: {
          authorization: `Bearer ${bearerToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ id, text }),
      });

    expect((await textCapturePost(request("离线写下的一句话"))).status).toBe(201);
    expect((await textCapturePost(request("离线写下的一句话"))).status).toBe(200);
    expect((await textCapturePost(request("同 ID 的其他内容"))).status).toBe(409);
    const inbox = await listInbox((await getDb().select().from(user))[0]!.familyId!);
    expect(inbox.filter((entry) => entry.item.id === id)).toHaveLength(1);
  });

  it("accepts native bearer multipart image and video uploads exactly once", async () => {
    const familyId = (await getDb().select().from(user))[0]!.familyId!;
    const image = readFileSync(path.join(process.cwd(), "tests/fixtures/sample.jpg"));
    const video = readFileSync(path.join(process.cwd(), "tests/fixtures/sample.mp4"));
    const imageCaptureId = "6fc7bc1f-0235-4b58-bcd7-a0c4dc65d501";
    const videoCaptureId = "0208c79d-8959-4a9e-ad97-3b4c67359618";

    const firstImage = await imageUploadPost(
      mobileUploadRequest({
        endpoint: "image",
        token: bearerToken,
        captureId: imageCaptureId,
        filename: "native-offline-photo.jpg",
        mimeType: "image/jpeg",
        bytes: image,
      }),
    );
    expect(firstImage.status).toBe(201);
    await expect(firstImage.json()).resolves.toMatchObject({ status: "stored" });

    const repeatedImage = await imageUploadPost(
      mobileUploadRequest({
        endpoint: "image",
        token: bearerToken,
        captureId: imageCaptureId,
        filename: "native-offline-photo-retry.jpg",
        mimeType: "image/jpeg",
        bytes: image,
      }),
    );
    expect(repeatedImage.status).toBe(200);
    await expect(repeatedImage.json()).resolves.toMatchObject({ status: "duplicate" });

    const firstVideo = await mediaUploadPost(
      mobileUploadRequest({
        endpoint: "media",
        token: bearerToken,
        captureId: videoCaptureId,
        filename: "native-offline-video.mp4",
        mimeType: "video/mp4",
        bytes: video,
      }),
    );
    expect(firstVideo.status).toBe(201);
    await expect(firstVideo.json()).resolves.toMatchObject({
      status: "stored",
      type: "video",
    });

    const inbox = await listInbox(familyId);
    expect(inbox.map((entry) => entry.item.id)).toEqual(
      expect.arrayContaining([imageCaptureId, videoCaptureId]),
    );
    expect(
      inbox.flatMap((entry) => entry.assets).filter((asset) => asset.sha256),
    ).toHaveLength(2);
    expect(
      inbox.flatMap((entry) => entry.assets).map((asset) => asset.originalFilename),
    ).toEqual(
      expect.arrayContaining([
        "native-offline-photo.jpg",
        "native-offline-video.mp4",
      ]),
    );

    const conflictingImage = readFileSync(
      path.join(process.cwd(), "tests/fixtures/sample-exif.jpg"),
    );
    const conflict = await imageUploadPost(
      mobileUploadRequest({
        endpoint: "image",
        token: bearerToken,
        captureId: imageCaptureId,
        filename: "different-content.jpg",
        mimeType: "image/jpeg",
        bytes: conflictingImage,
      }),
    );
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toEqual({
      error: "capture_id_conflict",
    });
  });

  it("recovers an inbox link when upload storage committed before the response", async () => {
    const admin = (await getDb().select().from(user))[0]!;
    const bytes = readFileSync(
      path.join(process.cwd(), "tests/fixtures/sample-exif-offset.jpg"),
    );
    const { ingestImage } = await import("@/lib/assets/ingest");
    const orphan = await ingestImage({
      familyId: admin.familyId!,
      createdByUserId: admin.id,
      filename: "interrupted-before-inbox.jpg",
      declaredMime: "image/jpeg",
      buffer: bytes,
      clientLastModifiedMs: 1_788_422_400_000,
    });
    expect(orphan.status).toBe("stored");

    const captureId = "d22b221a-875a-4639-9e6e-06764053d54d";
    const retry = await imageUploadPost(
      mobileUploadRequest({
        endpoint: "image",
        token: bearerToken,
        captureId,
        filename: "interrupted-before-inbox.jpg",
        mimeType: "image/jpeg",
        bytes,
      }),
    );
    expect(retry.status).toBe(200);
    await expect(retry.json()).resolves.toMatchObject({ status: "duplicate" });
    const recovered = await getInboxEntry(admin.familyId!, captureId);
    expect(recovered?.assets).toHaveLength(1);
    expect(recovered?.assets[0]?.originalFilename).toBe(
      "interrupted-before-inbox.jpg",
    );
  });

  it("rejects native multipart uploads without a bearer session", async () => {
    const image = readFileSync(path.join(process.cwd(), "tests/fixtures/sample.jpg"));
    const response = await imageUploadPost(
      mobileUploadRequest({
        endpoint: "image",
        filename: "unauthorized.jpg",
        mimeType: "image/jpeg",
        bytes: image,
      }),
    );
    expect(response.status).toBe(401);
  });

  it("does not expose family sync without a session", async () => {
    const response = await syncGet(
      new Request("http://localhost/api/mobile/v1/sync"),
    );
    expect(response.status).toBe(401);
  });
});
