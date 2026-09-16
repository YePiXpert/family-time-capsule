import { useCallback, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import type { LocalMemoryEdit } from "./edit-model";
import { listMemoryEdits, subscribeMemoryEdits } from "./edit-store";
import { resumableMemoryEdits } from "./resumable-edits";

/** Follow local writes and receipts without starting a network request or upload. */
export function useResumableMemoryEdits(scope: string | null, enabled: boolean) {
  const [state, setState] = useState<{ scope: string; rows: LocalMemoryEdit[]; error: string | null }>();
  useFocusEffect(useCallback(() => {
    if (!scope || scope === "local" || !enabled) return;
    let active = true, request = 0;
    const read = () => {
      const currentRequest = ++request;
      void listMemoryEdits(scope).then(rows => {
        if (active && request === currentRequest) setState({ scope, rows: resumableMemoryEdits(rows, scope), error: null });
      }).catch(() => {
        if (active && request === currentRequest) setState({ scope, rows: [], error: "暂时无法读取未完成的补记，请稍后返回首页重试。" });
      });
    };
    const unsubscribe = subscribeMemoryEdits(read);
    read();
    return () => { active = false; unsubscribe(); };
  }, [scope, enabled]));
  return enabled && scope && scope !== "local" && state?.scope === scope ? state : null;
}
