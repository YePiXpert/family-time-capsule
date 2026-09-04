// @ts-expect-error Node types are supplied by Vitest at runtime, not the Expo app bundle.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { normalizeNativeShareManifest } from "../src/native/intake-core";
import { classifyImportedFile } from "../src/storage/import-policy";
import type { NativeShareManifest } from "../modules/share-intake/src";

function source(relativePath: string): string {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

const manifestId = "10000000-0000-4000-8000-000000000001";

function manifest(items: NativeShareManifest["items"]): NativeShareManifest {
  return {
    manifestId,
    source: "share",
    createdAt: "2026-09-04T12:00:00.000Z",
    complete: true,
    items,
  };
}

function file(index: number, fileName: string, mimeType: string) {
  const captureId = `20000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
  return {
    externalId: `item-${index}`,
    captureId,
    kind: "file" as const,
    localUri: `file:///private/captures/${captureId}.${fileName.split(".").pop()}`,
    fileName,
    mimeType,
    mediaType: "document" as const,
  };
}

describe("native system share intake", () => {
  it("generates Android SEND and SEND_MULTIPLE filters for private intake", () => {
    const plugin = source("plugins/with-native-share-intake.js");
    expect(plugin).toContain("android.intent.action.SEND");
    expect(plugin).toContain("android.intent.action.SEND_MULTIPLE");
    expect(plugin).toContain("application/pdf");
    expect(plugin).toContain("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  });

  it("copies Android content URIs independently before exposing manifests to JS", () => {
    const kotlin = source("modules/share-intake/android/src/main/java/app/familytimecapsule/shareintake/FamilyShareIntakeModule.kt");
    expect(kotlin).toContain("resolver.openInputStream(uri)");
    expect(kotlin).toContain("input.copyTo(output, 64 * 1024)");
    expect(kotlin).toContain("val result = copyUri");
    expect(kotlin).toContain("HANDLED_EXTRA");
  });

  it("keeps the Share Extension credential-free and uses the same App Group as the main app", () => {
    const extension = source("plugins/share-extension/ShareViewController.swift");
    const module = source("modules/share-intake/ios/FamilyShareIntakeModule.swift");
    expect(extension).toContain("group.app.familytimecapsule.mobile.share");
    expect(module).toContain("group.app.familytimecapsule.mobile.share");
    expect(extension).not.toMatch(/Bearer|serverUrl|URLSession|token/iu);
    expect(extension).toContain("writeManifest(complete: false)");
    expect(extension).toContain("writeManifest(complete: true)");
  });

  it("uses bounded file-handle chunks and persists the acknowledged offset", () => {
    const files = source("src/storage/files.ts");
    const database = source("src/storage/database.ts");
    expect(files).toContain("const UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024");
    expect(files).toContain("handle.readBytes(Math.min(UPLOAD_CHUNK_BYTES");
    expect(files).not.toContain("file.arrayBuffer()");
    expect(database).toContain("payload.uploadOffset = uploadOffset");
    expect(database).toContain("intake_state = 'uploading'");
  });

  it("normalizes five shared photos as independent durable queue items", () => {
    const input = manifest(Array.from({ length: 5 }, (_, index) =>
      file(index + 1, `photo-${index + 1}.jpg`, "image/jpeg")));
    const normalized = normalizeNativeShareManifest(input, () => true);
    expect(normalized?.items).toHaveLength(5);
    expect(normalized?.items.map((item) => item.captureId)).toEqual(
      input.items.map((item) => item.captureId),
    );
    expect(normalized?.items.every((item) => item.kind === "file")).toBe(true);
  });

  it("keeps audio, PDF, plain text and URL sharing distinct without inventing source time", () => {
    const input = manifest([
      file(1, "memo.m4a", "audio/mp4"),
      file(2, "letter.pdf", "application/pdf"),
      {
        externalId: "text",
        captureId: "20000000-0000-4000-8000-000000000003",
        kind: "text",
        text: "外婆今天讲了小时候的故事",
      },
      {
        externalId: "url",
        captureId: "20000000-0000-4000-8000-000000000004",
        kind: "text",
        text: "https://example.test/family-story",
      },
    ]);
    const normalized = normalizeNativeShareManifest(input, () => true);
    expect(normalized?.items[0]?.payload).toMatchObject({ mediaType: "audio", lastModified: null });
    expect(normalized?.items[1]?.payload).toMatchObject({ mediaType: "document", lastModified: null });
    expect(normalized?.items[2]?.payload).toEqual({ text: "外婆今天讲了小时候的故事" });
    expect(normalized?.items[3]?.payload).toEqual({ text: "https://example.test/family-story" });
  });

  it("records one failed copy without rolling back valid siblings", () => {
    const normalized = normalizeNativeShareManifest(manifest([
      file(1, "kept.pdf", "application/pdf"),
      {
        externalId: "failed",
        captureId: "20000000-0000-4000-8000-000000000002",
        kind: "error",
        error: "copy_interrupted",
      },
    ]), () => true);
    expect(normalized?.items).toHaveLength(2);
    expect(normalized?.items[0]?.kind).toBe("file");
    expect(normalized?.items[1]).toMatchObject({ kind: "error", error: "copy_interrupted" });
  });

  it("makes manifest replay deterministic and rejects executable document formats", () => {
    const input = manifest([file(1, "archive.pdf", "application/pdf")]);
    expect(normalizeNativeShareManifest(input, () => true)).toEqual(
      normalizeNativeShareManifest(input, () => true),
    );
    expect(classifyImportedFile("page.html", "text/html")).toBeNull();
    expect(classifyImportedFile("vector.svg", "image/svg+xml")).toBeNull();
    expect(classifyImportedFile("macro.docm", "application/vnd.ms-word.document.macroenabled.12")).toBeNull();
  });
});
