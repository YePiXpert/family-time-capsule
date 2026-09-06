import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { sha256 } from "@noble/hashes/sha2.js";
import {
  buildRescuePackage,
  importRescuePackage,
  verifyRescuePackage,
  type RescueItem,
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
