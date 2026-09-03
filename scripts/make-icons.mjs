#!/usr/bin/env node
// 生成 PWA 图标（无图像库依赖）：暖纸底 + 皮革色「时间胶囊」椭圆 + 星点。
// 产出 public/icons/icon-192.png / icon-512.png / apple-touch-icon.png(180)
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "public", "icons");
mkdirSync(outDir, { recursive: true });

// ---- 最小 PNG 编码器（RGBA8，无滤波） ----
function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const byte of buf) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  // 每行前加 filter byte 0
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---- 绘制 ----
const BG = [250, 248, 244]; // 暖纸色
const CAPSULE = [138, 90, 60]; // 皮革色
const DOT = [201, 161, 126]; // 浅皮色

function inRoundRect(x, y, cx, cy, hw, hh, r) {
  const dx = Math.abs(x - cx) - (hw - r);
  const dy = Math.abs(y - cy) - (hh - r);
  if (dx > r || dy > r) return false;
  if (dx <= 0 || dy <= 0) return true;
  return dx * dx + dy * dy <= r * r;
}

function inCircle(x, y, cx, cy, r) {
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function drawIcon(size, transparent = false) {
  const rgba = Buffer.alloc(size * size * 4);
  const S = size / 512; // 以 512 为基准的比例
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      let color = transparent ? [0, 0, 0, 0] : BG;
      // 胶囊主体：竖向圆角长条
      if (inRoundRect(x, y, size / 2, size / 2, 90 * S, 210 * S, 88 * S)) {
        color = CAPSULE;
      }
      // 胶囊分割线（纸色横线）
      if (inRoundRect(x, y, size / 2, size / 2, 90 * S, 210 * S, 88 * S) &&
          Math.abs(y - size / 2) < 7 * S) {
        color = transparent ? [0, 0, 0, 0] : BG;
      }
      // 上部星点
      if (inCircle(x, y, size / 2, size / 2 - 105 * S, 26 * S)) color = DOT;
      // 底部底座弧线
      if (inRoundRect(x, y, size / 2, size / 2 + 235 * S, 130 * S, 16 * S, 16 * S)) {
        color = DOT;
      }
      rgba[i] = color[0];
      rgba[i + 1] = color[1];
      rgba[i + 2] = color[2];
      rgba[i + 3] = color[3] ?? 255;
    }
  }
  return encodePng(size, size, rgba);
}

writeFileSync(path.join(outDir, "icon-192.png"), drawIcon(192));
writeFileSync(path.join(outDir, "icon-512.png"), drawIcon(512));
writeFileSync(path.join(root, "public", "apple-touch-icon.png"), drawIcon(180));
const mobileAssets = path.join(root, "mobile", "assets");
mkdirSync(mobileAssets, { recursive: true });
writeFileSync(path.join(mobileAssets, "icon.png"), drawIcon(1024));
writeFileSync(
  path.join(mobileAssets, "android-icon-background.png"),
  drawIcon(1024),
);
writeFileSync(
  path.join(mobileAssets, "android-icon-foreground.png"),
  drawIcon(1024, true),
);
writeFileSync(
  path.join(mobileAssets, "android-icon-monochrome.png"),
  drawIcon(1024, true),
);
writeFileSync(path.join(mobileAssets, "splash-icon.png"), drawIcon(1024, true));
console.log("icons written to public/icons/");
