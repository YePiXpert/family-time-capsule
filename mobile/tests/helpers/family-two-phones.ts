import { expect, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import type { LocalStore } from "../../src/local/store";
import { keyIdOf, objectIdOf } from "../../src/sync/crypto";
import type { Transport } from "../../src/sync/transport";

type Phone = {
  root: string;
  store: LocalStore;
  files: typeof import("../../src/local/files");
  family: typeof import("../../src/sync/family");
  model: typeof import("../../src/local/model");
  state: typeof import("../../src/sync/state");
};

/** 同一条故事先用内存传输推演，再用真 HTTP、两份 SQLite 库验收。 */
export async function twoPhonesWriteTogether({
  openPhone,
  transportA,
  transportB,
  key,
  checkObjects,
}: {
  openPhone: (root?: string) => Promise<Phone>;
  transportA: Transport;
  transportB: Transport;
  key: Uint8Array;
  checkObjects?: (expected: Set<string>) => Promise<void>;
}) {
  const puts = [vi.spyOn(transportA, "put"), vi.spyOn(transportB, "put")];
  const manifests = [
    vi.spyOn(transportA, "putManifest"),
    vi.spyOn(transportB, "putManifest"),
  ];
  const photoObjects = new Set<string>();
  const depsA = { transport: transportA, key };
  const depsB = { transport: transportB, key };
  const add = async (p: Phone, id: string, by: string, byte: number) => {
    const bytes = Buffer.alloc(3000, byte);
    const source = path.join(p.root, `${id}.jpg`);
    fs.writeFileSync(source, bytes);
    const media = await p.files.preserveMedia(source, `${id}.jpg`, "image");
    photoObjects.add(objectIdOf(key, media.sha256, 0));
    await p.store.change((s) => {
      s.drafts[id] = {
        id,
        recordId: null,
        baseRevision: 0,
        updatedAt: "2026-09-20T00:00:00Z",
        content: {
          ...p.model.emptyContent(),
          text: `一起写 ${id}`,
          by,
          mediaIds: [media.id],
          coverId: media.id,
        },
      };
      s.media[media.id] = media;
      p.model.saveRecord(s, id, `r-${id}`, "2026-09-20T00:00:00Z");
    });
    return { media, bytes };
  };
  const edit = async (p: Phone, text: string, by: string, now: string) => {
    await p.store.change((s) => {
      const record = s.records["r-a"]!;
      s.drafts.edit = {
        id: "edit",
        recordId: record.id,
        baseRevision: record.revision,
        updatedAt: now,
        content: {
          ...p.model.clone(record),
          mediaIds: [...record.mediaIds],
          text,
          by,
        },
      };
      p.model.saveRecord(s, "edit", record.id, now);
    });
  };

  let a = await openPhone();
  const rootA = a.root;
  const originals = [
    await add(a, "a", "爸爸", 17),
    await add(a, "b", "爸爸", 42),
  ];
  const joined = await a.family.joinFamily(a.store, key, { transport: transportA });
  expect(joined).toMatchObject({
    version: 2,
    enabled: true,
    autoSync: true,
    keyId: keyIdOf(key),
    lastSyncSummary: { devices: 1, objects: 3, pushed: 3, conflicts: 0 },
  });
  expect(await a.state.readRemoteState()).toEqual(joined);
  const deviceA = (await transportA.me()).deviceId;
  expect(deviceA).toBeTruthy();
  expect(await transportA.manifests()).toHaveLength(1);

  let b = await openPhone();
  const rootB = b.root;
  await b.family.joinFamily(b.store, key, { transport: transportB });
  const deviceB = (await transportB.me()).deviceId;
  expect(deviceB).toBeTruthy();
  expect(deviceB).not.toBe(deviceA);
  expect(Object.keys(b.store.get().records).sort()).toEqual(["r-a", "r-b"]);
  for (const id of ["a", "b"])
    expect(b.store.get().records[`r-${id}`]).toMatchObject({
      text: `一起写 ${id}`,
      by: "爸爸",
    });
  for (const { media, bytes } of originals) {
    const restored = b.store.get().media[media.id]!;
    expect(fs.readFileSync(b.files.mediaFile(restored).uri).equals(bytes)).toBe(
      true,
    );
    expect(b.files.thumbFile(restored)?.exists).toBe(true);
  }
  await add(b, "c", "妈妈", 91);
  const deletedAt = "2026-09-20T01:00:00Z";
  await b.store.change((s) => b.model.deleteRecord(s, "r-b", deletedAt));
  await b.family.runFamilySync(b.store, depsB);

  a = await openPhone(rootA);
  await a.family.runFamilySync(a.store, depsA);
  expect(Object.keys(a.store.get().records).sort()).toEqual(["r-a", "r-c"]);
  expect(a.store.get().records["r-c"]?.by).toBe("妈妈");
  expect(a.store.get().tombstones?.["records:r-b"]).toBe(deletedAt);
  const manifestObjects = new Set(
    manifests
      .flatMap((spy) => spy.mock.calls.flatMap((call) => call[2] ?? []))
      .filter((id) => !photoObjects.has(id)),
  );
  expect(photoObjects.size).toBe(3);
  for (const id of photoObjects)
    expect(
      puts.flatMap((spy) => spy.mock.calls).filter((call) => call[0] === id),
    ).toHaveLength(1);
  // 真服务端保留一小时内的旧清单；照片对象只有三份。
  await checkObjects?.(new Set([...photoObjects, ...manifestObjects]));

  await edit(a, "爸爸改的一版", "爸爸", "2026-09-20T02:00:00Z");
  const versionA = a.store.get().records["r-a"]!;
  await a.family.runFamilySync(a.store, depsA);
  b = await openPhone(rootB);
  expect(b.store.get().records["r-a"]?.text).toBe("一起写 a");
  await edit(b, "妈妈改的后来一版", "妈妈", "2026-09-20T03:00:00Z");
  await b.family.runFamilySync(b.store, depsB);
  // B 在旧基上编辑，冲突在 B 合并时发生；留底是本机资料，不随清单传输。
  const conflicts = await b.state.readConflicts();
  expect(conflicts).toHaveLength(1);
  expect(conflicts[0]?.loser).toEqual(versionA);
  expect(conflicts[0]?.winner.by).toBe("妈妈");
  a = await openPhone(rootA);
  await a.family.runFamilySync(a.store, depsA);
  expect(a.store.get().records["r-a"]).toMatchObject({
    text: "妈妈改的后来一版",
    by: "妈妈",
    updatedAt: "2026-09-20T03:00:00Z",
  });
  expect(await a.state.readConflicts()).toEqual([]);

  b = await openPhone(rootB);
  expect(await b.family.leaveFamily({ transport: transportB })).toEqual({
    removedRemote: true,
  });
  expect((await transportA.manifests()).map((entry) => entry.deviceId)).toEqual([
    deviceA,
  ]);
  a = await openPhone(rootA);
  const before = a.model.clone(a.store.get());
  const result = await a.family.runFamilySync(a.store, depsA);
  expect(result.lastSyncSummary?.devices).toBe(1);
  expect(result.lastSyncSummary?.pushed).toBe(0);
  // LocalStore 每次成功写入递增库修订号，内容本身不变。
  expect(a.store.get()).toEqual({ ...before, revision: before.revision + 1 });
}
