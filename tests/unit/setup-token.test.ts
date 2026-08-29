import { describe, expect, it } from "vitest";
import { safeTokenEqual } from "@/lib/auth/token";

describe("safeTokenEqual", () => {
  it("相同输入返回 true", () => {
    expect(safeTokenEqual("setup-token-123", "setup-token-123")).toBe(true);
  });

  it("不同输入返回 false", () => {
    expect(safeTokenEqual("setup-token-123", "setup-token-124")).toBe(false);
  });

  it("长度不同的输入不抛错且返回 false", () => {
    expect(safeTokenEqual("short", "a-much-longer-token-value")).toBe(false);
  });

  it("空字符串与任意值比较不抛错", () => {
    expect(safeTokenEqual("", "anything")).toBe(false);
    expect(safeTokenEqual("", "")).toBe(true);
  });
});
