/**
 * 备份格式（v2/v3 meta + 实体 NDJSON，v1 只读）、清单写出时的读回核对、开放归档规划与 ZIP 写出。
 */
import { describe, it } from "vitest";
import {
  backupBlobs,
  decodeLibraryV2,
  decodeManifest,
  decodeMetaV2,
  encodeEntities,
  encodeHeader,
  encodeMetaV2,
  BACKUP_MAGIC_V3,
} from "../../src/local/backup-format";
import { planArchive } from "../../src/local/archive-layout";
import { crc32, ZipWriter } from "../../src/local/zip";
import { ENTITY_KINDS, freezeLibrary } from "../../src/local/model";
import { bench, reportTo } from "./harness";
import { busiestYear, makeLibrary, sizes } from "./fixtures";

reportTo(__filename);
const G = "backup";
/** 超过这么多素材就跳过 O(B*M) 的几项（50k 时一次要跑二十来分钟），在报告里按平方外推。 */
const QUADRATIC_CAP = Number(process.env.PERF_QUADRATIC_CAP ?? 20000);

describe("backup", () => {
  for (const n of sizes()) {
    it(`backup format @ ${n}`, async () => {
      const state = makeLibrary(n);
      freezeLibrary(state);
      const media = Object.keys(state.media).length;
      const count = ENTITY_KINDS.reduce((k, kind) => k + Object.keys(state[kind]).length, 0);
      let entities = encodeEntities(state);
      const note = `${count} entities, ${media} media, NDJSON ${(entities.length / 1048576).toFixed(1)} MB`;
      await bench(G, "encodeEntities (NDJSON, sorted keys)", n, () => { entities = encodeEntities(state); }, { note });
      let head = encodeMetaV2(state, entities.length, count, { magic: BACKUP_MAGIC_V3 });
      await bench(G, "encodeMetaV2 (includes full validateLibrary)", n, () => {
        head = encodeMetaV2(state, entities.length, count, { magic: BACKUP_MAGIC_V3 });
      }, { note: `meta ${(head.length / 1024).toFixed(0)} KB` });
      const metaJson = head.subarray(12);
      const meta = decodeMetaV2(metaJson);
      await bench(G, "decodeMetaV2", n, () => decodeMetaV2(metaJson));
      // decodeLibraryV2 被调用的地方：写清单后的读回核对、pushManifest 里再解一次、每份远端清单、恢复前检查、恢复。
      const heavy = media > QUADRATIC_CAP;
      if (!heavy)
        await bench(G, "decodeLibraryV2 (parse NDJSON + validate + blob cross-check O(B*M))", n, () => decodeLibraryV2(meta, entities), {
          note: `${meta.blobs.length} blobs x ${media} media`,
          ...(n >= 10000 ? { runs: 1, warmup: 0 } : {}),
        });
      // 同一段数据换成一次建表的做法，看剩下多少。
      await bench(G, "reference: decodeLibraryV2 minus blob cross-check (parse + normalize + validate)", n, () => {
        const text = new TextDecoder("utf-8", { fatal: true }).decode(entities);
        const lines = text.replace(/\n$/, "").split("\n");
        for (const line of lines) JSON.parse(line);
      });
      await bench(G, "backupBlobs (dedupe by sha256)", n, () => backupBlobs(state));

      // 清单写出（createBackup / createSyncManifest）的纯计算部分：编码 + 读回核对。
      if (!heavy)
        await bench(G, "manifest write CPU: encodeEntities + encodeMetaV2 + decodeMetaV2 + decodeLibraryV2", n, () => {
          const e = encodeEntities(state);
          const h = encodeMetaV2(state, e.length, count, { magic: BACKUP_MAGIC_V3 });
          decodeLibraryV2(decodeMetaV2(h.subarray(12)), e);
        }, { runs: 1, warmup: 0 });

      // v1 旧备份（只读兼容）：mediaOrder 校验是 O(M^2)。
      if (n <= 1000) {
        const v1 = encodeHeader(state).subarray(12);
        await bench(G, "v1 decodeManifest (legacy read, mediaOrder includes O(M^2))", n, () => decodeManifest(v1), { runs: 1, warmup: 0 });
      }

      // 开放归档。
      const year = busiestYear(state);
      let plan = planArchive(state, { viewerHtml: "<html></html>" });
      await bench(G, "planArchive (whole library)", n, () => { plan = planArchive(state, { viewerHtml: "<html></html>" }); }, {
        note: `${plan.entries.length} entries, library.json ${(plan.entries.find((e) => e.path.endsWith("library.json"))!.kind === "text" ? (plan.entries.find((e) => e.path.endsWith("library.json")) as { text: string }).text.length / 1048576 : 0).toFixed(1)} MB`,
      });
      await bench(G, `planArchive (one year ${year})`, n, () => planArchive(state, { year, viewerHtml: "<html></html>" }));
      const texts = plan.entries.filter((e): e is { kind: "text"; path: string; text: string } => e.kind === "text");
      await bench(G, "ZipWriter: all text entries of the archive (encode + crc32)", n, () => {
        let bytes = 0;
        const zip = new ZipWriter((b) => { bytes += b.length; });
        for (const e of texts) zip.addText(e.path, e.text);
        return bytes;
      }, { note: `${texts.length} text entries` });
      if (n === sizes()[0]) {
        const buf = new Uint8Array(4 * 1024 * 1024).fill(5);
        await bench(G, "crc32 4 MiB (per photo streamed into the archive)", "4MiB", () => crc32(buf), { runs: 5 });
      }
    });
  }
});
