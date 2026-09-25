/**
 * 同步落在本机的状态文件：合并之基（base.json：merged + known）每轮整份写一次、读一次。
 * 量它的体积与 JSON 编解码；以及一次 change 都要写的根（rootOf，含永不清理的墓碑）。
 */
import { describe, it } from "vitest";
import { freezeLibrary, rootOf } from "../../src/local/model";
import { emptyBase, mergeLibraries } from "../../src/sync/merge";
import { bench, reportTo } from "./harness";
import { makeLibrary, remoteOf, sizes } from "./fixtures";

reportTo(__filename);
const G = "sync-state";

describe("sync state files", () => {
  for (const n of sizes()) {
    it(`base.json @ ${n}`, async () => {
      const local = makeLibrary(n);
      freezeLibrary(local);
      // 两轮同步后的基：第一轮认得本机，第二轮并进一份改了 1% 的远端。
      const first = mergeLibraries(local, [], emptyBase()).base;
      const remote = remoteOf(local, 0.01, 7);
      const second = mergeLibraries(local, [{ deviceId: "b", deviceName: "b", createdAt: "2030-01-01T00:00:00.000Z", library: remote }], first, "2030-01-02T00:00:00.000Z").base;
      let json = JSON.stringify(second);
      const knownKeys = Object.keys(second.known).length;
      await bench(G, "writeBase: JSON.stringify(base)", n, () => { json = JSON.stringify(second); }, {
        note: `base.json ${(json.length / 1048576).toFixed(2)} MB, ${knownKeys} known keys`,
      });
      await bench(G, "readBase: JSON.parse(base)", n, () => JSON.parse(json));
      const root = JSON.stringify(rootOf(local));
      await bench(G, "rootOf JSON (written on every change)", n, () => JSON.stringify(rootOf(local)), {
        note: `${(root.length / 1024).toFixed(1)} KB, ${Object.keys(local.tombstones ?? {}).length} tombstones`,
      });
    });
  }
});
