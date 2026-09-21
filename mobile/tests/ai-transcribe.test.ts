import { beforeEach, expect, it, vi } from "vitest";
import { transcribeOnServer } from "../src/ai/transcribe";
import { TRANSCRIBE_MAX_BYTES } from "../src/local/transcribe";

const fake = vi.hoisted(() => ({
  bytes: new Uint8Array([1, 2, 3]),
  size: 3,
  read: vi.fn(),
  upload: vi.fn(),
}));
vi.mock("expo-file-system", () => ({
  File: class {
    constructor(public uri: string) {}
    get size() { return fake.size; }
    async arrayBuffer() { fake.read(); return fake.bytes.buffer; }
  },
}));
vi.mock("expo-crypto", () => ({ randomUUID: () => "request-id" }));
vi.mock("../src/ai/client", () => ({
  AIError: class extends Error {
    constructor(public code: string, message: string) { super(message); }
  },
  upload: fake.upload,
}));
beforeEach(() => {
  fake.bytes = new Uint8Array([1, 2, 3]); fake.size = 3;
  fake.read.mockReset(); fake.upload.mockReset(); fake.upload.mockResolvedValue({ text: "她笑了" });
});
it("reads m4a and sends seconds rounded up with a request id", async () => {
  const signal = new AbortController().signal;
  await expect(transcribeOnServer({ uri: "file:///audio.m4a", seconds: 1.2 }, signal)).resolves.toBe("她笑了");
  expect(fake.upload).toHaveBeenCalledWith("/ai/transcribe", fake.bytes, "audio/mp4", { "X-Request-Id": "request-id", "X-Audio-Seconds": "2" }, signal);
});
it.each(["bytes", "seconds"])("rejects excessive %s before reading or uploading", async (kind) => {
  if (kind === "bytes") fake.size = TRANSCRIBE_MAX_BYTES + 1;
  await expect(transcribeOnServer({ uri: "file:///audio.m4a", seconds: kind === "seconds" ? 180.1 : 1 })).rejects.toMatchObject({ code: "AUDIO_TOO_LONG" });
  expect(fake.read).not.toHaveBeenCalled(); expect(fake.upload).not.toHaveBeenCalled();
});
it("rechecks the actual bytes if the file grew after stat", async () => {
  fake.bytes = new Uint8Array(TRANSCRIBE_MAX_BYTES + 1);
  await expect(transcribeOnServer({ uri: "file:///audio.m4a" })).rejects.toMatchObject({ code: "AUDIO_TOO_LONG" });
  expect(fake.upload).not.toHaveBeenCalled();
});
it.each([{ text: 42 }, {}, null])("rejects invalid text response %j", async (result) => {
  fake.upload.mockResolvedValue(result);
  await expect(transcribeOnServer({ uri: "file:///audio.m4a" })).rejects.toMatchObject({ code: "INVALID_RESULT", message: "转写结果无效，录音已保存。" });
});
it("passes empty transcription through and omits unknown duration", async () => {
  fake.upload.mockResolvedValue({ text: "" });
  await expect(transcribeOnServer({ uri: "file:///audio.m4a" })).resolves.toBe("");
  expect(fake.upload.mock.calls[0]?.[3]).toEqual({ "X-Request-Id": "request-id" });
});
it("canceled jobs do not read or upload", async () => {
  const controller = new AbortController(); controller.abort();
  await expect(transcribeOnServer({ uri: "file:///audio.m4a" }, controller.signal)).rejects.toMatchObject({ code: "CANCELED" });
  expect(fake.read).not.toHaveBeenCalled(); expect(fake.upload).not.toHaveBeenCalled();
});
