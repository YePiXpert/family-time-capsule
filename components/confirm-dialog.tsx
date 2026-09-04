"use client";

import { useRef, useState } from "react";

export function ConfirmDialog({
  triggerLabel,
  title,
  description,
  confirmLabel = "确认",
  cancelLabel = "取消",
  destructive = false,
  onConfirm,
}: {
  triggerLabel: string;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setPending(true);
    setError(null);
    try {
      await onConfirm();
      dialogRef.current?.close();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "操作失败，请重试。");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <button type="button" className={destructive ? "ui-button-danger" : "ui-button-secondary"} onClick={() => dialogRef.current?.showModal()}>{triggerLabel}</button>
      <dialog ref={dialogRef} className="confirm-dialog" onClose={() => setError(null)}>
        <div className="confirm-dialog-panel">
          <h2 className="text-xl font-semibold">{title}</h2>
          <p className="mt-2 text-sm leading-6 text-muted">{description}</p>
          {error ? <p role="alert" className="mt-3 text-sm text-danger">{error}</p> : null}
          <div className="mt-6 flex justify-end gap-2">
            <button type="button" className="ui-button-secondary" disabled={pending} onClick={() => dialogRef.current?.close()}>{cancelLabel}</button>
            <button type="button" className={destructive ? "ui-button-danger" : "ui-button-primary"} disabled={pending} onClick={() => void confirm()}>{pending ? "处理中…" : confirmLabel}</button>
          </div>
        </div>
      </dialog>
    </>
  );
}
