import { describe, expect, it } from "vitest";
import { pickAnother } from "../src/local/shuffle";

describe("pickAnother", () => {
  it("returns nothing for an empty library", () => {
    expect(pickAnother([])).toBeUndefined();
  });
  it("returns the only record even when it is the current one", () => {
    expect(pickAnother(["a"], "a")).toBe("a");
  });
  it("never repeats the current record when there is a choice", () => {
    for (const r of [0, 0.3, 0.6, 0.999, 1])
      expect(pickAnother(["a", "b", "c"], "b", () => r)).not.toBe("b");
    expect(pickAnother(["a", "b"], undefined, () => 0.7)).toBe("b");
  });
});
