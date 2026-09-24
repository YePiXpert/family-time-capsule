import { CameraView, useCameraPermissions } from "expo-camera";
import { useRef } from "react";
import { Linking, View } from "react-native";
import { Button, ErrorText, Text, useStyles } from "../local/ui";
/**
 * 扫加入二维码：只认 QR；同一张码只交一次，交出去以后由上层决定关掉还是再扫。
 * 没权限时说明用途再请求；被拒绝过就指去系统设置。
 */
export function Scanner({
  onScanned,
  size,
}: {
  onScanned: (text: string) => void;
  size: number;
}) {
  const s = useStyles();
  const [permission, request] = useCameraPermissions();
  const handled = useRef(false);
  if (!permission) return <Text style={s.muted}>正在打开相机…</Text>;
  if (!permission.granted)
    return (
      <View style={{ gap: 12 }}>
        <Text style={s.muted}>扫码要用相机，只用来认家人手机上的二维码，不拍照、不保存。</Text>
        {permission.canAskAgain ? (
          <Button title="允许使用相机" primary testID="family-camera-allow" onPress={() => void request()} />
        ) : (
          <>
            <ErrorText message="相机权限被关掉了。" />
            <Button title="去系统设置打开" onPress={() => void Linking.openSettings()} />
          </>
        )}
      </View>
    );
  return (
    <View
      style={{ width: size, height: size, borderRadius: 12, overflow: "hidden", alignSelf: "center" }}
      testID="family-scanner"
    >
      <CameraView
        style={{ flex: 1 }}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={({ data }) => {
          if (handled.current || typeof data !== "string") return;
          handled.current = true;
          onScanned(data);
        }}
      />
    </View>
  );
}
