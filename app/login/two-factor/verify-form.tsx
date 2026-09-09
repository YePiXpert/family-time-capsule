"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth/client";

const inputClass =
  "rounded-lg border border-foreground/15 bg-transparent px-3 py-2 text-base outline-none transition-colors focus:border-accent";

/** 登录第二步：TOTP 动态码或恢复码（互斥单选）。 */
export function VerifyForm() {
  const [mode, setMode] = useState<"totp" | "backup">("totp");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const trimmed = code.trim();
    const { error: verifyError } =
      mode === "totp"
        ? await authClient.twoFactor.verifyTotp({ code: trimmed })
        : await authClient.twoFactor.verifyBackupCode({ code: trimmed });
    setPending(false);
    if (verifyError) {
      setError(
        mode === "totp"
          ? "动态码不正确或已过期，请确认验证器时间同步。"
          : "恢复码不正确或已使用过。",
      );
      return;
    }
    // 验证通过即建立会话；整页跳转确保新会话 cookie 在客户端状态之外生效
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = "/timeline";
  }

  return (
    <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-4">
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-red-800/30 bg-red-500/10 p-3 text-sm"
        >
          {error}
        </p>
      )}
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm">验证方式</legend>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="mode"
            checked={mode === "totp"}
            onChange={() => {
              setMode("totp");
              setCode("");
            }}
          />
          验证器动态码
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="mode"
            checked={mode === "backup"}
            onChange={() => {
              setMode("backup");
              setCode("");
            }}
          />
          恢复码
        </label>
      </fieldset>
      <label className="flex flex-col gap-1.5 text-sm">
        {mode === "totp" ? "动态码" : "恢复码"}
        <input
          value={code}
          onChange={(e) =>
            setCode(
              mode === "totp"
                ? e.target.value.replace(/\D/gu, "").slice(0, 8)
                : e.target.value.trim().slice(0, 64),
            )
          }
          required
          autoFocus
          inputMode={mode === "totp" ? "numeric" : "text"}
          autoComplete="one-time-code"
          placeholder={mode === "totp" ? "000000" : "xxxx-xxxx"}
          className={`${inputClass} font-mono tracking-widest`}
        />
      </label>
      <button
        type="submit"
        disabled={pending || code.length < (mode === "totp" ? 6 : 4)}
        className="mt-2 rounded-lg bg-foreground px-4 py-2.5 text-background transition-opacity disabled:opacity-50"
      >
        {pending ? "验证中…" : "验证并进入"}
      </button>
    </form>
  );
}
