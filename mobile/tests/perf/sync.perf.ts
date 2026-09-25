/**
 * 家人同步的纯计算：sharedLibrary、指纹/哈希、三方合并（0–3 份远端 × 不变 / 1% / 50% 改动）、
 * 引用整理、合并结果入库、「与上次上传一样吗」、上传规划（对象 id 派生）与对象加解密吞吐。
 */
import { describe, it, vi } from "vitest";
import { encodeEntities, backupBlobs } from "../../src/local/backup-format";
import { canonical, contentHashOf } from "../../src/local/hash";
import { forkLibrary, freezeLibrary, rootOf, type Library } from "../../src/local/model";
import { LocalStore } from "../../src/local/store";
import { fingerprintOf, mergeLibraries, repairReferences, emptyBase, type RemoteSnapshot, SHARED_KINDS } from "../../src/sync/merge";
import { planUpload } from "../../src/sync/planner";
import { bench, reportTo } from "./harness";
import { fresh, makeLibrary, remoteOf, sizes } from "./fixtures";

const env = vi.hoisted(() => ({ root: "/var/tmp/anan-tests", free: Number.POSITIVE_INFINITY, rejectActivation: false }));
vi.mock("expo-crypto", async () => {
  const crypto = await import("node:crypto");
  return { randomUUID: crypto.randomUUID, getRandomBytes: (n: number) => new Uint8Array(crypto.randomBytes(n)) };
});
vi.mock("expo-file-system", async () =>
  (await import("../helpers/expo-file-system-fake")).createExpoFileSystemFake(env),
);
vi.mock("expo-secure-store", () => ({ WHEN_UNLOCKED_THIS_DEVICE_ONLY: "unlocked" }));
vi.mock("expo-sharing", () => ({ isAvailableAsync: async () => true, shareAsync: async () => {} }));
vi.mock("expo-image-manipulator", () => ({ SaveFormat: { JPEG: "jpeg" }, manipulateAsync: async () => ({}) }));
vi.mock("expo-video-thumbnails", () => ({ getThumbnailAsync: async () => ({}) }));
vi.mock("../../modules/share-intake/src", () => ({ consumePendingNativeShares: async () => [], acknowledgeNativeShare: async () => {} }));

reportTo(__filename);
const G = "sync";

