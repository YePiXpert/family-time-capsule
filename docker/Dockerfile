# syntax=docker/dockerfile:1

FROM node:24-alpine AS deps
WORKDIR /app
# better-sqlite3 在 musl 上可能需要源码编译；装完构建依赖后卸载，保持层干净
RUN apk add --no-cache libc6-compat python3 make g++
COPY package.json package-lock.json ./
RUN npm ci && apk del python3 make g++

FROM node:24-alpine AS build
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# 触发 next.config.ts 中的 output: "standalone"
ENV BUILD_STANDALONE=1
RUN npm run build

FROM node:24-alpine AS runner
WORKDIR /app
# FFmpeg 是增强能力（视频封面/波形/转码），不是核心硬依赖（PRD §19）
RUN apk add --no-cache ffmpeg libc6-compat \
  && addgroup -S --gid 1001 nodejs \
  && adduser -S --uid 1001 --ingroup nodejs nextjs
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    DATA_DIR=/data \
    PORT=3000 \
    HOSTNAME=0.0.0.0
# /data：原件、衍生物、导出与 SQLite 数据库（PRD §11）。
# compose 将 named volume 挂载到这里，容器重建后数据仍在（自检 §26-10）。
RUN mkdir -p /data/originals /data/derivatives /data/exports \
  && chown -R nextjs:nodejs /data
USER nextjs
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public
# 运行时自动迁移需要 migration 文件（db/index.ts 在首次连接时执行）
COPY --from=build --chown=nextjs:nodejs /app/db/migrations ./db/migrations
EXPOSE 3000
CMD ["node", "server.js"]
