import {
  ENTITY_KINDS,
  diffLibrary,
  emptyLibrary,
  forkLibrary,
  freezeChanged,
  freezeLibrary,
  normalizeLibrary,
  validateChange,
  validateLibrary,
  type Library,
  type LibraryDelta,
} from "./model";
export interface LibraryDisk {
  read(): Promise<unknown | null>;
  /** delta 为 null 表示整库重写（首次落库、切代、恢复）。 */
  write(state: Library, delta: LibraryDelta | null): Promise<void>;
  /** read() 读到的是旧版整库快照时为 true：校验通过后整库重写一次完成切代。 */
  legacy?: boolean;
}
/** 本机健康采集点；全部可选，测试与无健康文件环境静默跳过。 */
export interface StoreEvents {
  onChange?: (ms: number) => void;
  onWriteFailure?: (message: string) => void;
}
/** All mutations, including restore, use one queue. A failed write never advances UI state. */
export class LocalStore {
  private state: Library = emptyLibrary();
  private queue: Promise<unknown> = Promise.resolve();
  private listeners = new Set<() => void>();
  constructor(
    private disk: LibraryDisk,
    private events: StoreEvents = {},
  ) {}
  async open() {
    const state = await this.disk.read();
    if (state !== null) {
      normalizeLibrary(state);
      validateLibrary(state);
      this.state = state;
      if (this.disk.legacy) await this.disk.write(this.state, null);
    } else await this.disk.write(this.state, null);
    freezeLibrary(this.state);
  }
  get = (): Library => this.state;
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  change = <T>(apply: (next: Library) => T | Promise<T>): Promise<T> => {
    const next = this.queue.then(async () => {
      const started = Date.now();
      // 工作副本与当前状态共享实体对象，所以实体只能整个替换（editEntity），
      // 不能原地改——共享的那一份已经冻结，原地改会当场抛错。
      const state = forkLibrary(this.state);
      const result = await apply(state);
      state.revision = this.state.revision + 1;
      const delta = diffLibrary(this.state, state);
      // 没动过的集合换回上一版的对象：引用不变，界面上按集合记忆的派生数据
      // （书架排序、足迹聚类）才不会因为改了一条草稿就整库重算。
      const touched = new Set(
        [...delta.changed, ...delta.removed].map((d) => d.kind),
      );
      for (const kind of ENTITY_KINDS)
        if (!touched.has(kind))
          (state as Record<string, unknown>)[kind] = this.state[kind];
      validateChange(state, delta);
      try {
        await this.disk.write(state, delta);
      } catch (e) {
        this.events.onWriteFailure?.(
          e instanceof Error ? e.message : String(e),
        );
        throw e;
      }
      freezeChanged(state, delta);
      this.state = state;
      for (const fn of this.listeners) fn();
      this.events.onChange?.(Date.now() - started);
      return result;
    });
    this.queue = next.catch(() => {});
    return next;
  };
  flush = async () => {
    await this.queue;
  };
}
