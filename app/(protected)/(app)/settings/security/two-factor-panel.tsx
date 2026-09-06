"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth/client";
import { renderQrDataUrlAction } from "./actions";

const inputClass =
  "rounded-lg border border-foreground/15 bg-transparent px-3 py-2 text-base outline-none transition-colors focus:border-accent";

type EnableDraft = {
  totpURI: string;
  backupCodes: string[];
};

/**
 * 两步验证（TOTP）面板：
 * 启用 = 密码 → 展示二维码/恢复码 → 输入动态码确认；
 * 恢复码只在启用与「重新生成」响应里出现一次，服务端只存加密列表。
 */
export function TwoFactorPanel({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [isOn, setIsOn] = useState(enabled);
  const [draft, setDraft] = useState<EnableDraft | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [freshCodes, setFreshCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function startEnable(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const { data, error } = await authClient.twoFactor.enable({ password });
    setPending(false);
    if (error || !data || !("totpURI" in data)) {
      setError("密码不正确，无法开始启用。");
      return;
    }
    const uri = data.totpURI;
    const backupCodes = data.backupCodes ?? [];
    setDraft({ totpURI: uri, backupCodes });
    setQrDataUrl(await renderQrDataUrlAction(uri));
  }

  async function confirmEnable(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) return;
    setError(null);
    setPending(true);
    const { error } = await authClient.twoFactor.verifyTotp({ code });
    setPending(false);
    if (error) {
      setError("动态码不正确，请确认验证器时间同步后再试。");
      return;
    }
    setIsOn(true);
    setDraft(null);
    setQrDataUrl(null);
    setPassword("");
    setCode("");
    setNotice("两步验证已开启；下次登录会要求输入动态码或恢复码。");
    router.refresh();
  }

  async function disable(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const { error } = await authClient.twoFactor.disable({ password });
    setPending(false);
    if (error) {
      setError("密码不正确，未能关闭两步验证。");
      return;
    }
    setIsOn(false);
    setPassword("");
    setNotice("两步验证已关闭，登录只保留密码一道门。");
    router.refresh();
  }

  async function regenerate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const { data, error } = await authClient.twoFactor.generateBackupCodes({
      password,
    });
    setPending(false);
    if (error || !data?.backupCodes) {
      setError("密码不正确，未能重新生成恢复码。");
      return;
    }
    setPassword("");
    setFreshCodes(data.backupCodes);
    setNotice(null);
  }

  return (
    <section aria-label="两步验证" className="mt-8 rounded-2xl border border-line bg-surface p-5 sm:p-6">
      <h2 className="text-lg font-medium">两步验证（验证器动态码）</h2>
      <p className="mt-1 text-sm leading-6 text-foreground/60">
        用 Google Authenticator、1Password、iOS 密码等验证器 App 生成 6 位动态码。
        开启后登录需要「密码 + 动态码」，恢复码用于验证器丢失时自救。
      </p>
      <p
        role="status"
        className="mt-3 text-sm font-medium"
      >
        当前状态：{isOn ? "已开启" : "未开启"}
      </p>
      {error ? (
        <p role="alert" className="mt-2 text-sm leading-6 text-red-700 dark:text-red-300">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="mt-2 text-sm leading-6 text-emerald-700 dark:text-emerald-300">
          {notice}
        </p>
      ) : null}

      {!isOn && !draft ? (
        <form onSubmit={startEnable} className="mt-4 flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            当前密码
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              className={inputClass}
            />
          </label>
          <button
            type="submit"
            disabled={pending}
            className="min-h-11 w-fit rounded-lg bg-foreground px-4 py-2 text-sm text-background transition-opacity disabled:opacity-50"
          >
            {pending ? "准备中…" : "开启两步验证"}
          </button>
        </form>
      ) : null}

      {draft ? (
        <div className="mt-4 flex flex-col gap-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            {qrDataUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={qrDataUrl}
                alt="验证器二维码"
                width={220}
                height={220}
                className="rounded-lg border border-foreground/10 bg-white p-2"
              />
            ) : null}
            <div className="flex-1">
              <p className="text-sm leading-6">
                1. 用验证器 App 扫描二维码（或手动输入密钥）。
              </p>
              <code className="mt-2 block max-w-md break-all rounded-lg border border-foreground/10 bg-foreground/[0.03] p-2 text-xs">
                {draft.totpURI}
              </code>
            </div>
          </div>
          <div className="rounded-xl border border-amber-700/30 bg-amber-500/10 p-4">
            <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
              2. 恢复码只显示这一次（共 {draft.backupCodes.length} 个）：
            </p>
            <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
              {draft.backupCodes.map((backupCode) => (
                <li key={backupCode} className="font-mono">
                  {backupCode}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs leading-5 text-amber-900/80 dark:text-amber-200/80">
              请抄写或存入密码管理器；每个恢复码只能使用一次，服务端不保存明文。
            </p>
          </div>
          <form onSubmit={confirmEnable} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm">
              3. 输入验证器当前显示的 6 位动态码确认开启
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/gu, "").slice(0, 8))}
                required
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="000000"
                className={`${inputClass} max-w-40 font-mono tracking-widest`}
              />
            </label>
            <button
              type="submit"
              disabled={pending || code.length < 6}
              className="min-h-11 w-fit rounded-lg bg-foreground px-4 py-2 text-sm text-background transition-opacity disabled:opacity-50"
            >
              {pending ? "验证中…" : "确认开启"}
            </button>
          </form>
        </div>
      ) : null}

      {isOn ? (
        <div className="mt-4 flex flex-col gap-4">
          <form onSubmit={disable} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm">
              关闭两步验证需确认当前密码
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                className={inputClass}
              />
            </label>
            <button
              type="submit"
              disabled={pending}
              className="min-h-11 w-fit rounded-lg border border-red-700/30 px-4 py-2 text-sm font-medium text-red-800 transition-colors hover:bg-red-500/10 disabled:opacity-50 dark:text-red-300"
            >
              {pending ? "处理中…" : "关闭两步验证"}
            </button>
          </form>
          <form onSubmit={regenerate} className="flex flex-col gap-3">
            <p className="text-sm text-foreground/60">
              恢复码遗失或已用掉大半时，重新生成一组（旧恢复码全部作废）。
            </p>
            <button
              type="submit"
              disabled={pending}
              className="min-h-11 w-fit rounded-lg border border-foreground/20 px-4 py-2 text-sm transition-colors hover:border-accent disabled:opacity-50"
            >
              {pending ? "生成中…" : "重新生成恢复码（需密码）"}
            </button>
          </form>
          {freshCodes ? (
            <div className="rounded-xl border border-amber-700/30 bg-amber-500/10 p-4">
              <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
                新恢复码（只显示这一次）：
              </p>
              <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
                {freshCodes.map((backupCode) => (
                  <li key={backupCode} className="font-mono">
                    {backupCode}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
