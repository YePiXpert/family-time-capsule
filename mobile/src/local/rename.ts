/**
 * 一次性改名迁移：把上一版产品名留在磁盘上的目录、库文件与本机备份搬到新名字下。
 *
 * 三条规矩：
 * 1. 绝不覆盖新名字下已有的东西——同名冲突一律保留新的那份。
 * 2. 每一步各自独立 try：任何一步失败都保留旧名继续可用，绝不阻塞启动。
 * 3. 必须跑在开库与建目录之前。
 *
 * 新目录可能已经先被人建出来了：安卓收到分享意图时会直接往
 * `filesDir/<新名>/intake/` 里写，那一刻 JS 还没启动。所以目标存在时不是放弃，
 * 而是逐个子项搬过去合并。
 */
import { Directory, File, Paths } from "expo-file-system";
import {
  BACKUP_PREFIX,
  DOCS_DIR,
  LEGACY_BACKUP_PREFIX,
  LEGACY_DOCS_DIR,
  LEGACY_LIBRARY_FILE,
  LIBRARY_FILE,
} from "./brand";

function renameIfFree(from: File | Directory, to: File | Directory, name: string) {
  if (!from.exists || to.exists) return;
  from.rename(name);
}

/** 把 from 的内容并进已存在的 to：同名的留 to 那份，搬空了才删 from。 */
async function mergeInto(from: Directory, to: Directory): Promise<void> {
  for (const entry of from.list()) {
    if (entry instanceof Directory) {
      const existing = new Directory(to, entry.name);
      // move 到一个已存在的目录是「搬进去」，到不存在的目录才是「改名」。
      if (existing.exists) await mergeInto(entry, existing);
      else await entry.move(to);
    } else if (!new File(to, entry.name).exists) await entry.move(to);
  }
  // 还剩东西说明有同名冲突，留着让人能找回来，别删。
  if (from.list().length === 0) from.delete();
}

/** 返回失败摘要（成功时为空数组），由调用方记进本机健康。 */
export async function migrateLegacyNames(): Promise<string[]> {
  const failures: string[] = [];
  const step = async (what: string, run: () => void | Promise<void>) => {
    try {
      await run();
    } catch (e) {
      failures.push(
        `${what}改名失败：${e instanceof Error ? e.message : String(e)}`,
      );
    }
  };

  await step("文档目录", async () => {
    const legacy = new Directory(Paths.document, LEGACY_DOCS_DIR);
    if (!legacy.exists) return;
    const target = new Directory(Paths.document, DOCS_DIR);
    if (target.exists) await mergeInto(legacy, target);
    else legacy.rename(DOCS_DIR);
  });

  await step("本机库", () => {
    const sqlite = new Directory(Paths.document, "SQLite");
    if (!sqlite.exists) return;
    // 主库是 WAL 模式，-wal 里可能还压着已提交的事务：三个文件必须一起改名。
    for (const suffix of ["", "-wal", "-shm"])
      renameIfFree(
        new File(sqlite, LEGACY_LIBRARY_FILE + suffix),
        new File(sqlite, LIBRARY_FILE + suffix),
        LIBRARY_FILE + suffix,
      );
  });

  // 保留策略按名字里的时间戳排序，但旧前缀的字典序排在新前缀之后；一并改名，
  // 顺序才继续等于创建顺序。外部导出的备份不在这个目录里，不受影响。
  await step("本机备份", () => {
    const backups = new Directory(Paths.document, DOCS_DIR, "backups");
    if (!backups.exists) return;
    for (const entry of backups.list()) {
      if (!(entry instanceof File)) continue;
      if (!entry.name.startsWith(`${LEGACY_BACKUP_PREFIX}-`)) continue;
      if (!entry.name.endsWith(".xmb")) continue;
      const next = `${BACKUP_PREFIX}-${entry.name.slice(LEGACY_BACKUP_PREFIX.length + 1)}`;
      renameIfFree(entry, new File(backups, next), next);
    }
  });

  return failures;
}
