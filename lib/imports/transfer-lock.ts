import "server-only";
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { mkdir, open } from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "@/lib/paths";

export class TransferBusyError extends Error {}

/**
 * Non-Linux dev machines have no util-linux flock, and O_NOFOLLOW is absent on
 * Windows. There we degrade to a synchronous in-process claim: the caller
 * (withUploadLock) already serializes same-process access, so this preserves
 * in-process semantics exactly and only gives up cross-process protection,
 * which a single dev server never needs. Linux keeps the strict kernel lock —
 * fail closed there rather than silently weakening production containers.
 */
const heldInProcess = new Set<string>();
const KERNEL_LOCK = process.platform === "linux";

/** Linux open-description lock: the parent retains the descriptor after flock
 * exits, and the kernel releases it even on SIGKILL. No stale-lock deletion or
 * time-based lease can allow a second writer into a still-running transfer.
 * See https://man7.org/linux/man-pages/man2/flock.2.html .
 */
export async function withTransferLock<T>(id: string, effect: () => Promise<T>): Promise<T> {
  if (!/^[0-9a-f-]{36}$/iu.test(id)) throw new Error("invalid transfer id");
  if (!KERNEL_LOCK) {
    if (heldInProcess.has(id)) throw new TransferBusyError("upload_busy");
    heldInProcess.add(id);
    try { return await effect(); } finally { heldInProcess.delete(id); }
  }
  const directory = path.join(DATA_DIR, "uploads", ".locks");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  // Lock files are stable inode identities: never unlink them while running.
  const handle = await open(path.join(directory, `${id}.lock`), constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn("flock", ["-x", "-n", "3"], { stdio: ["ignore", "ignore", "ignore", handle.fd] });
      child.once("error", () => reject(new Error("transfer_lock_unavailable")));
      child.once("exit", code => code === 0 ? resolve() : reject(code === 1 ? new TransferBusyError("upload_busy") : new Error("transfer_lock_unavailable")));
    });
    return await effect();
  } finally { await handle.close(); }
}
