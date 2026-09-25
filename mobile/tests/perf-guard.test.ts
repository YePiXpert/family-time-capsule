// 性能护栏：只卡复杂度，不卡毫秒（CI 机器快慢不一）。基准数字见 tests/perf（npx vitest run -c vitest.perf.config.mts）。
import { expect, it } from "vitest";
import {
  BACKUP_MAGIC_V3,
  decodeLibraryV2,
  decodeMetaV2,
  encodeEntities,
  encodeMetaV2,
} from "../src/local/backup-format";
import { contentHashOf, hashOf } from "../src/local/hash";
import { ENTITY_KINDS, freezeLibrary } from "../src/local/model";
import { makeLibrary } from "./perf/fixtures";

it("清单解码对素材数是线性的：五千段、八千份素材一秒内解完（原先逐个全表比对要十几秒）", () => {
  const state = makeLibrary(5000);
  freezeLibrary(state);
  const entities = encodeEntities(state);
  const count = ENTITY_KINDS.reduce((n, kind) => n + Object.keys(state[kind]).length, 0);
  const meta = decodeMetaV2(encodeMetaV2(state, entities.length, count, { magic: BACKUP_MAGIC_V3 }).subarray(12));
  const started = performance.now();
  const decoded = decodeLibraryV2(meta, entities);
  expect(performance.now() - started).toBeLessThan(1000);
  expect(Object.keys(decoded.media).length).toBe(Object.keys(state.media).length);
});
it("内容哈希按冻结的对象记住；没冻结的对象每次重算，改了就是新哈希", () => {
  const frozen = Object.freeze({ id: "a", text: "一", updatedAt: "2026-09-25T00:00:00Z" });
  expect(contentHashOf(frozen)).toBe(hashOf({ id: "a", text: "一" }));
  expect(contentHashOf(frozen)).toBe(contentHashOf({ ...frozen }));
  const open = { id: "b", text: "二" };
  const first = contentHashOf(open);
  open.text = "三";
  expect(contentHashOf(open)).not.toBe(first);
  expect(contentHashOf(open)).toBe(hashOf({ id: "b", text: "三" }));
});
