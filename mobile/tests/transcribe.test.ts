import { describe, expect, it } from "vitest";
import { appendTranscript, chooseRoute, serverPrecheck, transcribeHint, TRANSCRIBE_MAX_BYTES } from "../src/local/transcribe";

describe("transcription route", () => {
  it("prefers on-device without needing login or consent", () => {
    for (const signedIn of [true, false]) for (const consent of [true, false])
      expect(chooseRoute({ availability: "on-device", signedIn, consent })).toBe("on-device");
  });
  it("requires login, then separate transcription consent", () => {
    expect(chooseRoute({ availability: "unavailable", signedIn: false, consent: true })).toBe("none");
    expect(chooseRoute({ availability: "unavailable", signedIn: true, consent: false })).toBe("server-consent");
    expect(chooseRoute({ availability: "unavailable", signedIn: true, consent: true })).toBe("server");
  });
});
it.each([
  ["", "她笑了", "她笑了"],
  ["  \n", " 她笑了 \n", "她笑了"],
  ["原文\n \n", " 她笑了 \n", "原文\n\n她笑了"],
  ["  原文", "她笑了", "  原文\n\n她笑了"],
  ["原文 \n", " \n", "原文 \n"],
])("appends to %j without replacing existing words", (text, transcript, expected) => {
  expect(appendTranscript(text, transcript)).toBe(expected);
});
it("accepts exact server limits and rejects one byte or fraction of a second over", () => {
  expect(serverPrecheck({ bytes: TRANSCRIBE_MAX_BYTES, seconds: 180 })).toBeNull();
  expect(serverPrecheck({})).toBeNull();
  expect(serverPrecheck({ bytes: TRANSCRIBE_MAX_BYTES + 1 })).toBe("这段太长了，转文字最多 3 分钟；录音已保存。");
  expect(serverPrecheck({ seconds: 180.01 })).not.toBeNull();
});
it("explains login on both platforms and Chinese dictation on iPhone", () => {
  expect(transcribeHint("none", "android")).toBe("这台手机没有中文本机识别；加入家庭后可以经家里的服务转文字。");
  expect(transcribeHint("none", "ios")).toBe(transcribeHint("none", "android") + "iPhone 在系统设置里开启中文听写后可本机识别。");
  expect(transcribeHint("on-device", "ios")).toBe("");
});
