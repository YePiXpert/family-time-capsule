import type { Metadata, Viewport } from "next";
import { ServiceWorkerRegistrar } from "@/components/service-worker-registrar";
import { getDisplayMode } from "@/lib/display-mode.server";
import "./globals.css";

export const metadata: Metadata = {
  title: "Family Time Capsule · 家庭时间胶囊",
  description:
    "A private, self-hosted family memory archive. 随处记录，统一归档。",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "时间胶囊",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
};

// 移动端：禁缩放误触 + viewport-fit=cover 供 safe-area 使用
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf8f4" },
    { media: "(prefers-color-scheme: dark)", color: "#201d1a" },
  ],
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // 设备级显示偏好（标准/大字简洁）。在根布局读取可以避免任何闪烁；
  // 这只是 UI 密度选择，不影响权限，也让登录页等公共页保持一致缩放。
  const displayMode = await getDisplayMode();
  return (
    <html lang="zh-CN" className="h-full antialiased" data-display-mode={displayMode}>
      <body className="min-h-full flex flex-col">
        {children}
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
