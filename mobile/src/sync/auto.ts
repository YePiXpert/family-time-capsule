import { useEffect } from "react";
import { AppState } from "react-native";
import { getToken } from "../ai/session";
import { messageOf } from "../local/errors";
import type { Library } from "../local/model";
import type { LocalStore } from "../local/store";
import { runFamilySync } from "./family";
import { loadKey, readRemoteState, writeRemoteState } from "./state";
import { claimSync, isLocalBusy, isSyncRunning, markSyncRunning } from "./status";
import { createTransport, SyncError } from "./transport";

export type AutoSyncDeps = {
  store: LocalStore;
  run: (signal: AbortSignal) => Promise<unknown>;
  ready: () => Promise<boolean>;
  isBusy: () => boolean;
  onError: (error: unknown) => void | Promise<void>;
  setTimeout?: typeof setTimeout;
  clearTimeout?: typeof clearTimeout;
  debounceMs?: number;
};

/** 只管排期与互斥：不读文件、不联网，也不依赖 React 的生命周期。 */
export function createAutoSync(deps: AutoSyncDeps) {
  const later = deps.setTimeout ?? setTimeout;
  const cancel = deps.clearTimeout ?? clearTimeout;
  const delay = deps.debounceMs ?? 30_000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  let running = false;
  // 同步进行中、取定上传那一版之后又有改动：这一轮带不走，结束后补排一轮。
  let dirty = false;
  let foreground = true;
  let disposed = false;
  const clearTimer = () => {
    if (timer !== undefined) cancel(timer);
    timer = undefined;
  };
  const schedule = () => {
    clearTimer();
    timer = later(() => {
      timer = undefined;
      void attempt(true);
    }, delay);
  };
  const attempt = async (saved: boolean) => {
    if (disposed || !foreground) return;
    if (controller || deps.isBusy()) {
      if (saved) schedule();
      return;
    }
    // 就绪检查也占住本轮，避免两个异步检查同时通过；后台可取消尚未开始的同步。
    const current = new AbortController();
    controller = current;
    try {
      if (!(await deps.ready()) || current.signal.aborted) return;
      if (deps.isBusy()) {
        if (saved) schedule();
        return;
      }
      running = true;
      await deps.run(current.signal);
    } catch (e) {
      if (!(e && typeof e === "object" && "code" in e && e.code === "CANCELED")) {
        try {
          // 写错误本身也可能失败（例如磁盘满）：自动任务始终静默结束。
          await deps.onError(e);
        } catch {
          // 下次触发仍可重试。
        }
      }
    } finally {
      running = false;
      controller = undefined;
      if (dirty && !disposed && foreground) {
        dirty = false;
        schedule();
      }
    }
  };
  const onBackground = () => {
    foreground = false;
    clearTimer();
    controller?.abort();
  };
  return {
    onForeground() {
      if (disposed) return;
      foreground = true;
      void attempt(false);
    },
    onBackground,
    onLibraryChange() {
      if (disposed || !foreground) return;
      if (running) dirty = true;
      else schedule();
    },
    /** 这一轮已取定要上传的库：之前的改动（含本轮合并写入）都在里面。 */
    snapshotTaken() {
      dirty = false;
    },
    dispose() {
      disposed = true;
      onBackground();
    },
  };
}

const sharedFields = [
  "records", "letters", "albums", "series", "persons", "profile",
  "yearNotes", "yearCovers", "yearPicks", "yearBooksBoundAt", "tombstones",
] as const;
export function sharedChanged(prev: Library, next: Library): boolean {
  return sharedFields.some((field) => prev[field] !== next[field]);
}

/** App 根部接线，应用锁不影响同步；所有传输仍由 transport 执行。 */
export function useAutoSync(store: LocalStore): void {
  useEffect(() => {
    const auto = createAutoSync({
      store,
      ready: async () => {
        try {
          if (!(await getToken())) return false;
          const state = await readRemoteState();
          return !!(state?.enabled && state.autoSync && (await loadKey()));
        } catch {
          return false;
        }
      },
      isBusy: () => isSyncRunning() || isLocalBusy(),
      run: async (signal) => {
        if (!claimSync()) return;
        try {
          const key = await loadKey();
          if (!key || signal.aborted) return;
          await runFamilySync(store, {
            transport: createTransport(),
            key,
            signal,
            onSnapshot: () => auto.snapshotTaken(),
          });
        } finally {
          markSyncRunning(false);
        }
      },
      onError: async (error) => {
        if (error instanceof SyncError && ["NETWORK", "TIMEOUT", "INCOMPLETE"].includes(error.code)) return;
        const state = await readRemoteState();
        if (state) writeRemoteState({ ...state, lastError: messageOf(error) });
      },
    });
    let previous = store.get();
    const unsubscribe = store.subscribe(() => {
      const next = store.get();
      const changed = sharedChanged(previous, next);
      previous = next;
      if (changed) auto.onLibraryChange();
    });
    const startup = setTimeout(() => {
      if (AppState.currentState === "active") auto.onForeground();
    }, 2_000);
    if (AppState.currentState === "background") auto.onBackground();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        clearTimeout(startup);
        auto.onForeground();
      } else if (state === "background") {
        clearTimeout(startup);
        auto.onBackground();
      }
    });
    return () => {
      clearTimeout(startup);
      subscription.remove();
      unsubscribe();
      auto.dispose();
    };
  }, [store]);
}
