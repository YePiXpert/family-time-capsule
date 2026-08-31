"use client";

import { useActionState } from "react";
import { revokeInvitationAction } from "./actions";

export function RevokeInvitationButton({
  invitationId,
}: {
  invitationId: string;
}) {
  const action = revokeInvitationAction.bind(null, invitationId);
  const [state, formAction, pending] = useActionState(action, undefined);
  return (
    <form action={formAction} className="flex flex-col items-end gap-1">
      <button
        type="submit"
        disabled={pending}
        className="min-h-11 rounded-lg border border-red-800/30 px-3 py-2 text-sm text-red-800 transition-colors hover:bg-red-500/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50 dark:text-red-300"
      >
        {pending ? "撤销中…" : "撤销邀请"}
      </button>
      {state?.error && (
        <span role="alert" className="max-w-56 text-right text-xs text-red-700 dark:text-red-300">
          {state.error}
        </span>
      )}
    </form>
  );
}
