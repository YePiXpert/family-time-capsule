import { useEffect } from "react";
import { AppState } from "react-native";
import { randomUUID } from "expo-crypto";
import { api, getToken } from "./client";
import { editorContext } from "./state";
import type { LocalStore } from "../local/store";
import type { SyncStatus } from "../local/context";
import {
  missingStoryYears,
  validStories,
  type YearStory,
} from "../local/stories";
import { toDayKey } from "../local/dates";

const pending = new WeakMap<LocalStore, Set<string>>();
export async function generateYearStory(
  store: LocalStore,
  year: string,
  replace = false,
  signal?: AbortSignal,
): Promise<void> {
  let jobs = pending.get(store);
  if (!jobs) {
    jobs = new Set();
    pending.set(store, jobs);
  }
  if (jobs.has(year)) throw new Error("这一年的故事正在整理，请稍候。");
  jobs.add(year);
  try {
    const state = store.get(),
      base = state.yearStories?.[year];
    if (base && !replace) return;
    if (Number(year) >= new Date().getFullYear())
      throw new Error("这一年还没有结束，先继续记录吧。");
    if (!(await getToken()))
      throw new Error("加入家庭后才能自动整理年度故事。");
    const records = Object.values(state.records).filter(
      (r) => r.title.trim() || r.text.trim(),
    );
    const { context, ids } = editorContext(year, records, state.media);
    const result = await api<{
      title: string;
      paragraphs: { text: string; records: string[] }[];
    }>(
      "/ai/write",
      { requestId: randomUUID(), writingMode: "story", context, photos: [] },
      "POST",
      signal,
    );
    if (signal?.aborted) return;
    const at = new Date().toISOString();
    if (!result || !Array.isArray(result.paragraphs))
      throw new Error("年度故事格式不完整，请重试。");
    const paragraphs = result.paragraphs.map((p) => ({
      text: p.text,
      recordIds: Array.isArray(p.records)
        ? p.records.map((id) =>
            /^[1-9]\d*$/.test(id) ? (ids[Number(id) - 1] ?? "") : "",
          )
        : [""],
    }));
    const story: YearStory = {
      title: result.title,
      paragraphs,
      generatedAt: at,
      updatedAt: at,
      ...(replace && base?.edited ? { edited: true } : {}),
    };
    if (
      !validStories({ [year]: story }) ||
      paragraphs.some(
        (p) => !p.recordIds.length || p.recordIds.some((id) => !id),
      )
    )
      throw new Error("年度故事引用了不存在的记录，请重试。");
    await store.change((next) => {
      if (signal?.aborted) return;
      if (next.yearStories?.[year] !== base)
        throw new Error("这一年的故事已有新修改，已保留家人的版本。");
      next.yearStories = { ...next.yearStories, [year]: story };
    });
  } finally {
    jobs.delete(year);
  }
}
/** Foreground only, after a successful sync, at most one automatic attempt per year per local day. */
export function useAnnualStories(
  store: LocalStore,
  sync: SyncStatus,
  locked: boolean,
): void {
  useEffect(() => {
    if (
      locked ||
      !sync.joined ||
      sync.running ||
      !sync.lastSyncAt ||
      sync.lastError
    )
      return;
    const controller = new AbortController();
    const onState = AppState.addEventListener("change", (value) => {
      if (value !== "active") controller.abort();
    });
    const run = async () => {
      const today = toDayKey(new Date());
      for (const year of missingStoryYears(store.get())) {
        if (
          controller.signal.aborted ||
          Number(year) >= new Date(sync.lastSyncAt!).getFullYear() ||
          store.get().settings.storyAttempts?.[year] === today
        )
          continue;
        await store.change((s) => {
          s.settings.storyAttempts = {
            ...s.settings.storyAttempts,
            [year]: today,
          };
        });
        try {
          await generateYearStory(store, year, false, controller.signal);
        } catch {
          /* Missing stories keep a visible manual retry in Memories. */
        }
      }
    };
    if (AppState.currentState === "active") void run().catch(() => undefined);
    return () => {
      controller.abort();
      onState.remove();
    };
  }, [
    store,
    sync.joined,
    sync.running,
    sync.lastSyncAt,
    sync.lastError,
    locked,
  ]);
}
