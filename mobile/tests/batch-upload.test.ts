import { afterEach, describe, expect, it, vi } from "vitest";
import type { MediaCapturePayload } from "../src/types";
import { uploadMediaCapture } from "../src/storage/files";

const mocks = vi.hoisted(() => ({ opened: vi.fn(), closed: vi.fn() }));
vi.mock("expo-file-system", () => ({
  Directory: class { uri = "file:///private/captures"; },
  File: class {
    exists = true;
    size = 4;
    open() {
      mocks.opened();
      return { offset: 0, readBytes: (length: number) => new Uint8Array(length), close: mocks.closed };
    }
  },
  FileMode: { ReadOnly: 0 },
  Paths: { document: "file:///private/" },
}));
vi.mock("expo-media-library", () => ({ Asset: class {} }));

const credentials = { serverUrl: "https://example.test", token: "session" };
const payload: MediaCapturePayload = {
  localUri: "file:///private/captures/letter.pdf", fileName: "letter.pdf",
  mimeType: "application/pdf", lastModified: null, mediaType: "document", source: "files",
  importSessionId: "10000000-0000-4000-8000-000000000001", uploadId: "legacy-transfer", uploadOffset: 2,
};
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
function requests(responses: Response[]) {
  const fetcher = vi.fn();
  responses.forEach((response) => fetcher.mockResolvedValueOnce(response));
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("native batch upload", () => {
  it("creates its stable batch and adopts a legacy transfer before resuming at the server offset", async () => {
    const fetcher = requests([
      json({ id: payload.importSessionId }),
      json({ uploadId: "legacy-transfer", uploadOffset: 2, status: "uploading" }),
      new Response(null, { status: 204, headers: { "upload-offset": "4" } }),
      json({ inboxItemId: "capture" }),
    ]);
    expect(await uploadMediaCapture(credentials, "capture", payload)).toBe("capture");
    expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toEqual({ clientSessionId: payload.importSessionId, source: "native" });
    expect(JSON.parse(fetcher.mock.calls[1]![1].body)).toMatchObject({ captureId: "capture", importSessionId: payload.importSessionId });
    expect(fetcher.mock.calls[2]![1].headers["upload-offset"]).toBe("2");
    expect(mocks.closed).toHaveBeenCalledOnce();
  });

  it("does not send bytes when the existing capture is already completed", async () => {
    const fetcher = requests([json({ id: payload.importSessionId }), json({ uploadId: "legacy-transfer", status: "completed", uploadOffset: 4, inboxItemId: "capture" })]);
    expect(await uploadMediaCapture(credentials, "capture", payload)).toBe("capture");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(mocks.opened).not.toHaveBeenCalled();
  });

  it("keeps the local original untouched if batch authorization is refused", async () => {
    const fetcher = requests([json({ error: "forbidden" }, 403)]);
    await expect(uploadMediaCapture(credentials, "capture", payload)).rejects.toMatchObject({ status: 403 });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(mocks.opened).not.toHaveBeenCalled();
  });

  it("recovers an expired ungrouped transfer when its first HEAD returns 410", async () => {
    const fetcher = requests([
      new Response(null, { status: 410 }), json({ uploadOffset: 0 }),
      new Response(null, { status: 204, headers: { "upload-offset": "4" } }), json({ inboxItemId: "capture" }),
    ]);
    expect(await uploadMediaCapture(credentials, "capture", { ...payload, importSessionId: undefined })).toBe("capture");
    expect(fetcher.mock.calls[1]![0]).toContain("/legacy-transfer/retry");
    expect(fetcher.mock.calls[2]![1].headers["upload-offset"]).toBe("0");
  });
});
