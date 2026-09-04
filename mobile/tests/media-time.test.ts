import { describe, expect, it, vi } from "vitest";
import { resolveReliableMediaTime } from "../src/media/capture-time";

describe("native media capture time", () => {
  it("uses the actual live time for camera and direct recording", async () => {
    const now = () => 1_788_422_400_000;
    const lookup = vi.fn();
    await expect(resolveReliableMediaTime("camera", null, lookup, now)).resolves.toBe(now());
    await expect(resolveReliableMediaTime("recorder", null, lookup, now)).resolves.toBe(now());
    expect(lookup).not.toHaveBeenCalled();
  });

  it("uses MediaLibrary creation time for an old library photo or video", async () => {
    const lookup = vi.fn(async () => ({
      creationTime: 1_700_000_000_000,
      modificationTime: 1_710_000_000_000,
    }));
    await expect(resolveReliableMediaTime("library", "asset-1", lookup)).resolves.toBe(
      1_700_000_000_000,
    );
  });

  it("uses a real modification time when creation time is unavailable", async () => {
    await expect(
      resolveReliableMediaTime("library", "asset-video", async () => ({
        creationTime: null,
        modificationTime: 1_720_000_000_000,
      })),
    ).resolves.toBe(1_720_000_000_000);
  });

  it("never substitutes import time for screenshots or stripped images without reliable metadata", async () => {
    const now = vi.fn(() => 1_788_422_400_000);
    await expect(resolveReliableMediaTime("library", null, vi.fn(), now)).resolves.toBeNull();
    await expect(
      resolveReliableMediaTime("library", "limited-asset", async () => {
        throw new Error("limited photo permission");
      }, now),
    ).resolves.toBeNull();
    await expect(
      resolveReliableMediaTime("library", "no-time-png", async () => ({
        creationTime: null,
        modificationTime: null,
      }), now),
    ).resolves.toBeNull();
    expect(now).not.toHaveBeenCalled();
  });
});
