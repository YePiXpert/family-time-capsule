#!/usr/bin/env node
// 生成测试夹具（RH-001：真实结构的小样本，非几字节假文件）：
// - sample.jpg / sample-exif.jpg / sample-exif-offset.jpg   JPEG（无/有 EXIF）
// - sample.png           真实可渲染 1x1 PNG（截图代表）
// - sample.heic          ISO-BMFF heic 品牌（iPhone 照片主格式）
// - sample.heif          ISO-BMFF mif1 品牌
// - sample.mov           QuickTime（ftyp qt + moov/mvhd + mdat）
// - sample.m4a           M4A 音频（ftyp M4A + mdat）
// - sample.mp4           MP4 容器（ftyp isom）
// - sample.mp3           ID3v2.3 + 帧同步
// - sample.wav           1 秒 8kHz 正弦（真实可播放）
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "tests", "fixtures");
mkdirSync(outDir, { recursive: true });

// ---------- 基础工具 ----------
function box(type, payload) {
  const out = Buffer.alloc(8 + payload.length);
  out.writeUInt32BE(payload.length + 8, 0);
  out.write(type, 4, "ascii");
  payload.copy(out, 8);
  return out;
}

function fullBox(type, version, flags, payload) {
  const header = Buffer.from([version, (flags >> 16) & 0xff, (flags >> 8) & 0xff, flags & 0xff]);
  return box(type, Buffer.concat([header, payload]));
}

function ftyp(major, minor, compat) {
  const brand4 = (c) => {
    const b = Buffer.alloc(4);
    b.write(c.slice(0, 4).padEnd(4, " "), 0, "ascii");
    return b;
  };
  const minorBuf = Buffer.alloc(4);
  minorBuf.writeUInt32BE(minor, 0);
  return box("ftyp", Buffer.concat([brand4(major), minorBuf, ...compat.map(brand4)]));
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    let crc = 0xffffffff;
    const table = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    for (const byte of Buffer.concat([Buffer.from(type, "ascii"), data])) {
      crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    }
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([len, Buffer.from(type, "ascii"), data, crcBuf]);
  };
  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------- JPEG（沿用 v0.1.0 结构） ----------
const W = 4;
const H = 4;
function segment(marker, payload) {
  const len = payload.length + 2;
  return Buffer.from([0xff, marker, (len >> 8) & 0xff, len & 0xff, ...payload]);
}
const sof0 = () => segment(0xc0, [8, H >> 8, H & 0xff, W >> 8, W & 0xff, 1, 1, 0x11, 0]);
const dqt = () => segment(0xdb, [0x00, ...Array(64).fill(16)]);
const dht = () => {
  const bits = Array(16).fill(1);
  bits[15] = 0;
  const values = Array.from({ length: 15 }, (_, i) => i);
  return segment(0xc4, [0x00, ...bits, ...values]);
};
const sos = () => segment(0xda, [1, 1, 0x00, 0, 63, 0]);
function buildJpeg(extraSegments = []) {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    ...extraSegments,
    dqt(),
    sof0(),
    dht(),
    sos(),
    Buffer.from([0x00, 0x55, 0xaa, 0x00]),
    Buffer.from([0xff, 0xd9]),
  ]);
}

