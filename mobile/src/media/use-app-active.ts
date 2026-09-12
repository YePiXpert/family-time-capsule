import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

export function useAppActive(onBackground?: () => void) {
  const [active, setActive] = useState(AppState.currentState !== "background" && AppState.currentState !== "inactive");
  const background = useRef(onBackground);
  useEffect(() => { background.current = onBackground; }, [onBackground]);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      setActive(state === "active");
      if (state !== "active") background.current?.();
    });
    return () => subscription.remove();
  }, []);
  return active;
}
