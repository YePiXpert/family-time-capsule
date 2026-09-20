import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { statfs } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { once } from 'node:events';
import { finished } from 'node:stream/promises';
import { Problem } from './store.ts';

/** 单个对象的硬上限：手机端每对象 ≤ 4 块 × 1 MiB 明文加封装，留一倍余量。 */
export const OBJECT_LIMIT = 8 * 1024 * 1024;
/** 磁盘剩余低于这个数就拒收：对象库是副本，不能把宿主机撑满连 SQLite 都写不进。 */
export const FREE_FLOOR = 5 * 1024 ** 3;
export const OBJECT_ID = /^[a-f0-9]{64}$/;
const MEMBER_ID = /^[a-f0-9-]{36}$/;
const PREFIX = (id: string) => id.slice(0, 2);

/**
 * 成员各自的密文对象库：`<root>/<memberId>/objects/<id 前两位>/<id>`。
 * 文件系统就是事实来源（have／status／prune 都 stat 文件），临时文件写在同一文件系统的
 * `<root>/tmp/` 里，收完、长度与哈希都对了才 rename 到位。服务端看不到明文、密钥与文件名。
 */
export class BackupStore {
  readonly root: string;
  constructor(root: string) {
    this.root = root;
    mkdirSync(join(root, 'tmp'), { recursive: true });
  }
  private memberDir(memberId: string) {
    if (!MEMBER_ID.test(memberId)) throw new Problem(400, 'INVALID_INPUT', '成员标识无效。');
    return join(this.root, memberId, 'objects');
  }
  objectPath(memberId: string, id: string) {
    if (!OBJECT_ID.test(id)) throw new Problem(400, 'INVALID_INPUT', '对象标识无效。');
    return join(this.memberDir(memberId), PREFIX(id), id);
  }
  /** 对象存在时返回字节数，否则 null。 */
  stat(memberId: string, id: string): number | null {
    try {
      const s = statSync(this.objectPath(memberId, id));
      return s.isFile() ? s.size : null;
    } catch {
      return null;
    }
  }
  have(memberId: string, ids: string[]): Set<string> {
    const present = new Set<string>();
    for (const id of ids) if (this.stat(memberId, id) !== null) present.add(id);
    return present;
  }
  /**
   * 边收边算 sha256、边计数。超过上限不再落盘但把请求体读完，好让 413 能送到客户端；
   * 声明长度、实际长度、密文哈希三者任一对不上都整份丢弃。已存在的对象重传视为成功（created=false），
   * 但配额按「比原来多出的字节」算：对象 id 是手机按内容派生的，服务端认不出同 id 换了内容，不能因为 id 在就免检。
   */
  async receive(
    memberId: string,
    id: string,
    stream: AsyncIterable<Buffer | Uint8Array>,
    options: { declared?: number; sha256: string; limit?: number; quotaLeft?: number },
  ): Promise<{ bytes: number; created: boolean }> {
    const target = this.objectPath(memberId, id);
    const limit = options.limit ?? OBJECT_LIMIT;
    const temp = join(this.root, 'tmp', `${randomUUID()}.part`);
    const out = createWriteStream(temp);
    let writeError: Error | null = null;
    out.on('error', (e) => { writeError = e; });
    const hash = createHash('sha256');
    let bytes = 0, overflow = false;
    try {
      for await (const chunk of stream) {
        if (writeError) throw writeError;
        if (overflow) continue;
        bytes += chunk.length;
        if (bytes > limit) { overflow = true; continue; }
        hash.update(chunk);
        if (!out.write(chunk)) await once(out, 'drain');
      }
      out.end();
      await finished(out);
      if (overflow) throw new Problem(413, 'TOO_LARGE', '这一份太大，请更新应用后重试。');
      if (!bytes) throw new Problem(400, 'OBJECT_CORRUPT', '上传内容为空。');
      if (options.declared !== undefined && options.declared !== bytes) throw new Problem(400, 'OBJECT_CORRUPT', '上传内容不完整，请重试。');
      if (hash.digest('hex') !== options.sha256) throw new Problem(400, 'OBJECT_CORRUPT', '上传内容校验失败，请重试。');
      const previous = this.stat(memberId, id);
      if (options.quotaLeft !== undefined && bytes - (previous ?? 0) > options.quotaLeft) throw new Problem(413, 'QUOTA_FULL', '远端备份空间已用完，请联系主人调整。');
      mkdirSync(dirname(target), { recursive: true });
      renameSync(temp, target);
      return { bytes, created: previous === null };
    } catch (e) {
      out.destroy();
      rmSync(temp, { force: true });
      throw e;
    }
  }
  read(memberId: string, id: string): { stream: ReturnType<typeof createReadStream>; size: number } | null {
    const size = this.stat(memberId, id);
    if (size === null) return null;
    return { stream: createReadStream(this.objectPath(memberId, id)), size };
  }
  /** 全部对象：id、字节、最后修改时间；目录不存在就是空库。 */
  list(memberId: string): { id: string; bytes: number; mtimeMs: number }[] {
    const dir = this.memberDir(memberId);
    const rows: { id: string; bytes: number; mtimeMs: number }[] = [];
    let prefixes: string[];
    try { prefixes = readdirSync(dir); } catch { return rows; }
    for (const prefix of prefixes) {
      let names: string[];
      try { names = readdirSync(join(dir, prefix)); } catch { continue; }
      for (const name of names) {
        if (!OBJECT_ID.test(name) || PREFIX(name) !== prefix) continue;
        try {
          const s = statSync(join(dir, prefix, name));
          if (s.isFile()) rows.push({ id: name, bytes: s.size, mtimeMs: s.mtimeMs });
        } catch { /* 并发删除：跳过 */ }
      }
    }
    return rows;
  }
  usage(memberId: string): { objects: number; bytes: number } {
    const rows = this.list(memberId);
    return { objects: rows.length, bytes: rows.reduce((n, r) => n + r.bytes, 0) };
  }
  /**
   * 只删「不在 keep 里且创建超过 graceMs」的对象：正在上传中的新对象不会被并发的 prune 误伤。
   * 路由会把当前清单登记的对象并进 keep，所以客户端给错、给漏 keep 也删不掉清单指向的东西。
   */
  prune(memberId: string, keep: Set<string>, now = Date.now(), graceMs = 3600000): { removed: number; bytes: number } {
    let removed = 0, bytes = 0;
    for (const row of this.list(memberId)) {
      if (keep.has(row.id) || row.mtimeMs > now - graceMs) continue;
      rmSync(this.objectPath(memberId, row.id), { force: true });
      removed++; bytes += row.bytes;
    }
    return { removed, bytes };
  }
  wipe(memberId: string) {
    this.memberDir(memberId);
    rmSync(join(this.root, memberId), { recursive: true, force: true });
  }
  /** 清掉没收完的临时文件。启动时传 0：监听前不可能有上传在途，留着的全是上次崩溃的残骸。 */
  sweepTemp(olderThanMs = 3600000, now = Date.now()) {
    const dir = join(this.root, 'tmp');
    for (const name of readdirSync(dir)) {
      const file = join(dir, name);
      try { if (statSync(file).mtimeMs < now - olderThanMs) rmSync(file, { force: true }); } catch { /* 已被别人清掉 */ }
    }
  }
  async freeBytes(): Promise<number> {
    const s = await statfs(this.root);
    return Number(s.bavail) * Number(s.bsize);
  }
}