function tiffAsciiExif(dateTimeOriginal, offsetTimeOriginal) {
  const exifEntries = [{ tag: 0x9003, value: dateTimeOriginal }];
  if (offsetTimeOriginal) exifEntries.push({ tag: 0x9011, value: offsetTimeOriginal });
  const ifd0Size = 2 + 12 + 4;
  const exifIfdOffset = 8 + ifd0Size;
  const stringsOffset = exifIfdOffset + 2 + exifEntries.length * 12 + 4;

  const head = Buffer.alloc(8);
  head.write("II", 0, "ascii");
  head.writeUInt16LE(0x2a, 2);
  head.writeUInt32LE(8, 4);

  const ifd0 = Buffer.alloc(ifd0Size);
  ifd0.writeUInt16LE(1, 0);
  ifd0.writeUInt16LE(0x8769, 2); // ExifIFDPointer
  ifd0.writeUInt16LE(4, 4); // LONG
  ifd0.writeUInt32LE(1, 6);
  ifd0.writeUInt32LE(exifIfdOffset, 10);

  const ifdExif = Buffer.alloc(2 + exifEntries.length * 12 + 4);
  ifdExif.writeUInt16LE(exifEntries.length, 0);
  let cursor = stringsOffset;
  exifEntries.forEach((e, i) => {
    const base = 2 + i * 12;
    ifdExif.writeUInt16LE(e.tag, base);
    ifdExif.writeUInt16LE(2, base + 2); // ASCII
    ifdExif.writeUInt32LE(e.value.length + 1, base + 4);
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
  const header = Buffer.alloc(6);
  header.write("Exif", 0, "ascii");
  return segment(0xe1, Buffer.concat([header, tiff]));
}

// ---------- HEIC / HEIF（CISB 结构） ----------
function buildHeic(brand) {
  // ftyp + meta(hdlr(pict)) + idat 占位：魔数/容器嗅探与“可保存原件”验证用；
  // 无 iloc/iinf → EXIF 解析优雅返回 null（符合“metadata 可读则读”）
  const hdlr = fullBox("hdlr", 0, 0, (() => {
    const b = Buffer.alloc(24);
    b.write("pict", 8, "ascii");
    b.write("heic-handler", 16, "ascii");
    return b;
  })());
  const meta = fullBox("meta", 0, 0, Buffer.concat([hdlr]));
  return Buffer.concat([
    ftyp(brand, 0, [brand, "mif1"]),
    meta,
    box("idat", Buffer.alloc(32, 0x11)),
    box("mdat", Buffer.alloc(64, 0x22)),
  ]);
}

// 带 EXIF 的 HEIC：完整 HEIF 结构（iinf 声明 Exif item + iloc 指向文件尾的 TIFF 块），
// exifr 可实际读出 DateTimeOriginal（v0.1.2 实证）。
function buildHeicWithExif(dateTimeOriginal) {
  const hdlr = fullBox("hdlr", 0, 0, (() => {
    const b = Buffer.alloc(24);
    b.write("pict", 8, "ascii");
    b.write("e", 16, "ascii");
    return b;
  })());
  const infe = fullBox("infe", 2, 0, (() => {
    const b = Buffer.alloc(11);
    b.writeUInt16BE(1, 0); // item_ID
    b.writeUInt16BE(0, 2); // protection
    b.write("Exif", 4, "ascii"); // item_type
    b.write("E\0", 8, "ascii"); // item_name
    return b;
  })());
  const iinf = fullBox("iinf", 0, 0, (() => {
    const c = Buffer.alloc(2);
    c.writeUInt16BE(1);
    return Buffer.concat([c, infe]);
  })());
  const ilocPayload = (() => {
    const b = Buffer.alloc(22);
    b.writeUInt8(0x44, 0); // offset_size=4 | length_size=4
    b.writeUInt8(0x40, 1); // base_offset_size=4 | index_size=0
    b.writeUInt16BE(1, 2); // item_count
    b.writeUInt16BE(1, 4); // item_ID
    b.writeUInt16BE(0, 6); // data_reference_index
    b.writeUInt32BE(0, 8); // base_offset
    b.writeUInt16BE(1, 12); // extent_count
    b.writeUInt32BE(0, 14); // extent_offset（占位）
    b.writeUInt32BE(0, 18); // extent_length（占位）
    return b;
  })();
  const iloc = fullBox("iloc", 0, 0, ilocPayload);
  const meta = fullBox("meta", 0, 0, Buffer.concat([hdlr, iinf, iloc]));

  const tiff = tiffAsciiExif(dateTimeOriginal, null);
  const exifItem = Buffer.concat([Buffer.alloc(4), tiff]); // exif_tiff_header_offset=0 + TIFF

  const ftypBox = ftyp("heic", 0, ["heic", "mif1"]);
  const mdat = box("mdat", Buffer.alloc(64, 0x22));
  const prefix = Buffer.concat([ftypBox, meta, mdat]);
  const exifOffset = prefix.length;
  const ilocNew = Buffer.from(iloc);
  ilocNew.writeUInt32BE(exifOffset, 12 + 14);
  ilocNew.writeUInt32BE(exifItem.length, 12 + 18);
  const metaNew = fullBox("meta", 0, 0, Buffer.concat([hdlr, iinf, ilocNew]));
  return Buffer.concat([ftypBox, metaNew, mdat, exifItem]);
}

// ---------- MOV / M4A / MP4 ----------
function mvhd() {
  // version 0 mvhd（payload 布局：creation@0 mod@4 timescale@8 duration@12 rate@16…）
  // creation_time 为 QuickTime 纪元（1904-01-01 UTC）秒：对应 2026-08-15T05:00:00Z
  const qtCreation = Math.floor(
    (Date.UTC(2026, 7, 15, 5) - Date.UTC(1904, 0, 1)) / 1000,
  );
  const b = Buffer.alloc(100);
  b.writeUInt32BE(qtCreation, 0); // creation_time
  b.writeUInt32BE(qtCreation, 4); // modification_time
  b.writeUInt32BE(600, 8); // timescale
  b.writeUInt32BE(600, 12); // duration = 1 秒
  b.writeUInt32BE(0x00010000, 16); // preferred rate 1.0
  b.writeUInt16BE(0x0100, 20); // volume
  return fullBox("mvhd", 0, 0, b);
}
function buildMov() {
  const moov = box("moov", mvhd());
  return Buffer.concat([
    ftyp("qt ", 0x2003, ["qt  "]),
    box("wide", Buffer.alloc(8)),
    moov,
    box("mdat", Buffer.alloc(128, 0x33)),
  ]);
}
function buildM4a() {
  return Buffer.concat([
    ftyp("M4A ", 0, ["M4A ", "isom"]),
    box("free", Buffer.alloc(16)),
    box("mdat", Buffer.alloc(96, 0x44)),
  ]);
}
function buildMp4() {
  return Buffer.concat([
    ftyp("isom", 0x200, ["isom", "iso2", "mp41"]),
    box("free", Buffer.alloc(8)),
    box("mdat", Buffer.alloc(1024, 0x55)),
  ]);
}

// ---------- MP3（ID3v2.3） ----------
function buildMp3() {
  const frame = (id, text) => {
    const content = Buffer.concat([Buffer.from([0x00]), Buffer.from(text, "latin1")]); // encoding 0
    const head = Buffer.alloc(10);
    head.write(id, 0, "ascii");
    head.writeUInt32BE(content.length, 4);
    return Buffer.concat([head, content]);
  };
  const frames = Buffer.concat([frame("TIT2", "fixture-tone"), frame("TPE1", "ftc")]);
  const size = frames.length;
  const tag = Buffer.alloc(10);
  tag.write("ID3", 0, "ascii");
  tag[3] = 3; // version 2.3
  tag[4] = 0;
  // syncsafe size
  tag[6] = (size >> 21) & 0x7f;
  tag[7] = (size >> 14) & 0x7f;
  tag[8] = (size >> 7) & 0x7f;
  tag[9] = size & 0x7f;
  // MPEG1 Layer3 44.1kHz 帧头 + 少量数据
  const mp3Frame = Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x00]), Buffer.alloc(256, 0x55)]);
  return Buffer.concat([tag, frames, mp3Frame]);
}

