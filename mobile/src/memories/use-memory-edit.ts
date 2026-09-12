import { useEffect, useState, useSyncExternalStore } from "react";
import { getMemoryEdit, memoryEditsVersion, subscribeMemoryEdits } from "./edit-store";
import type { LocalMemoryEdit } from "./edit-model";

export function useMemoryEdit(scope: string | null, memoryId: string) {
  const version = useSyncExternalStore(subscribeMemoryEdits, memoryEditsVersion, memoryEditsVersion);
  const [snapshot, setSnapshot] = useState<{ scope: string | null; id: string; edit: LocalMemoryEdit | null; error: string | null } | null>(null);
  useEffect(() => {
    let active = true;
    void (scope ? getMemoryEdit(scope, memoryId) : Promise.resolve(null)).then(edit => {
      if (active) setSnapshot({ scope, id: memoryId, edit, error: null });
    }).catch(error => {
      if (active) setSnapshot({ scope, id: memoryId, edit: null, error: error instanceof Error ? error.message : "暂时无法读取本机修改。" });
    });
    return () => { active = false; };
  }, [scope, memoryId, version]);
  const current = snapshot && snapshot.scope === scope && snapshot.id === memoryId ? snapshot : null;
  return { edit: current?.edit ?? null, loading: !current, error: current?.error ?? null };
}
