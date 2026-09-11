export type ConfirmSheetOptions = {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
};

export type AlertSheetOptions = {
  title: string;
  message?: string;
  confirmLabel?: string;
};

export type SheetRequest =
  | { id: number; kind: "confirm"; options: ConfirmSheetOptions; resolve: (value: boolean) => void }
  | { id: number; kind: "alert"; options: AlertSheetOptions; resolve: () => void };

/** Owns request lifetimes independently of React renders and animation callbacks. */
export class DecisionQueue {
  private pending: SheetRequest[] = [];
  private listeners = new Set<() => void>();
  private nextId = 0;
  private active = true;

  getSnapshot = (): SheetRequest | null => this.pending[0] ?? null;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private notify() { this.listeners.forEach(listener => listener()); }

  confirm = (options: ConfirmSheetOptions): Promise<boolean> => {
    if (!this.active) return Promise.resolve(false);
    return new Promise(resolve => {
      this.pending.push({ id: ++this.nextId, kind: "confirm", options, resolve });
      this.notify();
    });
  };
  alert = (options: AlertSheetOptions): Promise<void> => {
    if (!this.active) return Promise.resolve();
    return new Promise(resolve => {
      this.pending.push({ id: ++this.nextId, kind: "alert", options, resolve });
      this.notify();
    });
  };

  settle = (id: number, value: boolean) => {
    const current = this.getSnapshot();
    // A closing animation or double tap can arrive after the next sheet opened.
    if (!current || current.id !== id) return;
    this.pending.shift();
    if (current.kind === "confirm") current.resolve(value);
    else current.resolve();
    this.notify();
  };

  open = () => { this.active = true; };
  close = () => {
    this.active = false;
    const pending = this.pending;
    this.pending = [];
    pending.forEach(request => {
      if (request.kind === "confirm") request.resolve(false);
      else request.resolve();
    });
    this.notify();
  };
}