describe("sync", () => {
  for (const n of sizes()) {
    it(`sync CPU @ ${n}`, async () => {
      const { sharedLibrary } = await import("../../src/sync/engine");
      const { objectIdOf, sealObject, openObject, sha256Hex } = await import("../../src/sync/crypto");
      const local = makeLibrary(n);
      freezeLibrary(local);
      const shared = sharedLibrary(local);
      const sharedEntities = SHARED_KINDS.reduce((k, kind) => k + Object.keys(local[kind]).length, 0);
      const note = `${sharedEntities} shared entities, ${Object.keys(local.media).length} media`;

      await bench(G, "sharedLibrary", n, () => sharedLibrary(local), { note });
      const entities = SHARED_KINDS.flatMap((kind) => Object.values(local[kind]) as object[]);
      await bench(G, "canonical() of every shared entity", n, () => { for (const e of entities) canonical(e); }, { note });
      await bench(G, "contentHashOf() of every shared entity (canonical + sha256)", n, () => { for (const e of entities) contentHashOf(e); }, { note });
      await bench(G, "fingerprintOf() of every shared entity", n, () => { for (const e of entities) fingerprintOf(e as never); }, { note });

      // 稳态的基：上次同步结束时本机的指纹。
      const base = mergeLibraries(local, [], emptyBase()).base;
      const at = "2030-01-01T00:00:00.000Z";
      await bench(G, "mergeLibraries 0 remotes (all manifests already seen)", n, () => mergeLibraries(local, [], base, at));
      const snap = (library: Library, i: number): RemoteSnapshot => ({ deviceId: `dev${i}`, deviceName: `手机${i}`, createdAt: `2029-12-0${i + 1}T00:00:00.000Z`, library });
      for (const [label, fraction] of [["unchanged", 0], ["1% changed", 0.01], ["50% changed", 0.5]] as const) {
        const remotes = [0, 1, 2].map((i) => {
          const lib = fraction === 0 ? fresh(shared) : remoteOf(shared, fraction, 100 + i, `dev${i}`);
          return snap(lib, i);
        });
        for (const k of [1, 2, 3]) {
          const rs = remotes.slice(0, k);
          await bench(G, `mergeLibraries ${k} remote(s), ${label}`, n, () => mergeLibraries(local, rs, base, at));
        }
        if (fraction > 0) {
          // 合并结果入库：runFamilySync 的 store.change(Object.assign(current, merged.next))（内存盘）。
          const merged = mergeLibraries(local, remotes.slice(0, 1), base, at);
          let store: LocalStore;
          await bench(G, `store.change applying merge (1 remote, ${label})`, n, () =>
            store.change((current) => { Object.assign(current, mergeLibraries(current, remotes.slice(0, 1), base, at).next); }), {
            setup: async () => {
              store = new LocalStore({ read: async () => fresh(local), write: async (s, delta) => {
                JSON.stringify(rootOf(s));
                for (const { kind, id } of delta?.changed ?? []) JSON.stringify((s[kind] as Record<string, unknown>)[id]);
              } });
              await store.open();
            },
            runs: 3,
            note: `pulled ${merged.pulled}`,
          });
        }
      }
      const forked = forkLibrary(local);
      await bench(G, "repairReferences (nothing broken)", n, () => repairReferences(forked));

      // 「这一版和上次上传的一样吗」的冷路径（开机后第一轮）；之后按实体对象比对，不再整库编码。
      await bench(G, "unchanged check: sha256Hex(encodeEntities(sharedLibrary(state)))", n, () =>
        sha256Hex(encodeEntities(sharedLibrary(local))), { note });

      // 上传规划：对象 id 按钥匙指纹记住，第二次起不再做 HKDF。
      const key = new Uint8Array(16).fill(7);
      const blobs = backupBlobs(shared);
      const idOf = (sha: string, part: number) => objectIdOf(key, sha, part);
      let items = planUpload(blobs, idOf);
      await bench(G, "planUpload: objectIdOf (HKDF) per blob part", n, () => { items = planUpload(blobs, idOf); }, { note: `${blobs.length} blobs, ${items.length} objects` });
      const missing = new Set<string>();
      await bench(G, "pushManifest blob loop (plans grouped by blob once)", n, () => {
        const byBlob = new Map<string, typeof items>();
        for (const item of items) {
          const list = byBlob.get(item.sha256);
          if (list) list.push(item);
          else byBlob.set(item.sha256, [item]);
        }
        for (const blob of blobs) {
          const plans = byBlob.get(blob.sha256) ?? [];
          if (!plans.some((plan) => missing.has(plan.id))) continue;
        }
      });

      // 对象加解密与哈希吞吐：一张 4 MiB 的对象（照片约 2.4 MB → 1 个对象）。只在第一个规模跑。
      if (n === sizes()[0]) {
        const chunks = [0, 1, 2, 3].map((i) => new Uint8Array(1024 * 1024).fill(i + 1));
        const ref = { sha256: "a".repeat(64), part: 0, final: true };
        const sealed = sealObject(key, ref, chunks);
        await bench("crypto", "sealObject 4 MiB (XChaCha20-Poly1305, noble JS)", "4MiB", () => sealObject(key, ref, chunks), { runs: 5 });
        await bench("crypto", "openObject 4 MiB", "4MiB", () => openObject(key, ref, sealed), { runs: 5 });
        const flat = new Uint8Array(4 * 1024 * 1024).fill(3);
        await bench("crypto", "sha256Hex 4 MiB (noble JS)", "4MiB", () => sha256Hex(flat), { runs: 5 });
      }
    });
  }
});
