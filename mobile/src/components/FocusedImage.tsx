import { useState } from "react";
import { Image, View, type ImageSourcePropType } from "react-native";
import { focusedImageFrame } from "../books/image-frame";

export function FocusedImage({ source, label, fit, focus = { x: 0.5, y: 0.5 } }: { source: ImageSourcePropType; label: string; fit: "contain" | "cover"; focus?: { x: number; y: number } }) {
  const [frameWidth, setFrameWidth] = useState(0);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const frame = fit === "cover" ? focusedImageFrame(size.width, size.height, frameWidth, 260, focus) : null;
  return <View style={{ width: "100%", height: 260, overflow: "hidden" }} onLayout={event => setFrameWidth(event.nativeEvent.layout.width)}>
    <Image source={source} accessibilityLabel={label} onLoad={event => setSize(event.nativeEvent.source)} resizeMode={frame ? "stretch" : fit} style={frame ? { position: "absolute", ...frame } : { width: "100%", height: 260 }} />
  </View>;
}
