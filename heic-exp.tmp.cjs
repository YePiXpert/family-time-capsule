// 实验：构造 exifr 可读 EXIF 的 HEIC
const fs = require("node:fs");
function box(type, payload) {
  const out = Buffer.alloc(8 + payload.length);
  out.writeUInt32BE(payload.length + 8, 0);
  out.write(type, 4, "ascii");
  payload.copy(out, 8);
  return out;
}
function fullBox(type, version, flags, payload) {
  const h = Buffer.from([version, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255]);
  return box(type, Buffer.concat([h, payload]));
}
function ftyp(major, minor, compat) {
  const b4 = (c) => { const b = Buffer.alloc(4); b.write(c.slice(0, 4).padEnd(4, " "), 0, "ascii"); return b; };
  const m = Buffer.alloc(4); m.writeUInt32BE(minor);
  return box("ftyp", Buffer.concat([b4(major), m, ...compat.map(b4)]));
}
function tiffAsciiExif(dateTimeOriginal) {
  const exifEntries = [{ tag: 0x9003, value: dateTimeOriginal }];
  const ifd0Size = 2 + 12 + 4;
  const exifIfdOffset = 8 + ifd0Size;
  const stringsOffset = exifIfdOffset + 2 + exifEntries.length * 12 + 4;
  const head = Buffer.alloc(8);
  head.write("II", 0, "ascii"); head.writeUInt16LE(0x2a, 2); head.writeUInt32LE(8, 4);
  const ifd0 = Buffer.alloc(ifd0Size);
  ifd0.writeUInt16LE(1, 0);
  ifd0.writeUInt16LE(0x8769, 2); ifd0.writeUInt16LE(4, 4);
  ifd0.writeUInt32LE(1, 6); ifd0.writeUInt32LE(exifIfdOffset, 10);
  const ifdExif = Buffer.alloc(2 + exifEntries.length * 12 + 4);
  ifdExif.writeUInt16LE(exifEntries.length, 0);
  let cursor = stringsOffset;
  exifEntries.forEach((e, i) => {
    const base = 2 + i * 12;
    ifdExif.writeUInt16LE(e.tag, base); ifdExif.writeUInt16LE(2, base + 2);
    ifdExif.writeUInt32LE(e.value.length + 1, base + 4);
    ifdExif.writeUInt32LE(cursor, base + 8);
    cursor += e.value.length + 1;
  });
  const strings = Buffer.concat(exifEntries.map((e) => { const b = Buffer.alloc(e.value.length + 1); b.write(e.value, 0, "ascii"); return b; }));
  return Buffer.concat([head, ifd0, ifdExif, strings]);
}

const hdlr = fullBox("hdlr", 0, 0, (() => {
  const b = Buffer.alloc(24);
  b.write("pict", 8, "ascii"); b.write("e", 16, "ascii");
  return b;
})());
const infe = fullBox("infe", 2, 0, (() => {
  const b = Buffer.alloc(11);
  b.writeUInt16BE(1, 0);          // item_ID
  b.writeUInt16BE(0, 2);          // protection
  b.write("Exif", 4, "ascii");    // item_type
  b.write("E\0", 8, "ascii");     // item_name
  return b;
})());
const iinf = fullBox("iinf", 0, 0, (() => {
  const c = Buffer.alloc(2); c.writeUInt16BE(1);
  return Buffer.concat([c, infe]);
})());
// iloc：extent_offset 占位 0，稍后回填
const ilocPayload = (() => {
  const b = Buffer.alloc(2 + 2 + 2 + 2 + 2 + 4 + 2 + 4 + 4);
  let o = 0;
  b.writeUInt8(0x44, o); o += 1;   // offset_size=4, length_size=4
  b.writeUInt8(0x40, o); o += 1;   // base_offset_size=4, index_size=0
  b.writeUInt16BE(1, o); o += 2;   // item_count
  b.writeUInt16BE(1, o); o += 2;   // item_ID
  b.writeUInt16BE(0, o); o += 2;   // data_reference_index
  b.writeUInt32BE(0, o); o += 4;   // base_offset
  b.writeUInt16BE(1, o); o += 2;   // extent_count
  b.writeUInt32BE(0, o); o += 4;   // extent_offset（占位）
  b.writeUInt32BE(0, o);           // extent_length（占位）
  return b;
})();
const iloc = fullBox("iloc", 0, 0, ilocPayload);
const meta = fullBox("meta", 0, 0, Buffer.concat([hdlr, iinf, iloc]));

const tiff = tiffAsciiExif("2026:08:15 09:00:00");
const exifItem = Buffer.concat([(() => { const b = Buffer.alloc(4); return b; })(), tiff]); // header_offset=0 + TIFF

const ftypBox = ftyp("heic", 0, ["heic", "mif1"]);
const mdat = box("mdat", Buffer.alloc(64, 0x22));
const prefix = Buffer.concat([ftypBox, meta, mdat]);
const exifOffset = prefix.length;
// 回填
const ilocNew = Buffer.from(iloc);
// iloc 是 fullBox：8 头 + 4 version/flags → payload 从 12 起；extent_offset 位于 payload 内 17..21
ilocNew.writeUInt32BE(exifOffset, 12 + 17);
ilocNew.writeUInt32BE(exifItem.length, 12 + 21);
const metaNew = fullBox("meta", 0, 0, Buffer.concat([hdlr, iinf, ilocNew]));
const final = Buffer.concat([ftypBox, metaNew, mdat, exifItem]);
fs.writeFileSync("heic-exif-exp.heic", final);
console.log("written, size", final.length);

const exifr = require("exifr");
exifr.parse(final, { pick: ["DateTimeOriginal"], reviveValues: false, tiff: true, exif: true })
  .then((r) => console.log("EXIF via pick:", JSON.stringify(r)))
  .catch((e) => console.log("pick err:", e.message));
exifr.parse(final, { reviveValues: false })
  .then((r) => console.log("EXIF default:", JSON.stringify(r)))
  .catch((e) => console.log("default err:", e.message));
