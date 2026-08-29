import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 是原生模块，保持外部化，不打进服务端 bundle
  serverExternalPackages: ["better-sqlite3"],
  // 仅 Docker 镜像构建时启用 standalone 产物（docker/Dockerfile 会设置 BUILD_STANDALONE=1）。
  // 本地与 CI 保持默认输出，`next start`（Playwright webServer）完全受支持。
  ...(process.env.BUILD_STANDALONE === "1"
    ? { output: "standalone" as const }
    : {}),
};

export default nextConfig;
