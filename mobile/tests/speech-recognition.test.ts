import { beforeEach, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  present: true,
  native: {
    availabilityAsync: vi.fn(),
    transcribeFileAsync: vi.fn(),
    cancelAsync: vi.fn(),
  },
}));
vi.mock("expo-modules-core", () => ({ requireOptionalNativeModule: () => fake.present ? fake.native : null }));
beforeEach(() => {
  vi.resetModules(); fake.present = true;
  fake.native.availabilityAsync.mockReset().mockResolvedValue("on-device");
  fake.native.transcribeFileAsync.mockReset().mockResolvedValue("她笑了");
  fake.native.cancelAsync.mockReset().mockResolvedValue(undefined);
});
it("missing native module reports unavailable", async () => {
  fake.present = false;
  const speech = await import("../modules/speech-recognition/src");
  await expect(speech.speechAvailability()).resolves.toBe("unavailable");
  await expect(speech.transcribeFile("file:///audio.m4a", {})).rejects.toMatchObject({ code: "UNAVAILABLE" });
});
it("uses Chinese by default and returns native text", async () => {
  const speech = await import("../modules/speech-recognition/src");
  await expect(speech.speechAvailability()).resolves.toBe("on-device");
  await expect(speech.transcribeFile("file:///audio.m4a", {})).resolves.toBe("她笑了");
  expect(fake.native.availabilityAsync).toHaveBeenCalledWith("zh-CN");
  expect(fake.native.transcribeFileAsync).toHaveBeenCalledWith("file:///audio.m4a", "zh-CN");
});
it.each(["UNAVAILABLE", "DENIED", "CANCELED", "FAILED", "OTHER"])("maps native %s errors", async (code) => {
  fake.native.transcribeFileAsync.mockRejectedValue({ code });
  const speech = await import("../modules/speech-recognition/src");
  await expect(speech.transcribeFile("file:///audio.m4a", {})).rejects.toMatchObject({ code: code === "OTHER" ? "FAILED" : code });
});
it("abort settles immediately, cancels native recognition and ignores late text", async () => {
  let resolve!: (text: string) => void;
  fake.native.transcribeFileAsync.mockImplementation(() => new Promise<string>((done) => { resolve = done; }));
  const speech = await import("../modules/speech-recognition/src");
  const controller = new AbortController();
  const job = speech.transcribeFile("file:///audio.m4a", { signal: controller.signal });
  controller.abort(); resolve("迟到");
  await expect(job).rejects.toMatchObject({ code: "CANCELED" });
  expect(fake.native.cancelAsync).toHaveBeenCalledOnce();
});
it("a completed job removes the abort listener", async () => {
  const speech = await import("../modules/speech-recognition/src");
  const controller = new AbortController();
  await speech.transcribeFile("file:///audio.m4a", { signal: controller.signal });
  controller.abort();
  expect(fake.native.cancelAsync).not.toHaveBeenCalled();
});
it("pre-aborted requests never start recognition", async () => {
  const speech = await import("../modules/speech-recognition/src");
  const controller = new AbortController(); controller.abort();
  await expect(speech.transcribeFile("file:///audio.m4a", { signal: controller.signal })).rejects.toMatchObject({ code: "CANCELED" });
  expect(fake.native.transcribeFileAsync).not.toHaveBeenCalled();
});
