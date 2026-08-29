import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensureDataDirs } from "../../lib/paths";

const created: string[] = [];

afterEach(() => {
  for (const dir of created.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("ensureDataDirs", () => {
  it("创建 PRD §11 规定的 originals / derivatives / exports 布局", () => {
    const base = mkdtempSync(path.join(tmpdir(), "ftc-paths-"));
    created.push(base);

    const dirs = ensureDataDirs(path.join(base, "data"));

    for (const dir of [dirs.root, dirs.originals, dirs.derivatives, dirs.exports]) {
      expect(existsSync(dir)).toBe(true);
    }
    for (const sub of ["thumbnails", "previews", "transcodes", "waveforms"]) {
      expect(existsSync(path.join(dirs.derivatives, sub))).toBe(true);
    }
  });

  it("重复调用不报错（幂等）", () => {
    const base = mkdtempSync(path.join(tmpdir(), "ftc-paths-"));
    created.push(base);

    const root = path.join(base, "data");
    ensureDataDirs(root);

    expect(() => ensureDataDirs(root)).not.toThrow();
  });
});
