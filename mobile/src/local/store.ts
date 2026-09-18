import {
  emptyLibrary,
  forkLibrary,
  freezeLibrary,
  normalizeLibrary,
  validateLibrary,
  type Library,
} from "./model";
export interface LibraryDisk {
  read(): Promise<unknown | null>;
  write(state: Library): Promise<void>;
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
    } else await this.disk.write(this.state);
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
      validateLibrary(state);
      try {
        await this.disk.write(state);
      } catch (e) {
        this.events.onWriteFailure?.(
          e instanceof Error ? e.message : String(e),
        );
        throw e;
      }
      freezeLibrary(state);
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
