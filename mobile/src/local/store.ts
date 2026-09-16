import { clone, emptyLibrary, validateLibrary, type Library } from "./model";
export interface LibraryDisk {
  read(): Promise<unknown | null>;
  write(state: Library): Promise<void>;
}
/** All mutations, including restore, use one queue. A failed write never advances UI state. */
export class LocalStore {
  private state: Library = emptyLibrary();
  private queue: Promise<unknown> = Promise.resolve();
  private listeners = new Set<() => void>();
  constructor(private disk: LibraryDisk) {}
  async open() {
    const state = await this.disk.read();
    if (state !== null) {
      validateLibrary(state);
      this.state = state;
    } else await this.disk.write(this.state);
  }
  get = (): Library => this.state;
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  change = <T>(apply: (next: Library) => T | Promise<T>): Promise<T> => {
    const next = this.queue.then(async () => {
      const state = clone(this.state);
      const result = await apply(state);
      state.revision = this.state.revision + 1;
      validateLibrary(state);
      await this.disk.write(state);
      this.state = state;
      for (const fn of this.listeners) fn();
      return result;
    });
    this.queue = next.catch(() => {});
    return next;
  };
  flush = async () => {
    await this.queue;
  };
}
