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
