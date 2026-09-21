import { expect, it } from "vitest";
import { dateTimeLabel } from "../src/local/dates";
const today = new Date(2026, 8, 21);
it("省略同年的年份", () => {
  expect(dateTimeLabel(new Date(2026, 8, 21, 14, 22).toISOString(), today)).toBe("9月21日 14:22");
});
it("跨年显示年份", () => {
  expect(dateTimeLabel(new Date(2025, 11, 3, 14, 22).toISOString(), today)).toBe("2025年12月3日 14:22");
});
it("分钟补零，小时不补零", () => {
  expect(dateTimeLabel(new Date(2026, 8, 21, 4, 2).toISOString(), today)).toBe("9月21日 4:02");
});
