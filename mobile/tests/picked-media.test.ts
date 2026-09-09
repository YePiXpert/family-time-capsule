import { afterAll, expect, it, vi } from "vitest";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
const state = vi.hoisted(() => ({ root: "", interrupt: false }));
vi.mock("expo-file-system", async () => {
  const fs = await import("node:fs"), path = await import("node:path"), os = await import("node:os");
  state.root = fs.mkdtempSync(path.join(os.tmpdir(), "ftc-picker-files-"));
  const uri = (v: string | { uri: string }) => typeof v === "string" ? v : v.uri;
  class Directory {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) { this.uri = path.join(...parts.map(uri)); }
    create() { fs.mkdirSync(this.uri, { recursive: true }); }
  }
  class File {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) { this.uri = path.join(...parts.map(uri)); }
    get exists() { return fs.existsSync(this.uri); }
    copy(destination: File) {
      if (state.interrupt) { fs.writeFileSync(destination.uri, "incomplete bytes"); throw new Error("copy interrupted"); }
      fs.copyFileSync(this.uri, destination.uri, fs.constants.COPYFILE_EXCL);
    }
    move(destination: File) { fs.renameSync(this.uri, destination.uri); this.uri = destination.uri; }
    delete() { fs.unlinkSync(this.uri); }
  }
  return { Directory, File, FileMode: {}, Paths: { document: state.root } };
});
vi.mock("expo-media-library", () => ({ Asset: class {} }));
const { preservePickedMedia } = await import("../src/storage/files");
afterAll(() => rmSync(state.root, { recursive: true, force: true }));
it("keeps a pairedVideo without filename or MIME as a MOV video and preserves its real bytes", async () => {
  const source = path.join(process.cwd(), "../tests/fixtures/sample.mov");
  const payload = await preservePickedMedia({ uri: source, type: "pairedVideo", width: 32, height: 32 }, "paired-motion", "library");
  expect(payload).toMatchObject({ fileName: "capture-paired-motion.mov", mimeType: "video/quicktime", mediaType: "video", lastModified: null });
  expect(readFileSync(payload.localUri)).toEqual(readFileSync(source));
});
it("never promotes a partial copy as a preserved original", async () => {
  state.interrupt = true;
  const source = path.join(process.cwd(), "../tests/fixtures/sample.mov");
  await expect(preservePickedMedia({ uri: source, type: "pairedVideo", width: 32, height: 32 }, "failed-motion", "library")).rejects.toThrow("copy interrupted");
  const { existsSync } = await import("node:fs");
  expect(existsSync(path.join(state.root, "captures/failed-motion.mov"))).toBe(false);
  expect(existsSync(path.join(state.root, "captures/failed-motion.mov.part"))).toBe(false);
  expect(readFileSync(source).length).toBeGreaterThan(0);
});

it("preserves an imported MOV when the picker omits type, MIME and filename", async () => {
  state.interrupt = false;
  const source = path.join(process.cwd(), "../tests/fixtures/sample.mov");
  const payload = await preservePickedMedia({ uri: source, width: 32, height: 32 }, "untyped-video", "library");
  expect(payload).toMatchObject({ mimeType: "video/quicktime", mediaType: "video", lastModified: null });
  expect(payload.localUri).toMatch(/\.mov$/);
  expect(readFileSync(payload.localUri)).toEqual(readFileSync(source));
});
