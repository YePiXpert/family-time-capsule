import { createHash, randomUUID } from 'node:crypto';
import { closeSync, createReadStream, createWriteStream, existsSync, fstatSync, openSync, mkdirSync, readdirSync, readFileSync, writeFileSync, renameSync, rmSync, rmdirSync, lstatSync, statSync } from 'node:fs';
import { statfs } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { once } from 'node:events';
import { finished } from 'node:stream/promises';
import { Problem, type Store } from './store.ts';

/** 单个对象的硬上限：手机端每对象 ≤ 4 块 × 1 MiB 明文加封装，留一倍余量。 */
export const OBJECT_LIMIT = 8 * 1024 * 1024;
/** 磁盘剩余低于这个数就拒收：对象库是副本，不能把宿主机撑满连 SQLite 都写不进。 */
export const FREE_FLOOR = 5 * 1024 ** 3;
export const OBJECT_ID = /^[a-f0-9]{64}$/;
const MEMBER_ID = /^[a-f0-9-]{36}$/;
const PREFIX = (id: string) => id.slice(0, 2);
/** 家庭空间的目录名：一台服务就是一家人，对象不再按成员分目录。 */
export const FAMILY_DIR = 'family';

/**
 * 一家人共用的密文对象库：`<root>/family/objects/<id 前两位>/<id>`（Build 72 起；之前是 `<root>/<成员 id>/objects/`）。
 * 几台手机共用一把钥匙、各自发布清单，对象 id 按内容与钥匙派生，谁传上来的都是同一份。
 * 文件系统就是事实来源；用量在启动时重扫、之后随落盘增量维护。临时文件写在同一文件系统的
 * `<root>/tmp/` 里，收完、长度与哈希都对了才 rename 到位。服务端看不到明文、密钥与文件名。
 */
