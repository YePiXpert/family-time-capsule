/** health.json 的原子落盘与防抖：part → move，失败即时写，平时 10 秒合并。 */
import { Directory, File, Paths } from "expo-file-system";
import { DOCS_DIR } from "./brand";
import {
  normalizeHealth,
  recordChange,
  recordDiskFailure,
  recordLaunch,
  type HealthStats,
} from "./health";

const FLUSH_DEBOUNCE_MS = 10000;

export class HealthFile {
  private stats: HealthStats = normalizeHealth(null);
  private loaded = false;
  private dirty = false;
  private moving = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  constructor(
    private directory: Directory,
    private file: File,
  ) {}
  /** 在健康事件开始前调用一次；失败从零开始，不阻塞主流程。 */
  async load(): Promise<void> {
    try {
      if (this.file.exists)
        this.stats = normalizeHealth(JSON.parse(await this.file.text()));
    } catch {
      this.stats = normalizeHealth(null);
    }
    this.loaded = true;
  }
  get(): HealthStats {
    return this.stats;
  }
  launch(ms: number) {
    this.stats = recordLaunch(this.stats, ms, new Date().toISOString());
    this.markDirty();
  }
  change(ms: number) {
    this.stats = recordChange(this.stats, ms);
    this.markDirty();
  }
  diskFailure(message: string) {
    this.stats = recordDiskFailure(
      this.stats,
      message,
      new Date().toISOString(),
    );
    // 失败本身就是信号，立即落盘，不等防抖。
    this.markDirty(false);
  }
  private markDirty(debounce = true) {
    this.dirty = true;
    if (!debounce) {
      void this.flush();
      return;
    }
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, FLUSH_DEBOUNCE_MS);
  }
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.dirty || this.moving || !this.loaded) return;
    this.moving = true;
    this.dirty = false;
    try {
      this.directory.create({ intermediates: true, idempotent: true });
      const part = new File(this.directory, "health.json.part");
      part.write(JSON.stringify(this.stats));
      await part.move(this.file, { overwrite: true });
    } catch {
      // 健康统计写不进去不能再打扰主流程；下次有事件再试。
      this.dirty = true;
    } finally {
      this.moving = false;
    }
  }
}

let singleton: HealthFile | null = null;
export function healthFile(): HealthFile {
  if (!singleton) {
    const directory = new Directory(Paths.document, DOCS_DIR);
    singleton = new HealthFile(directory, new File(directory, "health.json"));
  }
  return singleton;
}
