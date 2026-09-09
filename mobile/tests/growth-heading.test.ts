import { expect, it } from "vitest";
import { growthHeading } from "../src/design/growth";
const child = { id: "child", displayName: "小美", isChild: true, birthDate: "2026-08-31" };
it("uses calendar months and the family's date, including month-end births", () => {
  expect(growthHeading([child], new Date("2026-09-29T16:30:00Z"), "Asia/Shanghai").age).toBe("1 个月");
  expect(growthHeading([child], new Date("2026-09-29T16:30:00Z"), "America/New_York").age).toBe("出生 29 天");
});
it("never invents a birth date, future age or an ambiguous child", () => {
  expect(growthHeading([{ ...child, birthDate: null }], new Date(), "UTC").age).toBeNull();
  expect(growthHeading([child], new Date("2026-08-30"), "UTC").age).toBeNull();
  expect(growthHeading([{ ...child, displayName: "甲" }, { ...child, id: "other", displayName: "乙" }], new Date(), "UTC").childId).toBeNull();
});
