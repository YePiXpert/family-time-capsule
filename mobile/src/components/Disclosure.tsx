import { Text } from "./typography";
import { useState, type ReactNode } from "react";
import { Pressable, View } from "react-native";
import { sharedStyles } from "../theme";

/** Mount tools only when requested; screen readers see the same expanded state. */
export function Disclosure({ title, children, open, onToggle }: { title: string; children: ReactNode; open?: boolean; onToggle?: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const visible = open ?? expanded;
  return <View style={{ gap: 12 }}>
    <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ expanded: visible }} onPress={onToggle ?? (() => setExpanded(value => !value))} style={sharedStyles.secondaryButton}>
      <Text style={sharedStyles.secondaryText}>{title} {visible ? "⌃" : "⌄"}</Text>
    </Pressable>
    {visible ? children : null}
  </View>;
}
