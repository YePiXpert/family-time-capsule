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
      className="text-sm text-foreground/60 transition-colors hover:text-foreground disabled:opacity-50"
    >
      退出
    </button>
  );
}
