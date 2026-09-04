import { describe, expect, it, vi } from "vitest";
import { subscribeToPendingNativeShares } from "../modules/share-intake/src";

const mocks = vi.hoisted(() => ({
  platform: { OS: "android" },
  remove: vi.fn(),
  addListener: vi.fn(),
}));
vi.mock("react-native", () => ({ Platform: mocks.platform }));
vi.mock("expo-modules-core", () => ({
  requireOptionalNativeModule: () => ({ addListener: mocks.addListener }),
}));

describe("foreground share notification", () => {
  it("delivers native intake events without an AppState transition and removes the listener", () => {
    mocks.platform.OS = "android";
    mocks.addListener.mockReturnValue({ remove: mocks.remove });
    const receive = vi.fn();
    const unsubscribe = subscribeToPendingNativeShares(receive);
    const [event, listener] = mocks.addListener.mock.calls.at(-1)!;
    expect(event).toBe("onPendingShares");
    listener();
    expect(receive).toHaveBeenCalledOnce();
    unsubscribe();
    expect(mocks.remove).toHaveBeenCalledOnce();
  });

  it("does not register an Android-only event on iOS", () => {
    mocks.platform.OS = "ios";
    mocks.addListener.mockClear();
    subscribeToPendingNativeShares(vi.fn())();
    expect(mocks.addListener).not.toHaveBeenCalled();
  });
});
