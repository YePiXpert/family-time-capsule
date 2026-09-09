import { createContext, forwardRef, useContext } from "react";
import { StyleSheet, Text as NativeText, TextInput as NativeTextInput, type TextProps, type TextInputProps, type TextStyle, type StyleProp } from "react-native";

export const TextScaleContext = createContext(1);
function scaledStyle(style: StyleProp<TextStyle>, scale: number): StyleProp<TextStyle> {
  if (scale === 1) return style;
  const flat = StyleSheet.flatten(style) ?? {};
  return [style, { fontSize: (flat.fontSize ?? 16) * scale, ...(flat.lineHeight ? { lineHeight: flat.lineHeight * scale } : {}) }];
}
export function Text({ style, ...props }: TextProps) {
  const scale = useContext(TextScaleContext);
  return <NativeText {...props} style={scaledStyle(style, scale)} />;
}
export type TextInput = NativeTextInput;
// eslint-disable-next-line @typescript-eslint/no-redeclare -- The component and its instance type intentionally share the React Native name.
export const TextInput = forwardRef<NativeTextInput, TextInputProps>(function ScaledInput({ style, ...props }, ref) {
  const scale = useContext(TextScaleContext);
  return <NativeTextInput {...props} ref={ref} style={scaledStyle(style, scale)} />;
});
