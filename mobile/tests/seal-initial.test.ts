import { expect, it } from "vitest";
import { sealInitial } from "../src/local/model";

it.each([
  ["李清洛", "李"],
  ["𠮷安", "𠮷"],
  ["  ", "桉"],
  ["", "桉"],
  ["  𠮷安  ", "𠮷"],
])("名字 %j 的印章保留完整首字 %s", (name, initial) => {
  expect(sealInitial(name)).toBe(initial);
});