export class BackupStore {
  readonly root: string;
  private totals = { objects: 0, bytes: 0 };
  private generation: string | null = null;
  constructor(root: string) {
    this.root = root;
    mkdirSync(join(root, 'tmp'), { recursive: true });
    mkdirSync(this.spaceDir(), { recursive: true });
    this.recount();
  }
  private spaceDir() {
    return join(this.root, FAMILY_DIR, 'objects');
  }
  private readGeneration(): string | null {
    try { return readFileSync(join(this.root, '.usage-generation'), 'utf8'); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; }
  }
  /** CLI 清空与常驻服务共用这一标记；原子替换避免读到半份内容。 */
  private changeGeneration() {
    const temp = join(this.root, 'tmp', `${randomUUID()}.generation`);
    try {
      writeFileSync(temp, randomUUID(), { flag: 'wx', mode: 0o644 });
      renameSync(temp, join(this.root, '.usage-generation'));
    } finally { rmSync(temp, { force: true }); }
  }
  private refreshUsage() {
    if (this.readGeneration() !== this.generation) this.recount();
  }
  objectPath(id: string) {
    if (!OBJECT_ID.test(id)) throw new Problem(400, 'INVALID_INPUT', '对象标识无效。');
    return join(this.spaceDir(), PREFIX(id), id);
  }
  /** 对象存在时返回字节数，否则 null。 */
  stat(id: string): number | null {
    try {
      const s = statSync(this.objectPath(id));
      return s.isFile() ? s.size : null;
    } catch {
      return null;
    }
  }
  have(ids: string[]): Set<string> {
    const present = new Set<string>();
    for (const id of ids) if (this.stat(id) !== null) present.add(id);
    return present;
  }
  /**
   * 边收边算 sha256、边计数。超过上限不再落盘但把请求体读完，好让 413 能送到客户端；
   * 声明长度、实际长度、密文哈希三者任一对不上都整份丢弃。已存在的对象重传视为成功（created=false），
   * 配额仍按「比原来多出的字节」检查；校验通过后先到为准，重传只丢弃临时文件，不能覆盖原密文。
   */
  async receive(
    id: string,
    stream: AsyncIterable<Buffer | Uint8Array>,
    options: { declared?: number; sha256: string; limit?: number; quotaLeft?: number | (() => number); beforeCommit?: () => void },
  ): Promise<{ bytes: number; created: boolean }> {
    const target = this.objectPath(id);
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
      this.refreshUsage();
      if (overflow) throw new Problem(413, 'TOO_LARGE', '这一份太大，请更新应用后重试。');
      if (!bytes) throw new Problem(400, 'OBJECT_CORRUPT', '上传内容为空。');
      if (options.declared !== undefined && options.declared !== bytes) throw new Problem(400, 'OBJECT_CORRUPT', '上传内容不完整，请重试。');
      if (hash.digest('hex') !== options.sha256) throw new Problem(400, 'OBJECT_CORRUPT', '上传内容校验失败，请重试。');
      // 上传期间权限、家庭余量都可能变化；同步复核后立即落盘，不能夹入另一次上传。
      options.beforeCommit?.();
      const previous = this.stat(id);
      const quotaLeft = typeof options.quotaLeft === 'function' ? options.quotaLeft() : options.quotaLeft;
      if (quotaLeft !== undefined && bytes - (previous ?? 0) > quotaLeft) throw new Problem(413, 'QUOTA_FULL', '远端备份空间已用完，请联系管理者调整。');
      if (previous !== null) {
        rmSync(temp, { force: true });
        return { bytes, created: false };
      }
      mkdirSync(dirname(target), { recursive: true });
      renameSync(temp, target);
      this.totals.objects++;
      this.totals.bytes += bytes;
      return { bytes, created: previous === null };
    } catch (e) {
      out.destroy();
      rmSync(temp, { force: true });
      throw e;
    }
  }
  /** 先打开再取长度：打开之后别的手机的回收删了它，这次下载照样读完；打开前就没了就是 404。 */
  read(id: string): { stream: ReturnType<typeof createReadStream>; size: number } | null {
    let fd: number;
    try {
      fd = openSync(this.objectPath(id), 'r');
    } catch {
      return null;
    }
    const s = fstatSync(fd);
    if (!s.isFile()) {
      closeSync(fd);
      return null;
    }
    return { stream: createReadStream('', { fd }), size: s.size };
  }
  /** 全部对象：id、字节、最后修改时间；目录不存在就是空库。 */
  list(): { id: string; bytes: number; mtimeMs: number }[] {
    const dir = this.spaceDir();
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
  usage(): { objects: number; bytes: number } {
    this.refreshUsage();
    return { ...this.totals };
  }
  /** 直接搬动对象文件之后重扫；平时 usage 只核对标记，CLI 清空后才重扫。 */
  recount(): { objects: number; bytes: number } {
    const generation = this.readGeneration();
    const rows = this.list();
    this.totals = { objects: rows.length, bytes: rows.reduce((n, r) => n + r.bytes, 0) };
    // 扫描期间若另一进程又清空了，保留扫描前的标记，下次读取会再次校准。
    this.generation = generation;
    return { ...this.totals };
  }
  /**
   * 只删「不在 keep 里且最后修改超过 graceMs」的对象，一小时宽限是额外保护。
   * 调用方遇到任一未知登记的清单必须整轮停收；否则把全部清单引用与未过期的上传占位并进 keep。
   * 慢速首次上传依靠持久占位保护，不能只靠文件的修改时间。
   */
  prune(keep: Set<string>, now = Date.now(), graceMs = 3600000): { removed: number; bytes: number } {
    this.refreshUsage();
    let removed = 0, bytes = 0;
    for (const row of this.list()) {
      if (keep.has(row.id) || row.mtimeMs > now - graceMs) continue;
      try { rmSync(this.objectPath(row.id)); } catch (e) { this.recount(); throw e; }
      this.totals.objects--;
      this.totals.bytes -= row.bytes;
      removed++; bytes += row.bytes;
    }
    return { removed, bytes };
  }
  /** 清空整个家庭空间及上传占位：只给主人，且先删清单再来（见路由）。 */
  wipe(store:Store) {
    this.changeGeneration();
    try {
      rmSync(join(this.root, FAMILY_DIR), { recursive: true, force: true });
      mkdirSync(this.spaceDir(), { recursive: true });
      store.clearObjectClaims();
    } finally {
      // 删除中途失败也要通知常驻服务，以实际残留为准，不能把用量伪装成零。
      try { this.changeGeneration(); } finally { this.recount(); }
    }
  }
  /**
   * 一次性迁移（Build 72）：把 Build 70／71 按成员分的 `<root>/<成员 uuid>/objects/xx/<id>` 搬进家庭空间。
   * 同一文件系统内 rename；同 id 已在家庭空间就删源文件（id 按内容派生，两份一样）；只删搬空的成员目录，失败与不认识的文件保留并记数。
   * 幂等：再跑一次没有成员目录，什么也不发生。
   */
  migrateMemberSpaces(): { members: number; moved: number; duplicates: number; failed: number } {
    let members = 0, moved = 0, duplicates = 0, failed = 0;
    // 只删空目录；失败或不认识的文件必须原地保留，下一次启动还可以重试。
    const removeEmpty = (dir: string) => {
      try { rmdirSync(dir); return true; } catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') return true;
        if (code !== 'ENOTEMPTY' && code !== 'EEXIST') failed++;
        return false;
      }
    };
    try {
      let names: string[];
      try { names = readdirSync(this.root); } catch { failed++; return { members, moved, duplicates, failed }; }
      for (const name of names) {
        if (!MEMBER_ID.test(name)) continue;
        const memberDir = join(this.root, name);
        try { if (!lstatSync(memberDir).isDirectory()) { failed++; continue; } } catch { failed++; continue; }
        members++;
        const before = failed;
        const objects = join(memberDir, 'objects');
        let prefixes: string[] = [];
        try { prefixes = readdirSync(objects); } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== 'ENOENT') failed++;
        }
        for (const prefix of prefixes) {
          const prefixDir = join(objects, prefix);
          let files: string[];
          try {
            if (!lstatSync(prefixDir).isDirectory()) { failed++; continue; }
            files = readdirSync(prefixDir);
          } catch { failed++; continue; }
          for (const id of files) {
            if (!OBJECT_ID.test(id) || PREFIX(id) !== prefix) { failed++; continue; }
            const source = join(prefixDir, id), target = this.objectPath(id);
            try {
              if (!lstatSync(source).isFile()) { failed++; continue; }
              if (existsSync(target)) {
                if (this.stat(id) === null) { failed++; continue; }
                rmSync(source); duplicates++; continue;
              }
              mkdirSync(dirname(target), { recursive: true });
              renameSync(source, target);
              moved++;
            } catch { failed++; /* 单个对象失败不挡其他家人，源文件保留待下次重试。 */ }
          }
          removeEmpty(prefixDir);
        }
        removeEmpty(objects);
        if (!removeEmpty(memberDir) && failed === before) failed++;
      }
      return { members, moved, duplicates, failed };
    } finally {
      this.recount();
    }
  }
  /**
   * 清掉没收完的临时文件。启动时传 0：监听前不可能有上传在途，留着的全是上次崩溃的残骸，
   * 所以 0 宽限不看 mtime 一律删（mtime 有亚毫秒精度，刚写下的文件按「mtime < now」比会漏掉）。
   */
  sweepTemp(olderThanMs = 3600000, now = Date.now()) {
    const dir = join(this.root, 'tmp');
    for (const name of readdirSync(dir)) {
      const file = join(dir, name);
      try { if (olderThanMs <= 0 || statSync(file).mtimeMs < now - olderThanMs) rmSync(file, { force: true }); } catch { /* 已被别人清掉 */ }
    }
  }
  async freeBytes(): Promise<number> {
    const s = await statfs(this.root);
    return Number(s.bavail) * Number(s.bsize);
  }
}
