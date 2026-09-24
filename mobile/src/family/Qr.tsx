import qrcode from "qrcode-generator";
import { useMemo } from "react";
import { View } from "react-native";
import Svg, { Path, Rect } from "react-native-svg";
/** 模块矩阵：纯 JS 编码（纠错 M），一行一个布尔数组；导出给测试核对。 */
export function qrModules(text: string): boolean[][] {
  const qr = qrcode(0, "M");
  qr.addData(text, "Byte");
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, r) =>
    Array.from({ length: n }, (_, c) => qr.isDark(r, c)),
  );
}
/**
 * 加入二维码：白底黑块、四格静区，深色模式也不反色（相机认的是深块浅底）。
 * 读屏只说它是什么，不念里面的一次性秘密。
 */
export function Qr({ text, size }: { text: string; size: number }) {
  const { path, count } = useMemo(() => {
    const modules = qrModules(text);
    let d = "";
    modules.forEach((row, r) =>
      row.forEach((dark, c) => {
        if (dark) d += `M${c + 4} ${r + 4}h1v1h-1z`;
      }),
    );
    return { path: d, count: modules.length + 8 };
  }, [text]);
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel="加入家庭的二维码，请让管理者用桉桉成长记扫一扫"
      testID="family-qr"
      style={{ width: size, height: size, borderRadius: 12, overflow: "hidden" }}
    >
      <Svg width={size} height={size} viewBox={`0 0 ${count} ${count}`}>
        <Rect x={0} y={0} width={count} height={count} fill="#FFFFFF" />
        <Path d={path} fill="#000000" />
      </Svg>
    </View>
  );
}
