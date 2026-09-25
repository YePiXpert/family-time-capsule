import { describe, expect, it } from "vitest";
import { isOutOfSpace, messageOf } from "../src/local/errors";

describe("messageOf", () => {
  it("各平台的「存储写满」都说成本机空间不足", () => {
    for (const text of [
      "ENOSPC: no space left on device, write",
      "java.io.IOException: No space left on device",
      "SQLITE_FULL: database or disk is full",
      "The file couldn’t be saved because there isn’t enough space.",
      "There is not enough space on the disk.",
    ])
      expect(messageOf(new Error(text))).toBe("本机空间不足，请释放一些空间后重试。当前输入仍保留。");
    expect(isOutOfSpace(Object.assign(new Error("write failed"), { code: "ENOSPC" }))).toBe(true);
  });
  it("自己写的中文说明原样保留，不被换成笼统的一句", () => {
    const own = "本机空间不足：写这一卷需要约 120 MB 的临时空间，请先清理一些空间。";
    expect(isOutOfSpace(new Error(own))).toBe(false);
    expect(messageOf(new Error(own))).toBe(own);
  });
  it("认不得的英文错误不外露", () => {
    expect(messageOf(new Error("Network request failed"))).toBe("操作未完成，现有资料和输入已保留，请重试。");
  });
});
