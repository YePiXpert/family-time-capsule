"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { startAuthentication } from "@simplewebauthn/browser";
import { authClient } from "@/lib/auth/client";

const inputClass =
  "rounded-lg border border-foreground/15 bg-transparent px-3 py-2 text-base outline-none transition-colors focus:border-accent";

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [passkeyPending, setPasskeyPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const data = new FormData(event.currentTarget);
    const { data: result, error } = await authClient.signIn.email({
      email: String(data.get("email") ?? ""),
      password: String(data.get("password") ?? ""),
    });
    if (error) {
      // 统一文案，不暴露账号是否存在（docs/SECURITY.md）
      setError("邮箱或密码不正确，请重试。");
      setPending(false);
      return;
    }
    if (result && "twoFactorRedirect" in result && result.twoFactorRedirect) {
      // 账号已开启两步验证：会话尚未建立，先完成第二步
      router.push("/login/two-factor");
      return;
    }
    router.push("/timeline");
    router.refresh();
  }

  async function signInWithPasskey() {
    setError(null);
    setPasskeyPending(true);
    try {
      const optionsResponse = await fetch("/api/auth/passkey/authenticate/options", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      const optionsData = (await optionsResponse.json()) as {
        options?: Parameters<typeof startAuthentication>[0]["optionsJSON"];
        challengeId?: string;
      };
      if (!optionsData.options || !optionsData.challengeId) {
        setError("此实例暂不能用通行密钥登录（需要 HTTPS 访问地址）。");
        return;
      }
      const credential = await startAuthentication({
        optionsJSON: optionsData.options,
      });
      const verifyResponse = await fetch("/api/auth/passkey/authenticate/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ challengeId: optionsData.challengeId, credential }),
      });
      if (!verifyResponse.ok) {
        setError("通行密钥验证未通过，请重试或改用密码登录。");
        return;
      }
      // 通行密钥会话由 Set-Cookie 下发；整页跳转确保 cookie 与客户端状态一致
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = "/timeline";
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/cancel|abort/i.test(message)) {
        setError("已取消通行密钥登录。");
      } else {
        setError(`通行密钥登录失败：${message}`);
      }
    } finally {
      setPasskeyPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-4">
      {error && (
        <p
          role="alert"
          className="inline-notice inline-notice-danger text-sm"
        >
          {error}
        </p>
      )}
      <label className="flex flex-col gap-1.5 text-sm">
        邮箱
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          className={inputClass}
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        密码
        <input
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className={inputClass}
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="mt-2 rounded-lg bg-foreground px-4 py-2.5 text-background transition-opacity disabled:opacity-50"
      >
        {pending ? "登录中…" : "登录"}
      </button>
      <button
        type="button"
        onClick={() => void signInWithPasskey()}
        disabled={passkeyPending}
        className="rounded-lg border border-foreground/20 px-4 py-2.5 transition-colors hover:border-accent disabled:opacity-50"
      >
        {passkeyPending ? "等待系统弹窗…" : "用通行密钥登录"}
      </button>
    </form>
  );
}
