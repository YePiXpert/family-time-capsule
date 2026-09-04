export type MemoryPageMode = "read" | "archive" | "edit";

export function resolveMemoryPageMode(
  requestedMode: string | string[] | undefined,
  canWriteEvent: boolean,
): MemoryPageMode {
  if (requestedMode === "archive") return "archive";
  if (requestedMode === "edit" && canWriteEvent) return "edit";
  return "read";
}

export async function loadMemoryArchiveData<T>(
  mode: MemoryPageMode,
  loader: () => Promise<T>,
): Promise<T | null> {
  return mode === "read" ? null : loader();
}
