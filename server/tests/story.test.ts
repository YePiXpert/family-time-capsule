import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { inputSchema, parseResult } from "../src/contracts.ts";
const input = inputSchema.parse({
  requestId: randomUUID(),
  writingMode: "story",
  photos: [],
  context: JSON.stringify({
    year: "2025",
    records: [
      {
        id: "1",
        date: "2025-05-01",
        title: "翻书",
        text: "她翻了一页书。",
        first: false,
        quote: false,
        photos: true,
      },
    ],
  }),
});
test("年度故事接受可追溯段落，拒绝捏造来源和过长正文", () => {
  const result = {
    title: "她翻了一页书",
    paragraphs: [{ text: "五月，她翻了一页书。", records: ["1"] }],
  };
  assert.deepEqual(parseResult(result, input), result);
  for (const bad of [
    { ...result, paragraphs: [{ text: "她翻书。", records: ["unknown"] }] },
    { ...result, paragraphs: [{ text: "她翻书。", records: [] }] },
    { ...result, paragraphs: [{ text: "字".repeat(1001), records: ["1"] }] },
    { ...result, paragraphs: [{ text: "温馨的五月", records: ["1"] }] },
    { ...result, photos: ["image"] },
  ])
    assert.throws(() => parseResult(bad, input));
});
