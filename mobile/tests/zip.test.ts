import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { ZipWriter, crc32 } from "../src/local/zip";

/** 用 Python 标准库当独立裁判：能打开、CRC 全对、名单与内容一致。 */
function inspectWithPython(file: string) {
  const script = [
    "import json,sys,zipfile",
    "z=zipfile.ZipFile(sys.argv[1])",
    "bad=z.testzip()",
    "assert bad is None, 'corrupt entry: %s' % bad",
    "print(json.dumps({'names': z.namelist(), 'sizes': {i.filename: i.file_size for i in z.infolist()}, 'sha': {i.filename: __import__('hashlib').sha256(z.read(i)).hexdigest() for i in z.infolist()}}))",
  ].join("\n");
  for (const python of ["python3", "python"]) {
    const run = spawnSync(python, ["-c", script, file], { encoding: "utf8" });
    if (run.error) continue;
    if (run.status !== 0) throw new Error(run.stderr || run.stdout);
    return JSON.parse(run.stdout) as {
      names: string[];
      sizes: Record<string, number>;
      sha: Record<string, string>;
    };
  }
  throw new Error("python3 is required to verify ZIP output");
}

const sha256 = (b: Uint8Array) =>
  createHash("sha256").update(b).digest("hex");

async function build(file: string, forceZip64: boolean) {
  const fd = fs.openSync(file, "w");
  const zip = new ZipWriter((b) => fs.writeSync(fd, b), {
    forceZip64,
    now: new Date(2026, 8, 19, 10, 30, 0),
  });
  const big = new Uint8Array(200_000);
  for (let i = 0; i < big.length; i++) big[i] = (i * 7) & 0xff;
  zip.addText("桉桉成长记归档/README.txt", "这是普通文件。\n");
  zip.addText("桉桉成长记归档/记录/2026/2026-09-15 第一次挥手/正文.md", "# 第一次挥手\n");
  zip.addBytes("桉桉成长记归档/空文件.txt", new Uint8Array());
  let at = 0;
  await zip.addStream("桉桉成长记归档/记录/2026/照片1.bin", big.length, async () => {
    if (at >= big.length) return null;
    const chunk = big.subarray(at, Math.min(at + 65536, big.length));
    at += chunk.length;
    await new Promise((r) => setTimeout(r, 0));
    return chunk;
  });
  zip.finish();
  fs.closeSync(fd);
  return { big, size: zip.bytesWritten };
}

describe("zip writer", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anan-zip-"));
  it("computes the standard CRC-32 incrementally", () => {
    const bytes = new TextEncoder().encode("123456789");
    expect(crc32(bytes)).toBe(0xcbf43926);
    expect(crc32(bytes.subarray(4), crc32(bytes.subarray(0, 4)))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });
  for (const forceZip64 of [false, true]) {
    it(`writes archives python can open (zip64 ${forceZip64 ? "forced" : "as needed"})`, async () => {
      const file = path.join(dir, `out-${forceZip64}.zip`);
      const { big, size } = await build(file, forceZip64);
      expect(fs.statSync(file).size).toBe(size);
      // 本地头签名在文件开头，结尾记录在文件末尾。
      const bytes = fs.readFileSync(file);
      expect(bytes.readUInt32LE(0)).toBe(0x04034b50);
      expect(bytes.readUInt32LE(bytes.length - 22)).toBe(0x06054b50);
      const zip64Records = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x06, 0x06]));
      expect(zip64Records >= 0).toBe(forceZip64);
      const seen = inspectWithPython(file);
      expect(seen.names).toEqual([
        "桉桉成长记归档/README.txt",
        "桉桉成长记归档/记录/2026/2026-09-15 第一次挥手/正文.md",
        "桉桉成长记归档/空文件.txt",
        "桉桉成长记归档/记录/2026/照片1.bin",
      ]);
      expect(seen.sizes["桉桉成长记归档/空文件.txt"]).toBe(0);
      expect(seen.sizes["桉桉成长记归档/记录/2026/照片1.bin"]).toBe(big.length);
      expect(seen.sha["桉桉成长记归档/记录/2026/照片1.bin"]).toBe(sha256(big));
      expect(seen.sha["桉桉成长记归档/README.txt"]).toBe(
        sha256(new TextEncoder().encode("这是普通文件。\n")),
      );
    });
  }
  it("refuses streams whose length disagrees with the manifest", async () => {
    const zip = new ZipWriter(() => {});
    let served = false;
    await expect(
      zip.addStream("a.bin", 10, () => (served ? null : ((served = true), new Uint8Array(4)))),
    ).rejects.toThrow("比清单短");
    const zip2 = new ZipWriter(() => {});
    await expect(
      zip2.addStream("b.bin", 2, () => new Uint8Array(4)),
    ).rejects.toThrow("比清单长");
  });
  it("rejects unsafe paths and forbids entries after finish", () => {
    const zip = new ZipWriter(() => {});
    expect(() => zip.addText("../escape.txt", "x")).toThrow("路径无效");
    expect(() => zip.addText("", "x")).toThrow("路径无效");
    zip.addText("/leading/slash.txt", "x");
    zip.finish();
    expect(() => zip.addText("late.txt", "x")).toThrow("已经收尾");
  });
});
