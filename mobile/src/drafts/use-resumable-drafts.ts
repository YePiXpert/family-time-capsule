import { useCallback, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { listLocalDrafts, type LocalDraft } from "./store";
import { resumableDrafts } from "./resumable";

/** Read on returning home; an old family's late result can never fill this row. */
export function useResumableDrafts(scope: string | null, enabled: boolean) {
  const [state, setState] = useState<{ scope: string; rows: LocalDraft[]; error: string | null }>();
  useFocusEffect(useCallback(() => {
    if (!scope || !enabled) return;
    let active = true;
    void listLocalDrafts(scope).then(rows => {
      if (active) setState({ scope, rows: resumableDrafts(rows, scope), error: null });
    }).catch(() => {
      if (active) setState({ scope, rows: [], error: "暂时无法读取未完成记录" });
    });
    return () => { active = false; };
  }, [scope, enabled]));
  return enabled && scope && state?.scope === scope ? state : null;
}
