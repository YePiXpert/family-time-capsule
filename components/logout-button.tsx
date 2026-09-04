"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { authClient } from "@/lib/auth/client";

export function LogoutButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      disabled={pending || busy}
      onClick={() => {
        setBusy(true);
        startTransition(async () => {
          await authClient.signOut();
          router.push("/login");
          router.refresh();
        });
      }}
      className="inline-flex min-h-11 items-center rounded-lg px-2 text-sm text-muted transition-colors hover:bg-surface-muted hover:text-foreground disabled:opacity-50"
    >
      退出
    </button>
  );
}
