"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import type { PasskeyListItem } from "@/lib/auth/passkey-service";

const dateFormatter = new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" });

type PanelPasskey = Omit<PasskeyListItem, "createdAt" | "lastUsedAt"> & {
  createdAt: string | null;
  lastUsedAt: string | null;
};

async function postJson<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/auth${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  return (await response.json()) as T & { error?: string };
}

/**
 * 通行密钥（WebAuthn）面板：
 * 注册/移除都要求当前会话；登录入口在登录页。浏览器原生弹窗由系统
 * （iCloud 钥匙串/Windows Hello 等）完成，服务器只见到公钥与签名。
 */
export function PasskeyPanel({ initialPasskeys }: { initialPasskeys: PanelPasskey[] }) {
  const router = useRouter();
  const [passkeys, setPasskeys] = useState(initialPasskeys);
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function addPasskey() {
    setError(null);
    setNotice(null);
    setPending(true);
    try {
      const optionsResponse = await postJson<{
        options: Parameters<typeof startRegistration>[0]["optionsJSON"];
      }>("/passkey/register/options");
      if (!optionsResponse.options) {
        setError("无法开始注册：需要 HTTPS（本地 localhost 除外）且处于登录状态。");
        return;
      }
      const credential = await startRegistration({
        optionsJSON: optionsResponse.options,
      });
      const verified = await postJson<{ ok?: boolean }>("/passkey/register/verify", {
        credential,
        label: label.trim() || undefined,
      });
      if (!verified.ok) {
        setError("通行密钥注册未完成，请重试。");
        return;
      }
      setNotice("已添加通行密钥；下次登录可在登录页直接使用。");
      setLabel("");
      const refreshed = await fetch("/api/auth/passkey/list");
      const data = (await refreshed.json()) as { passkeys?: PanelPasskey[] };
      setPasskeys(data.passkeys ?? []);
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(
        /cancel|abort/i.test(message)
          ? "已取消注册。"
          : `注册失败：${message}`,
      );
    } finally {
      setPending(false);
    }
  }

  async function removePasskey(id: string) {
    setError(null);
    setNotice(null);
    setPending(true);
    const result = await postJson<{ ok?: boolean }>("/passkey/remove", { id });
    setPending(false);
    if (!result.ok) {
      setError("移除失败，请重试。");
      return;
    }
    setPasskeys((current) => current.filter((item) => item.id !== id));
    setNotice("已移除该通行密钥。");
    router.refresh();
  }

  return (
    <section aria-label="通行密钥" className="mt-8 rounded-2xl border border-line bg-surface p-5 sm:p-6">
      <h2 className="text-lg font-medium">通行密钥（面容 / 指纹 / 硬件钥匙）</h2>
      <p className="mt-1 text-sm leading-6 text-foreground/60">
        通行密钥绑定本实例域名，凭设备生物识别登录，不怕钓鱼、不依赖密码。
        每把钥匙可单独命名与移除；移除后已登录设备不受影响。
      </p>

      {passkeys.length === 0 ? (
        <p className="mt-3 text-sm text-foreground/50">还没有添加任何通行密钥。</p>
      ) : (
        <ul className="mt-4 flex flex-col gap-2">
          {passkeys.map((item) => (
            <li
              key={item.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-foreground/10 bg-foreground/[0.02] px-4 py-3 text-sm"
            >
              <div>
                <span className="font-medium">{item.label}</span>
                <span className="ml-2 text-foreground/50">
                  {item.backedUp ? "已同步" : "本机"}
                  {item.createdAt ? ` · 添加于 ${dateFormatter.format(new Date(item.createdAt))}` : ""}
                  {item.lastUsedAt
                    ? ` · 最近使用 ${dateFormatter.format(new Date(item.lastUsedAt))}`
                    : ""}
                </span>
              </div>
              <button
                type="button"
                onClick={() => void removePasskey(item.id)}
                disabled={pending}
                className="min-h-11 rounded-lg border border-red-700/30 px-3 py-1.5 text-xs font-medium text-red-800 transition-colors hover:bg-red-500/10 disabled:opacity-50 dark:text-red-300"
              >
                移除
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          名称（如「爸爸的手机」）
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={50}
            placeholder="通行密钥"
            className="rounded-lg border border-foreground/15 bg-transparent px-3 py-2 text-base outline-none transition-colors focus:border-accent"
          />
        </label>
        <button
          type="button"
          onClick={() => void addPasskey()}
          disabled={pending}
          className="min-h-11 rounded-lg bg-foreground px-4 py-2 text-sm text-background transition-opacity disabled:opacity-50"
        >
          {pending ? "等待系统弹窗…" : "添加通行密钥"}
        </button>
      </div>
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
    </section>
  );
}
