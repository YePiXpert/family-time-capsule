import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi, afterEach } from "vitest";
import { classifyImportedFile } from "@/mobile/src/storage/import-policy";
import { validateUploadPrefix } from "@/lib/assets/validation";
import { uploadDraftOriginal } from "@/lib/drafts/browser-upload";

afterEach(() => vi.unstubAllGlobals());
describe("video provider metadata", () => {
  it.each([ ["sample.mov", "", "video/quicktime"], ["sample.mp4", "application/octet-stream", "video/mp4"], ["sample.mov", "video/mov", "video/quicktime"] ])("imports %s with provider MIME %s without relaxing content validation", (name, mime, expected) => {
    const bytes = readFileSync(`tests/fixtures/${name}`);
    const type = classifyImportedFile(name, mime);
    expect(type).toEqual({ mimeType: expected, mediaType: "video" });
    expect(validateUploadPrefix(bytes.subarray(0, 65536), type!.mimeType, bytes.length).ok).toBe(true);
    expect(validateUploadPrefix(Buffer.from("<html>not a video</html>"), type!.mimeType, 24).ok).toBe(false);
  });
  it("uploads a browser MOV with an empty MIME, preserving its real bytes and publication receipt", async () => {
    const bytes = readFileSync("tests/fixtures/sample.mov");
    const received: Uint8Array[] = [];
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/uploads") {
        expect(JSON.parse(String(init?.body))).toMatchObject({ declaredMime: "video/quicktime", filename: "baby.mov", draftId: "draft" });
        return Response.json({ uploadId: "upload", uploadOffset: 0, status: "uploading" });
      }
      if (init?.method === "PATCH") {
        const chunk = new Uint8Array(await (init.body as Blob).arrayBuffer()); received.push(chunk);
        return new Response(null, { status: 204, headers: { "upload-offset": String(chunk.length) } });
      }
      return Response.json({ status: "stored", assetId: "original-video", inboxItemId: null });
    });
    vi.stubGlobal("fetch", fetcher);
    const file = new File([bytes], "baby.mov", { type: "" });
    expect(await uploadDraftOriginal(file, "capture", "draft")).toMatchObject({ assetId: "original-video" });
    expect(Buffer.concat(received)).toEqual(bytes);
  });
});

describe("browser upload recovery", () => {
  afterEach(() => vi.useRealTimers());
  it("confirms a lost first-chunk response and continues the remaining bytes automatically", async () => {
    const bytes = Buffer.alloc(8 * 1024 * 1024 + 321, 7);
    const received: Buffer[] = [];
    const progress: { phase: string; uploadedBytes: number }[] = [];
    let confirmed = 0, lost = false;
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/uploads") return Response.json({ uploadId: "same-upload", uploadOffset: 0, status: "uploading" });
      if (init?.method === "HEAD") return new Response(null, { headers: { "upload-offset": String(confirmed) } });
      if (init?.method === "PATCH") {
        expect(Number((init.headers as Record<string, string>)["upload-offset"])).toBe(confirmed);
        const chunk = Buffer.from(await (init.body as Blob).arrayBuffer());
        received.push(chunk); confirmed += chunk.length;
        if (!lost) { lost = true; throw new TypeError("Failed to fetch"); }
        return new Response(null, { status: 204, headers: { "upload-offset": String(confirmed) } });
      }
      return Response.json({ status: "stored", assetId: "same-original" });
    });
    vi.stubGlobal("fetch", fetcher);
    const upload = uploadDraftOriginal(new File([bytes], "old-film.mpg"), "capture", "draft", undefined, value => progress.push(value));
    expect(await upload).toMatchObject({ assetId: "same-original" });
    expect(createHash("sha256").update(Buffer.concat(received)).digest("hex")).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(received).toHaveLength(2);
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "HEAD")).toHaveLength(1);
    expect(progress).toContainEqual(expect.objectContaining({ phase: "retrying", uploadedBytes: 0 }));
    expect(progress.at(-1)).toMatchObject({ phase: "confirming", uploadedBytes: bytes.length });
  });

  it("uses the same JSON receipt if a proxy omits upload-offset headers", async () => {
    const bytes = Buffer.from("preserved bytes");
    let received = 0, declarations = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/uploads") {
        declarations++;
        expect(JSON.parse(String(init?.body))).toMatchObject({ captureId: "capture", draftId: "draft" });
        return Response.json({ uploadId: "same-upload", uploadOffset: received, status: "uploading" });
      }
      if (init?.method === "PATCH") { received += (init.body as Blob).size; return new Response(null, { status: 204 }); }
      if (init?.method === "HEAD") return new Response(null, { status: 200 });
      return Response.json({ assetId: "original" });
    }));
    expect(await uploadDraftOriginal(new File([bytes], "old-film.mpg"), "capture", "draft")).toMatchObject({ assetId: "original" });
    expect(received).toBe(bytes.length);
    expect(declarations).toBe(2);
  });

  it("stops bounded retries without claiming unconfirmed bytes were uploaded", async () => {
    vi.useFakeTimers();
    const progress: number[] = [];
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/uploads") return Response.json({ uploadId: "upload", uploadOffset: 0, status: "uploading" });
      if (init?.method === "HEAD") return new Response(null, { headers: { "upload-offset": "0" } });
      throw new TypeError("Failed to fetch");
    });
    vi.stubGlobal("fetch", fetcher);
    const result = expect(uploadDraftOriginal(new File(["bytes"], "old-film.mpg"), "capture", "draft", undefined, p => progress.push(p.uploadedBytes))).rejects.toThrow("自动续传暂未成功");
    await vi.runAllTimersAsync(); await result;
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(4);
    expect(progress.every(bytes => bytes === 0)).toBe(true);
  });

  it.each([401, 403, 413, 415])("does not retry a permanent HTTP %s failure", async status => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ error: "denied" }, { status }));
    vi.stubGlobal("fetch", fetcher);
    await expect(uploadDraftOriginal(new File(["bytes"], "old-film.mpg"), "capture", "draft")).rejects.toThrow("本机原件仍保留");
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("retries a lost completion receipt without retransmitting the original", async () => {
    vi.useFakeTimers();
    let completes = 0;
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/uploads") return Response.json({ uploadId: "upload", uploadOffset: 5, status: "uploading" });
      if (url.endsWith("/complete")) { if (++completes === 1) throw new TypeError("Failed to fetch"); return Response.json({ assetId: "original" }); }
      throw new Error(`Unexpected ${init?.method}`);
    });
    vi.stubGlobal("fetch", fetcher);
    const upload = uploadDraftOriginal(new File(["bytes"], "old-film.mpg"), "capture", "draft");
    await vi.runAllTimersAsync();
    expect(await upload).toMatchObject({ assetId: "original" });
    expect(completes).toBe(2);
  });

  it("honors a changed draft before attempting recovery", async () => {
    let changed = false;
    const fetcher = vi.fn(async (url: string) => {
      if (url === "/api/uploads") return Response.json({ uploadId: "upload", uploadOffset: 0, status: "uploading" });
      changed = true; throw new TypeError("Failed to fetch");
    });
    vi.stubGlobal("fetch", fetcher);
    await expect(uploadDraftOriginal(new File(["bytes"], "old-film.mpg"), "capture", "draft", () => { if (changed) throw new Error("草稿已修改，上传已暂停"); })).rejects.toThrow("草稿已修改");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
