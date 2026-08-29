#!/usr/bin/env node
// 生成测试夹具 JPEG（手工构造 marker 段，无需图像库）：
// - sample.jpg           无 EXIF，SOF0 4x4
// - sample-exif.jpg      DateTimeOriginal=2026:08:10 09:30:00（无时区）
// - sample-exif-offset.jpg 同上 + OffsetTimeOriginal=+08:00
// 结构对 marker 解析器（parseImageSize / exifr）有效；熵编码数据为占位。
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "tests", "fixtures");
mkdirSync(outDir, { recursive: true });

const W = 4;
const H = 4;

function segment(marker, payload) {
  const len = payload.length + 2;
  return Buffer.from([0xff, marker, (len >> 8) & 0xff, len & 0xff, ...payload]);
}

function sof0() {
  // precision, H, W, components(1), component id/sampling/qtable
  return segment(0xc0, [8, H >> 8, H & 0xff, W >> 8, W & 0xff, 1, 1, 0x11, 0]);
}

function dqt() {
  // 一张 8-bit 量化表（全 16），PQ/TQ = 0x00
  return segment(0xdb, [0x00, ...Array(64).fill(16)]);
}

function dht() {
  // 标准 Annex K 亮度 DC 表（简化）：bits + values
  const bits = Array(16).fill(1);
  bits[15] = 0;
  const values = Array.from({ length: 15 }, (_, i) => i); // 0..14
  return segment(0xc4, [0x00, ...bits, ...values]);
}

function sos() {
  // 1 分量，Ss=0 Se=63 Ah/Al=0
  return segment(0xda, [1, 1, 0x00, 0, 63, 0]);
}

function tiffAsciiExif(dateTimeOriginal, offsetTimeOriginal) {
  // 小端 TIFF：IFD0(1 项: ExifIFDPointer) → ExifIFD(DateTimeOriginal[, OffsetTimeOriginal])
  const exifEntries = [
    { tag: 0x9003, value: dateTimeOriginal }, // DateTimeOriginal (ASCII)
  ];
  if (offsetTimeOriginal) {
    exifEntries.push({ tag: 0x9011, value: offsetTimeOriginal }); // OffsetTimeOriginal
  }
  // TIFF 头 8 字节；IFD0 从偏移 8 开始：count + 1 项*12 + next=0 → 2+12+4 = 18 → ExifIFD at 26
  const ifd0Size = 2 + 12 + 4;
  const exifIfdOffset = 8 + ifd0Size;
  const stringsOffset = exifIfdOffset + 2 + exifEntries.length * 12 + 4;

  const head = Buffer.alloc(8);
  head.write("II", 0, "ascii");
  head.writeUInt16LE(0x2a, 2);
  head.writeUInt32LE(8, 4);

  const ifd0 = Buffer.alloc(ifd0Size);
  ifd0.writeUInt16LE(1, 0);
  ifd0.writeUInt16LE(0x8769, 2); // ExifIFDPointer：entry 从 ifd0+2 开始
  ifd0.writeUInt16LE(4, 4); // LONG（entry+2）
  ifd0.writeUInt32LE(1, 6); // count（entry+4）
  ifd0.writeUInt32LE(exifIfdOffset, 10); // value（entry+8）

  const ifdExif = Buffer.alloc(2 + exifEntries.length * 12 + 4);
  ifdExif.writeUInt16LE(exifEntries.length, 0);
  let cursor = stringsOffset;
  exifEntries.forEach((e, i) => {
    const base = 2 + i * 12;
    ifdExif.writeUInt16LE(e.tag, base);
    ifdExif.writeUInt16LE(2, base + 2); // ASCII
    ifdExif.writeUInt32LE(e.value.length + 1, base + 4); // 含 \0
    ifdExif.writeUInt32LE(cursor, base + 8);
    cursor += e.value.length + 1;
  });

  const strings = Buffer.concat(
    exifEntries.map((e) => {
      const b = Buffer.alloc(e.value.length + 1);
      b.write(e.value, 0, "ascii");
      return b;
    }),
  );

  return Buffer.concat([head, ifd0, ifdExif, strings]);
}

function app1Exif(tiff) {
  const exifHeader = Buffer.alloc(6);
  exifHeader.write("Exif", 0, "ascii");
  return segment(0xe1, Buffer.concat([exifHeader, tiff]));
}

function buildJpeg(extraSegments = []) {
  const soi = Buffer.from([0xff, 0xd8]);
  const eoi = Buffer.from([0xff, 0xd9]);
  const scanData = Buffer.from([0x00, 0x55, 0xaa, 0x00]); // 占位熵数据
  return Buffer.concat([
    soi,
    ...extraSegments,
    dqt(),
    sof0(),
    dht(),
    sos(),
    scanData,
    eoi,
  ]);
}

writeFileSync(path.join(outDir, "sample.jpg"), buildJpeg());
writeFileSync(
  path.join(outDir, "sample-exif.jpg"),
  buildJpeg([app1Exif(tiffAsciiExif("2026:08:10 09:30:00", null))]),
);
writeFileSync(
  path.join(outDir, "sample-exif-offset.jpg"),
  buildJpeg([
    app1Exif(tiffAsciiExif("2026:08:10 09:30:00", "+08:00")),
  ]),
);
console.log("fixtures written to", outDir);
