"use client";

import { useEffect } from "react";

/** 注册离线壳 Service Worker（仅生产；开发时避免缓存干扰） */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // 注册失败不影响应用
    });
  }, []);
  return null;
}
