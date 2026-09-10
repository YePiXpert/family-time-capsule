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
        className="min-h-11 rounded-lg border border-danger/30 px-3 py-2 text-sm text-danger transition-colors hover:bg-danger-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "撤销中…" : "撤销邀请"}
      </button>
      {state?.error && (
        <span role="alert" className="max-w-56 text-right text-xs text-danger">
          {state.error}
        </span>
      )}
    </form>
  );
}
