import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 原生模块保持外部化，不打进服务端 bundle
  serverExternalPackages: ["better-sqlite3", "exifr", "sharp"],
  // 仅 Docker 镜像构建时启用 standalone 产物（docker/Dockerfile 会设置 BUILD_STANDALONE=1）。
  // 本地与 CI 保持默认输出，`next start`（Playwright webServer）完全受支持。
  ...(process.env.BUILD_STANDALONE === "1"
    ? { output: "standalone" as const }
    : {}),
  // lib/export/service.ts import 了 package.json 读版本号——
  // standalone 产物按路由追踪文件，显式包含避免运行时缺文件
  outputFileTracingIncludes: {
    "/api/export": ["./package.json"],
  },
  async headers() {
    const commonSecurityHeaders = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "no-referrer" },
      {
        key: "Permissions-Policy",
        value:
          "camera=(self), microphone=(self), geolocation=(), browsing-topics=(), payment=(), usb=()",
      },
      { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
      { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
    ];
    return [
      { source: "/:path*", headers: commonSecurityHeaders },
      {
        source: "/api/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
          },
        ],
      },
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          {
            key: "Content-Security-Policy",
            value: "default-src 'self'; script-src 'self'; object-src 'none'",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
