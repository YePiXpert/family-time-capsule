import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

export function useAccessibleEffects() {
  const [reducedMotion, setMotion] = useState(true);
  const [reducedTransparency, setTransparency] = useState(true);
  useEffect(() => {
    let active = true;
    let motionChanged = false, transparencyChanged = false;
    const motion = AccessibilityInfo?.addEventListener?.("reduceMotionChanged", value => { motionChanged = true; setMotion(value); });
    const transparency = AccessibilityInfo?.addEventListener?.("reduceTransparencyChanged", value => { transparencyChanged = true; setTransparency(value); });
    void AccessibilityInfo?.isReduceMotionEnabled?.().then(value => { if (active && !motionChanged) setMotion(value); }).catch(() => {});
    void AccessibilityInfo?.isReduceTransparencyEnabled?.().then(value => { if (active && !transparencyChanged) setTransparency(value); }).catch(() => {});
    return () => { active = false; motion?.remove(); transparency?.remove(); };
  }, []);
  return { reducedMotion, reducedTransparency };
}
