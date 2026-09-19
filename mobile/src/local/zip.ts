/**
 * 零依赖的流式 ZIP 写入器，给「开放归档」用。
 *
 * 只存不压（照片、视频本来就压过），文件名 UTF-8（bit 11），每条目带数据描述符
 * （bit 3）：素材边读边算 CRC32，只读一遍，内存里任何时刻只有一个分块。
 *
 * ZIP64 按需启用（条目 ≥ 4GiB、偏移 ≥ 4GiB、条目数 ≥ 65535 时），而不是一律写：
 * 主流工具（Java、Go、Info-ZIP）都是这么做的，macOS 归档实用工具、Windows 资源管理器
 * 对这种「小文件走经典结构」的归档兼容最好；真到几 GB 时再切 ZIP64。测试用
 * forceZip64 把两条路径都走一遍。
 */

const LOCAL_SIG = 0x04034b50;
const DESCRIPTOR_SIG = 0x08074b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
const ZIP64_EOCD_SIG = 0x06064b50;
const ZIP64_LOCATOR_SIG = 0x07064b50;
const FLAGS = 0x0808; // bit 3 数据描述符 + bit 11 UTF-8
const VERSION_CLASSIC = 20;
const VERSION_ZIP64 = 45;
const U32_MAX = 0xffffffff;
const U16_MAX = 0xffff;
/** 常规文件 0644，写进外部属性的高 16 位，Linux/macOS 解压后权限正常。 */
const EXTERNAL_ATTRS = (0o100644 << 16) >>> 0;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** 标准 CRC-32（IEEE），可分块累加：crc32(b, crc32(a)) === crc32(a+b)。 */
export function crc32(bytes: Uint8Array, previous = 0): number {
  let c = (previous ^ 0xffffffff) >>> 0;
  for (let i = 0; i < bytes.length; i++)
    c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

type Entry = {
  name: Uint8Array;
  size: number;
  crc: number;
  offset: number;
  zip64: boolean;
  time: number;
  date: number;
};

/** DOS 时间戳：ZIP 只有 2 秒精度，1980 年以前没法表示，一律按归档时刻。 */
function dosStamp(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

class Writer {
  private buf = new Uint8Array(64);
  private view = new DataView(this.buf.buffer);
  private at = 0;
  reset() {
    this.at = 0;
    return this;
  }
  private grow(n: number) {
    if (this.at + n <= this.buf.length) return;
    const next = new Uint8Array(Math.max(this.buf.length * 2, this.at + n));
    next.set(this.buf);
    this.buf = next;
    this.view = new DataView(next.buffer);
  }
  u16(v: number) {
    this.grow(2);
    this.view.setUint16(this.at, v, true);
    this.at += 2;
    return this;
  }
  u32(v: number) {
    this.grow(4);
    this.view.setUint32(this.at, v >>> 0, true);
    this.at += 4;
    return this;
  }
  u64(v: number) {
    this.grow(8);
    this.view.setBigUint64(this.at, BigInt(v), true);
    this.at += 8;
    return this;
  }
  bytes(b: Uint8Array) {
    this.grow(b.length);
    this.buf.set(b, this.at);
    this.at += b.length;
    return this;
  }
  take(): Uint8Array {
    return this.buf.slice(0, this.at);
  }
}

export type ZipSink = (bytes: Uint8Array) => void;
export type ZipChunkReader = () =>
  | Uint8Array
  | null
  | Promise<Uint8Array | null>;

export class ZipWriter {
  private entries: Entry[] = [];
  private written = 0;
  private finished = false;
  private readonly stamp: { time: number; date: number };
  private readonly force: boolean;
  private readonly w = new Writer();
  private readonly encoder = new TextEncoder();
  constructor(
    private readonly sink: ZipSink,
    options: { forceZip64?: boolean; now?: Date } = {},
  ) {
    this.force = !!options.forceZip64;
    this.stamp = dosStamp(options.now ?? new Date());
  }
  /** 已写出的字节数。 */
  get bytesWritten() {
    return this.written;
  }
  private emit(bytes: Uint8Array) {
    if (!bytes.length) return;
    this.sink(bytes);
    this.written += bytes.length;
  }
  private begin(path: string, size: number): Entry {
    if (this.finished) throw new Error("归档已经收尾。");
    const clean = path.replace(/\\/g, "/").replace(/^\/+/, "");
    if (!clean || clean.split("/").some((p) => p === "" || p === ".." || p === "."))
      throw new Error(`归档路径无效：${path}`);
    const name = this.encoder.encode(clean);
    if (name.length > U16_MAX) throw new Error(`归档路径过长：${path}`);
    const entry: Entry = {
      name,
      size,
      crc: 0,
      offset: this.written,
      zip64: this.force || size >= U32_MAX || this.written >= U32_MAX,
      ...this.stamp,
    };
    const w = this.w
      .reset()
      .u32(LOCAL_SIG)
      .u16(entry.zip64 ? VERSION_ZIP64 : VERSION_CLASSIC)
      .u16(FLAGS)
      .u16(0) // store
      .u16(entry.time)
      .u16(entry.date)
      .u32(0) // CRC 在数据描述符里
      .u32(entry.zip64 ? U32_MAX : size)
      .u32(entry.zip64 ? U32_MAX : size)
      .u16(name.length)
      .u16(entry.zip64 ? 20 : 0)
      .bytes(name);
    if (entry.zip64) w.u16(0x0001).u16(16).u64(size).u64(size);
    this.emit(w.take());
    return entry;
  }
  private end(entry: Entry) {
    const w = this.w.reset().u32(DESCRIPTOR_SIG).u32(entry.crc);
    if (entry.zip64) w.u64(entry.size).u64(entry.size);
    else w.u32(entry.size).u32(entry.size);
    this.emit(w.take());
    this.entries.push(entry);
  }
  addBytes(path: string, bytes: Uint8Array) {
    const entry = this.begin(path, bytes.length);
    entry.crc = crc32(bytes);
    this.emit(bytes);
    this.end(entry);
  }
  addText(path: string, text: string) {
    this.addBytes(path, this.encoder.encode(text));
  }
  /** 分块写入一个已知长度的条目；read 返回 null 表示读完。长度对不上就报错，不写坏归档。 */
  async addStream(path: string, size: number, read: ZipChunkReader) {
    const entry = this.begin(path, size);
    let total = 0;
    for (;;) {
      const chunk = await read();
      if (chunk === null) break;
      if (!chunk.length) continue;
      total += chunk.length;
      if (total > size) throw new Error(`归档条目比清单长：${path}`);
      entry.crc = crc32(chunk, entry.crc);
      this.emit(chunk);
    }
    if (total !== size) throw new Error(`归档条目比清单短：${path}`);
    this.end(entry);
  }
  /** 写中央目录与结尾记录。之后不能再加条目。 */
  finish() {
    if (this.finished) return;
    this.finished = true;
    const cdOffset = this.written;
    for (const e of this.entries) {
      const sizeField = e.zip64 ? U32_MAX : e.size;
      const offsetField = e.offset >= U32_MAX || this.force ? U32_MAX : e.offset;
      const extra = this.w.reset();
      if (e.zip64) extra.u64(e.size).u64(e.size);
      if (offsetField === U32_MAX) extra.u64(e.offset);
      const extraBody = extra.take();
      const w = this.w
        .reset()
        .u32(CENTRAL_SIG)
        .u16((3 << 8) | (e.zip64 ? VERSION_ZIP64 : VERSION_CLASSIC)) // 3 = UNIX
        .u16(extraBody.length ? VERSION_ZIP64 : VERSION_CLASSIC)
        .u16(FLAGS)
        .u16(0)
        .u16(e.time)
        .u16(e.date)
        .u32(e.crc)
        .u32(sizeField)
        .u32(sizeField)
        .u16(e.name.length)
        .u16(extraBody.length ? 4 + extraBody.length : 0)
        .u16(0) // comment
        .u16(0) // disk
        .u16(0) // internal attrs
        .u32(EXTERNAL_ATTRS)
        .u32(offsetField)
        .bytes(e.name);
      if (extraBody.length) w.u16(0x0001).u16(extraBody.length).bytes(extraBody);
      this.emit(w.take());
    }
    const cdSize = this.written - cdOffset;
    const count = this.entries.length;
    const needZip64 =
      this.force ||
      count >= U16_MAX ||
      cdSize >= U32_MAX ||
      cdOffset >= U32_MAX;
    if (needZip64) {
      const zip64Offset = this.written;
      this.emit(
        this.w
          .reset()
          .u32(ZIP64_EOCD_SIG)
          .u64(44) // 本记录剩余长度
          .u16((3 << 8) | VERSION_ZIP64)
          .u16(VERSION_ZIP64)
          .u32(0)
          .u32(0)
          .u64(count)
          .u64(count)
          .u64(cdSize)
          .u64(cdOffset)
          .take(),
      );
      this.emit(
        this.w
          .reset()
          .u32(ZIP64_LOCATOR_SIG)
          .u32(0)
          .u64(zip64Offset)
          .u32(1)
          .take(),
      );
    }
    this.emit(
      this.w
        .reset()
        .u32(EOCD_SIG)
        .u16(0)
        .u16(0)
        .u16(needZip64 ? U16_MAX : count)
        .u16(needZip64 ? U16_MAX : count)
        .u32(needZip64 ? U32_MAX : cdSize)
        .u32(needZip64 ? U32_MAX : cdOffset)
        .u16(0)
        .take(),
    );
  }
}
