import { useCallback, useRef, useState } from "react";
import {
  useFocusEffect,
  useNavigation,
  usePreventRemove,
} from "@react-navigation/native";
import { useAppData } from "../state/AppContext";
import { draftReadingScope } from "../drafts/reading";
import { getWorkSession, saveWorkSession, type WorkSession } from "./store";
export function useWorkSession(scope: string, id: string) {
  const { credentials, userId, viewer, family } = useAppData();
  const current = draftReadingScope(
    credentials,
    userId,
    viewer?.id,
    family?.id,
  );
  const valid = scope === current || (scope === "local" && current !== null);
  const [state, setState] = useState<WorkSession | null>(null),
    [error, setError] = useState(""),
    [dirty, setDirty] = useState(false);
  const navigation = useNavigation();
  const ref = useRef<WorkSession | null>(null),
    writes = useRef(Promise.resolve()),
    queue = useRef(Promise.resolve());
  usePreventRemove(dirty, ({ data }) => {
    void writes.current
      .then(() => navigation.dispatch(data.action))
      .catch((e) => setError((e as Error).message));
  });
  useFocusEffect(
    useCallback(() => {
      let live = true;
      setState(null);
      ref.current = null;
      if (valid)
        void getWorkSession(scope, id)
          .then((row) => {
            if (live) {
              ref.current = row;
              setState(row);
            }
          })
          .catch((e) => {
            if (live) setError(e.message);
          });
      return () => {
        live = false;
      };
    }, [scope, id, valid]),
  );
  const update = useCallback(
    (transform: (row: WorkSession) => WorkSession) => {
      if (!ref.current || !valid) return Promise.resolve();
      let row: WorkSession;
      try {
        row = transform(ref.current);
      } catch (e) {
        setError((e as Error).message);
        return Promise.resolve();
      }
      ref.current = row;
      setState(row);
      setDirty(true);
      const next = queue.current.then(() => saveWorkSession(row));
      writes.current = next;
      const handled = next.then(
        () => {
          if (ref.current === row) {
            setDirty(false);
            setError("");
          }
        },
        (e) => setError((e as Error).message),
      );
      queue.current = handled;
      return handled;
    },
    [valid],
  );
  return {
    session: valid && state?.scope === scope && state?.id === id ? state : null,
    update,
    error,
    setError,
    valid,
    current,
    flush: () => writes.current,
  };
}
