import { describe, expect, it } from "vitest";
import type { MemoryEditRescueGroup } from "../src/storage/database";
import JSZip from "jszip";
import { sha256 } from "@noble/hashes/sha2.js";
import {
  buildRescuePackage,
  importRescuePackage,
  verifyRescuePackage,
  type RescueItem,
  type RescueManifest,
  type RescueRestoredEditGroup,
} from "../src/rescue/rescue-package";

const encoder = new TextEncoder();

function memoryIO(files: Map<string, Uint8Array>) {
  return {
    exists: (uri: string) => files.has(uri),
    readBytes: async (uri: string) => {
      const content = files.get(uri);
      if (!content) throw new Error(`missing ${uri}`);
      return content;
    },
  };
}

const TEXT_ITEM: RescueItem = {
  captureId: "text-1",
  kind: "text_capture",
  title: "今天的第一句话",
  occurredAt: "2026-09-05T08:30:00.000Z",
  localUri: null,
  mediaType: null,
  fileName: null,
  mimeType: null,
  text: "小满叫了爸爸。",
};

const MEDIA_ITEM: RescueItem = {
  captureId: "media-1",
  kind: "media_capture",
  title: "照片",
  occurredAt: "2026-09-05T09:00:00.000Z",
  localUri: "file:///captures/media-1.jpg",
  mediaType: "image",
  fileName: "photo.jpg",
  mimeType: "image/jpeg",
  text: null,
};

describe("本机救援包（M4）", () => {
  it("构建 → 校验往返一致：清单、哈希与文件内容", async () => {
    const photo = encoder.encode("fake-jpeg-bytes");
    const files = new Map([["file:///captures/media-1.jpg", photo]]);
    const bytes = await buildRescuePackage([TEXT_ITEM, MEDIA_ITEM], memoryIO(files));

    const { manifest, files: unpacked } = await verifyRescuePackage(bytes);
    expect(manifest.format).toBe("ftc-local-rescue");
    expect(manifest.captures).toHaveLength(2);
    const mediaEntry = manifest.captures.find((entry) => entry.captureId === "media-1")!;
    expect(mediaEntry.sha256).toBe(
      Array.from(sha256(photo), (b) => b.toString(16).padStart(2, "0")).join(""),
    );
    expect(unpacked.get(mediaEntry.file!)!).toEqual(photo);
    const textEntry = manifest.captures.find((entry) => entry.captureId === "text-1")!;
    expect(textEntry.text).toBe("小满叫了爸爸。");
    // 清单不含任何凭据字段
    const serialized = JSON.stringify(manifest);
    expect(serialized).not.toContain("token");
    expect(serialized).not.toContain("password");
  });

  it("文件被篡改时校验失败，不报成功", async () => {
    const photo = encoder.encode("original");
    const bytes = await buildRescuePackage([MEDIA_ITEM], memoryIO(new Map([["file:///captures/media-1.jpg", photo]])));
    // 解开、替换内容、重新打包（注意跳过 zip 的目录占位条目）
    const zip = await JSZip.loadAsync(bytes);
    const mediaPath = Object.keys(zip.files).find(
      (path) => path.startsWith("files/") && !zip.files[path]!.dir,
    )!;
    zip.file(mediaPath, encoder.encode("tampered"));
    const tampered = await zip.generateAsync({ type: "uint8array" });
    await expect(verifyRescuePackage(tampered)).rejects.toThrow("校验失败");
  });

  it("拒绝路径穿越与非白名单路径", async () => {
    const zip = new JSZip();
    zip.file("manifest.json", JSON.stringify({ format: "ftc-local-rescue", version: 1, exportedAt: "now", captures: [] }));
    zip.file("../evil.txt", encoder.encode("x"));
    const evil = await zip.generateAsync({ type: "uint8array" });
    await expect(verifyRescuePackage(evil)).rejects.toThrow("非法路径");
  });

  it("恢复幂等：已存在的 captureId 跳过；媒体文件写入后登记 pending", async () => {
    const photo = encoder.encode("photo-bytes");
    const bytes = await buildRescuePackage(
      [TEXT_ITEM, MEDIA_ITEM],
      memoryIO(new Map([["file:///captures/media-1.jpg", photo]])),
    );
    const existing = new Set<string>(["text-1"]);
    const written: string[] = [];
    const inserted: string[] = [];
    const result = await importRescuePackage(bytes, {
      captureExists: async (id) => existing.has(id),
      restoreText: async (input) => {
        existing.add(input.captureId);
        inserted.push(`text:${input.captureId}`);
      },
      restoreMedia: async (input) => {
        existing.add(input.captureId);
        written.push(input.fileName);
        inserted.push(`media:${input.captureId}`);
      },
    });
    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(1);
    expect(written).toEqual(["photo.jpg"]);
    expect(inserted).toEqual(["media:media-1"]);

    // 再恢复一次：全部跳过
    const again = await importRescuePackage(bytes, {
      captureExists: async (id) => existing.has(id),
      restoreText: async () => { throw new Error("should not run"); },
      restoreMedia: async () => { throw new Error("should not run"); },
    });
    expect(again.imported).toBe(0);
    expect(again.skipped).toBe(2);
  });

  it("不是救援包的文件被拒绝（含白名单之外的路径）", async () => {
    const zip = new JSZip();
    zip.file("random.txt", encoder.encode("hello"));
    const bytes = await zip.generateAsync({ type: "uint8array" });
    await expect(verifyRescuePackage(bytes)).rejects.toThrow();

    const noManifest = new JSZip();
    noManifest.file("files/a.jpg", encoder.encode("x"));
    await expect(
      verifyRescuePackage(await noManifest.generateAsync({ type: "uint8array" })),
    ).rejects.toThrow("清单");
  });
});

