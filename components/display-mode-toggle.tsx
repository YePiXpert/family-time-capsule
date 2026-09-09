"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { DISPLAY_MODE_COOKIE, type DisplayMode } from "@/lib/display-mode";

/**
 * 标准显示 / 大字显示的设备级切换。
 * 只写一个非敏感 cookie 并刷新当前路由；服务端各页按 cookie 渲染，
 * 不存在闪烁，也不改动任何权限。
 */
export function DisplayModeToggle({ mode }: { mode: DisplayMode }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function switchTo(target: DisplayMode) {
    if (target === mode) return;
    document.cookie = `${DISPLAY_MODE_COOKIE}=${target}; path=/; max-age=31536000; samesite=lax`;
    startTransition(() => router.refresh());
  }

  return (
    <div
      role="group"
      aria-label="显示方式"
      className="flex flex-wrap items-center gap-2"
    >
      <button
        type="button"
        aria-pressed={mode === "standard"}
        onClick={() => switchTo("standard")}
        className={mode === "standard" ? "ui-button-primary" : "ui-button-secondary"}
        disabled={pending}
      >
        标准显示
      </button>
      <button
        type="button"
        aria-pressed={mode === "simple"}
        onClick={() => switchTo("simple")}
        className={mode === "simple" ? "ui-button-primary" : "ui-button-secondary"}
        disabled={pending}
      >
        大字显示
      </button>
      <span className="text-sm text-muted">只影响这一台设备</span>
    </div>
  );
}

/** 简洁模式里常驻的「返回标准显示」按钮（不依赖设置页深链）。 */
export function ReturnToStandardButton({ mode }: { mode: DisplayMode }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  if (mode !== "simple") return null;
  return (
    <button
      type="button"
      className="ui-button-secondary"
      disabled={pending}
      onClick={() => {
        document.cookie = `${DISPLAY_MODE_COOKIE}=standard; path=/; max-age=31536000; samesite=lax`;
        startTransition(() => router.refresh());
      }}
    >
      返回标准显示
    </button>
  );
}