// ---------- WAV（真实可播放） ----------
function buildWav(seconds = 1, freq = 440) {
  const sampleRate = 8000;
  const samples = sampleRate * seconds;
  const dataSize = samples * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < samples; i++) {
    buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * freq * i) / sampleRate) * 6000), 44 + i * 2);
  }
  return buf;
}

// ---------- 写出 ----------
const pngPixel = Buffer.alloc(4);
pngPixel[0] = 138; pngPixel[1] = 90; pngPixel[2] = 60; pngPixel[3] = 255; // 皮革色 1x1

writeFileSync(path.join(outDir, "sample.jpg"), buildJpeg());
writeFileSync(path.join(outDir, "sample-exif.jpg"), buildJpeg([app1Exif(tiffAsciiExif("2026:08:10 09:30:00", null))]));
writeFileSync(path.join(outDir, "sample-exif-offset.jpg"), buildJpeg([app1Exif(tiffAsciiExif("2026:08:10 09:30:00", "+08:00"))]));
writeFileSync(path.join(outDir, "sample.png"), encodePng(1, 1, pngPixel));
writeFileSync(path.join(outDir, "sample.heic"), buildHeic("heic"));
writeFileSync(path.join(outDir, "sample.heif"), buildHeic("mif1"));
writeFileSync(
  path.join(outDir, "sample-exif.heic"),
  buildHeicWithExif("2026:08:15 09:00:00"),
);
writeFileSync(path.join(outDir, "sample.mov"), buildMov());
writeFileSync(path.join(outDir, "sample.m4a"), buildM4a());
writeFileSync(path.join(outDir, "sample.mp4"), buildMp4());
writeFileSync(path.join(outDir, "sample.mp3"), buildMp3());
writeFileSync(path.join(outDir, "sample.wav"), buildWav());
console.log("fixtures written to", outDir);
