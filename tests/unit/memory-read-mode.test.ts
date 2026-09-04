import { describe, expect, it, vi } from "vitest";
import {
  loadMemoryArchiveData,
  resolveMemoryPageMode,
} from "@/lib/memories/read-mode";

describe("memory page read mode", () => {
  it("does not query archive-only AI, transcript, job or revision data by default", async () => {
    const loader = vi.fn(async () => ({ heavy: true }));
    await expect(loadMemoryArchiveData("read", loader)).resolves.toBeNull();
    expect(loader).not.toHaveBeenCalled();
  });

  it("loads archive details only when explicitly opened or editing", async () => {
    expect(resolveMemoryPageMode(undefined, true)).toBe("read");
    expect(resolveMemoryPageMode("archive", false)).toBe("archive");
    expect(resolveMemoryPageMode("edit", false)).toBe("read");
    expect(resolveMemoryPageMode("edit", true)).toBe("edit");
    const loader = vi.fn(async () => ({ heavy: true }));
    await expect(loadMemoryArchiveData("archive", loader)).resolves.toEqual({ heavy: true });
    expect(loader).toHaveBeenCalledOnce();
  });
});
