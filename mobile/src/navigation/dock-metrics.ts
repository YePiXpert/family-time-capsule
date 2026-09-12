import { createContext, useContext, useEffect, useState } from "react";
import { Keyboard, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/** Actual navigation overlay height, including text scaling and the device safe area. */
export const JournalDockHeightContext = createContext(0);

/** Measured separately so switching to Capture never changes the tab-bar height. */
export const JournalCaptureActionHeightContext = createContext(64);
export const JournalKeyboardContext = createContext(false);

/** One keyboard subscription coordinates the dock and composer before iOS animates. */
export function useJournalKeyboardState() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow", event => {
      if (Platform.OS === "ios") Keyboard.scheduleLayoutAnimation(event);
      setOpen(true);
    });
    const hide = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide", event => {
      if (Platform.OS === "ios") Keyboard.scheduleLayoutAnimation(event);
      setOpen(false);
    });
    return () => { show.remove(); hide.remove(); };
  }, []);
  return open;
}

export function useJournalContentInset() {
  const dock = useContext(JournalDockHeightContext);
  const action = useContext(JournalCaptureActionHeightContext);
  return dock > 0 ? dock + action + 20 : 20;
}

/** Stack headers already own the top safe area; tab screens draw their own title. */
export function useJournalTitleInset() {
  const dock = useContext(JournalDockHeightContext);
  const insets = useSafeAreaInsets();
  return dock > 0 ? insets.top : 0;
}
