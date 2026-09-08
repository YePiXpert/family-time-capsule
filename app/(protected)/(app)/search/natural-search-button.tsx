"use client";

import { useRef, useState } from "react";

export function NaturalSearchButton({ operationId }: { operationId: string }) {
  const sending = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  return <>
    <button type="button" disabled={pending}
      className="rounded-lg border border-accent/40 px-4 py-2 text-sm font-medium text-accent transition-colors hover:bg-accent/10 disabled:opacity-50"
      aria-label="自然语言辅助检索：先把这句话转换成受限检索条件，再查本地索引"
      onClick={async event => {
        const form = event.currentTarget.form;
        if (!form || sending.current || !form.reportValidity()) return;
        const body = new URLSearchParams();
        for (const [key,value] of new FormData(form)) if (typeof value === "string") body.append(key,value);
        body.set("operation_id",operationId);
        sending.current = true; setPending(true); setError("");
        try {
          // Fetch preserves same-origin authentication with the site's no-referrer
          // policy. Ordinary keyword submission remains a native GET form.
          const response = await fetch("/api/search/natural", { method: "POST", body, credentials: "same-origin" });
          const target = new URL(response.url);
          if (!response.ok || !response.redirected || target.origin !== window.location.origin || target.pathname !== "/search") throw new Error("search_failed");
          window.location.assign(target.href);
        } catch {
          setError("这次搜索未完成，请核对连接后再试。相同操作不会重复调用模型。");
          sending.current = false; setPending(false);
        }
      }}>
      {pending ? "正在转换…" : "用一句话找"}
    </button>
    {error ? <p role="alert">{error}</p> : null}
  </>;
}