function editFixture(): MemoryEditRescueGroup {
  const scope = JSON.stringify(['https://family.example', 'instance-a', 'user-a', 'family-a']);
  const item = { id: 'edit-item', assetId: null, localCaptureRef: 'edit-original', caption: '新增照片' };
  const content = { title: '原记录', bodyText: '重开也不能丢的全文', location: '', occurredAt: null, precision: 'unknown' as const, participants: [], child: null, visibility: 'private' as const, items: [item], newCoverItemId: item.id };
  return { scope, memoryId: 'memory-a', snapshot: { scope, memoryId: 'memory-a', content, base: { ...content, items: [], newCoverItemId: null }, baseRevision: 4, timezone: 'Asia/Shanghai', atomicEditVersion: 1, appliedItemIds: ['previously-saved-item'],
    savedContent: { ...content, bodyText: '先前已保存的全文' }, submission: { mutationId: 'apply-once', expectedRevision: 4, content,
      stage: { id: 'stage-a', mutationId: 'register-once', revision: 1, items: [{ ...item, assetId: 'received-asset' }], uploads: { 'edit-item': { id: 'upload-a', offset: 5 } } } },
    conflict: null, blocked: false, problem: null, revision: 9, updatedAt: '2026-09-15T10:00:00.000Z' },
    originals: [{ id: 'edit-original', title: '照片', occurredAt: '2026-09-15T10:00:00.000Z', payload: { localUri: 'file:///edit.jpg', fileName: 'edit.jpg', mimeType: 'image/jpeg', mediaType: 'image', source: 'camera', lastModified: null,
      ...{ memoryEditOwnerScope: scope, memoryEditTarget: 'memory-a' } } }] };
}
async function mutateManifest(bytes: Uint8Array, change: (manifest: RescueManifest) => void) {
  const zip = await JSZip.loadAsync(bytes);
  const manifest = JSON.parse(await zip.file('manifest.json')!.async('string')) as RescueManifest;
  change(manifest); zip.file('manifest.json', JSON.stringify(manifest));
  return zip.generateAsync({ type: 'uint8array' });
}
it('v2 preserves immutable editing submission, scope and originals through its dedicated restore, never ordinary outbox', async () => {
  const group = editFixture(), photo = encoder.encode('photo');
  const bytes = await buildRescuePackage([], memoryIO(new Map([['file:///edit.jpg', photo]])), [group]);
  const { manifest } = await verifyRescuePackage(bytes);
  expect(manifest.version).toBe(2);
  expect(manifest.captures).toEqual([]);
  expect(manifest.memoryEdits![0]!.snapshot).toEqual(group.snapshot);
  expect(JSON.stringify(manifest)).not.toContain('file:///edit.jpg');
  const restored: RescueRestoredEditGroup[] = [];
  const sink = { captureExists: async () => { throw new Error('not ordinary capture'); }, restoreText: async () => { throw new Error('not text'); }, restoreMedia: async () => { throw new Error('not outbox'); }, restoreMemoryEdit: async (value: RescueRestoredEditGroup) => { if (restored.length) return false; restored.push(value); return true; } };
  expect(await importRescuePackage(bytes, sink)).toEqual({ imported: 1, skipped: 0, missingFiles: 0 });
  expect(restored[0]).toMatchObject({ scope: group.scope, memoryId: group.memoryId, snapshot: group.snapshot });
  expect(restored[0]!.originals[0]!.bytes).toEqual(photo);
  expect(await importRescuePackage(bytes, sink)).toEqual({ imported: 0, skipped: 1, missingFiles: 0 });
});
it('rejects scope substitution, target mismatch, credential fields, dangling refs and v1 downgrade before any write', async () => {
  const bytes = await buildRescuePackage([TEXT_ITEM], memoryIO(new Map([['file:///edit.jpg', encoder.encode('photo')]])), [editFixture()]);
  const changes: ((m: RescueManifest) => void)[] = [
    m => { m.memoryEdits![0]!.scope = JSON.stringify(['https://other.example', 'instance-b', 'user-b', 'family-b']); },
    m => { m.memoryEdits![0]!.memoryId = 'other-memory'; },
    m => { Object.assign(m.memoryEdits![0]!.snapshot, { token: 'secret' }); },
    m => { const g = m.memoryEdits![0]!; g.scope = g.snapshot.scope = JSON.stringify(['https://family.example?token=secret', 'instance-a', 'user-a', 'family-a']); },
    m => { m.memoryEdits![0]!.originals = []; },
    m => { m.memoryEdits![0]!.snapshot.content.newCoverItemId = 'missing-item'; },
    m => { m.memoryEdits![0]!.snapshot.appliedItemIds = ['same-item', 'same-item']; },
    m => { m.version = 1; },
  ];
  for (const change of changes) {
    let writes = 0;
    const sink = { captureExists: async () => false, restoreText: async () => { writes++; }, restoreMedia: async () => { writes++; }, restoreMemoryEdit: async () => { writes++; return true; } };
    await expect(importRescuePackage(await mutateManifest(bytes, change), sink)).rejects.toThrow();
    expect(writes).toBe(0);
  }
  await expect(importRescuePackage(bytes, { captureExists: async () => false, restoreText: async () => { throw new Error('must reject first'); }, restoreMedia: async () => {} })).rejects.toThrow('升级');
});
it('missing editing original skips the whole edit group and keeps legacy v1 normal captures readable', async () => {
  const bytes = await buildRescuePackage([], memoryIO(new Map()), [editFixture()]);
  const result = await importRescuePackage(bytes, { captureExists: async () => false, restoreText: async () => {}, restoreMedia: async () => {}, restoreMemoryEdit: async () => { throw new Error('partial edit must not restore'); } });
  expect(result).toEqual({ imported: 0, skipped: 0, missingFiles: 1 });
  const legacy = await mutateManifest(await buildRescuePackage([TEXT_ITEM], memoryIO(new Map())), m => { m.version = 1; delete m.memoryEdits; });
  expect((await verifyRescuePackage(legacy)).manifest.captures[0]!.text).toBe(TEXT_ITEM.text);
});
