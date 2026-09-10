import { headers } from "next/headers";
import { journalColors, journalDarkColors, journalType, journalSpace, journalRadius } from "@/mobile/src/design/tokens";
import type { Metadata, Viewport } from "next";
import { ServiceWorkerRegistrar } from "@/components/service-worker-registrar";
import { getDisplayMode } from "@/lib/display-mode.server";
import "./globals.css";

export const metadata: Metadata = {
  title: "小美成长记",
  description:
    "留下照片、声音和想对你说的话，慢慢写成送给你的成长礼物。",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "成长记",
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
    { media: "(prefers-color-scheme: light)", color: journalColors.paper },
    { media: "(prefers-color-scheme: dark)", color: journalDarkColors.paper },
  ],
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // 设备级显示偏好（标准/大字简洁）。在根布局读取可以避免任何闪烁；
  // 这只是 UI 密度选择，不影响权限，也让登录页等公共页保持一致缩放。
  const displayMode = await getDisplayMode();
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const theme = [
    ...Object.entries(journalColors).map(([key, value]) => [`--journal-${key}`, value]),
    ...Object.entries(journalType).map(([key, value]) => [`--journal-type-${key}`, `${value / 16}rem`]),
    ...Object.entries(journalSpace).map(([key, value]) => [`--journal-space-${key}`, `${value / 16}rem`]),
    ...Object.entries(journalRadius).map(([key, value]) => [`--journal-radius-${key}`, `${value / 16}rem`]),
  ].map(([name, value]) => `${name}:${value}`).join(";");
  const darkTheme = Object.entries(journalDarkColors)
    .map(([key, value]) => `--journal-${key}:${value}`)
    .join(";");
  return (
    <html lang="zh-CN" className="h-full antialiased" data-display-mode={displayMode}>
      <head><style nonce={nonce}>{`:root{${theme}}@media (prefers-color-scheme:dark){:root{${darkTheme}}}`}</style></head>
      <body className="min-h-full flex flex-col">
        {children}
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
