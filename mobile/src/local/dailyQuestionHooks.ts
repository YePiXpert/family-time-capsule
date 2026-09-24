import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { randomUUID } from "expo-crypto";
import { api, getToken } from "../ai/client";
import { questionContext, recentQuestions } from "../ai/state";
import { ageLine, toDayKey } from "./dates";
import { compareDates, type Library } from "./model";
import type { LocalStore } from "./store";
import { dailyQuestionSource, requestDailyQuestion } from "./dailyQuestion";

// 同一个库即使同时有两个编辑页，也只能领取一次当天的请求。
const running = new WeakMap<LocalStore, Promise<void>>();
export function useDailyQuestion(store: LocalStore, state: Library, enabled: boolean) {
  const [today, setToday] = useState(() => toDayKey(new Date()));
  const [changedDay, setChangedDay] = useState<string | null>(null);
  useEffect(() => {
    const update = () => setToday(toDayKey(new Date()));
    const timer = setInterval(update, 60000);
    const listener = AppState.addEventListener("change", (next) => { if (next === "active") update(); });
    return () => { clearInterval(timer); listener.remove(); };
  }, []);
  useEffect(() => {
    if (!enabled || changedDay === today || running.has(store)) return;
    const job = requestDailyQuestion({
      today,
      getCache: () => store.get().settings.dailyQuestion,
      save: (cache) => store.change((s) => { s.settings.dailyQuestion = cache; }),
      getToken,
      request: () => {
        const current = store.get();
        return api("/ai/write", {
          requestId: randomUUID(), photos: [], writingMode: "question",
          context: questionContext({
            ageLabel: ageLine(current.profile.birthday)?.split(" · ")[0] ?? null,
            today,
            recent: Object.values(current.records).sort((a, b) => compareDates(b.date, a.date)).slice(0, 10).map(({ title, date }) => ({ title, date })),
            asked: recentQuestions(current.settings.dailyQuestion, today).map(({ question }) => question),
          }),
        }, "POST");
      },
    }).catch(() => { /* 本机无法保存尝试时，不访问服务。 */ }).finally(() => running.delete(store));
    running.set(store, job);
  }, [store, today, enabled, changedDay]);
  const source = dailyQuestionSource(state.settings.dailyQuestion, today, changedDay === today);
  return { source, question: source === "ai" ? state.settings.dailyQuestion?.question : undefined, useLocal: () => setChangedDay(today) };
}
