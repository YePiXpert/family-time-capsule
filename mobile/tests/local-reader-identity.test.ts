import { createContext, createElement, useContext, useEffect, useState } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Credentials } from "../src/types";
import { useAccountSession } from "../src/state/use-account-session";

const mocks = vi.hoisted(() => ({ mounts: 0, unmounts: 0, load: vi.fn() }));
const storedCredentials: Credentials = { serverUrl: "https://fixture.invalid", instanceId: "instance", token: "stored-session" };
const Context = createContext({ credentials: storedCredentials as Credentials | null, userId: null as string | null, family: { id: "family-a" } as { id: string } | null, outbox: [] });
vi.mock("react-native", () => ({ ActivityIndicator: "ActivityIndicator", Pressable: "Pressable", ScrollView: "ScrollView", Text: "Text", TextInput: "TextInput", View: "View", StyleSheet: { create: (style: unknown) => style } }));
vi.mock("@react-navigation/native", () => ({ useFocusEffect: (effect: () => void) => useEffect(effect, [effect]) }));
vi.mock("../src/state/AppContext", () => ({ useAppData: () => useContext(Context), useAppActions: () => ({ runSync: vi.fn() }) }));
vi.mock("../src/components/GlassSheet", () => ({ useAlertSheet: () => vi.fn(), useConfirmSheet: () => vi.fn() }));
vi.mock("../src/storage/database", () => ({ getLocalCaptureDetail: mocks.load, removeLocalCaptureRecord: vi.fn() }));
vi.mock("../src/storage/files", () => ({ localFileExists: () => true }));
vi.mock("../src/media/export-original", () => ({ exportOriginalCopy: vi.fn() }));
vi.mock("../src/media/NativeMediaReader", () => ({ NativeMediaReader: (props: Record<string, unknown>) => {
  const [open, setOpen] = useState(false);
  useEffect(() => { mocks.mounts++; return () => { mocks.unmounts++; }; }, []);
  return createElement("ReaderState", { ...props, open, onOpen: () => setOpen(true) });
} }));
const { LocalCaptureDetailScreen } = await import("../src/screens/LocalCaptureDetailScreen");
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let tree: ReactTestRenderer | undefined;
function Harness() {
  // Actual startup hook: credentials are restored before fetchMe resolves user/family identity.
  const session = useAccountSession(storedCredentials);
  return createElement(Context.Provider, { value: {
    credentials: session.credentials, userId: session.userId,
    family: session.accountFamilyId ? { id: session.accountFamilyId } : { id: "family-a" }, outbox: [],
  } }, createElement("IdentityControls", {
    hydrate: () => { session.setUserId("owner-a"); session.setAccountFamilyId("family-a"); },
    changeFamily: () => session.setAccountFamilyId("family-b"),
    revoke: () => { session.setUserId(null); session.setAccountFamilyId(null); },
    changeAccount: () => { session.setCredentials({ ...storedCredentials, token: "other-session" }); session.setUserId("owner-b"); },
  }, createElement(LocalCaptureDetailScreen, { route: { params: { captureId: "local-video" } } })));
}
function reader() { return tree!.root.findByType("ReaderState" as never); }
async function identity(action: string) { await act(async () => tree!.root.findByType("IdentityControls" as never).props[action]()); }
beforeEach(() => {
  mocks.mounts = 0; mocks.unmounts = 0;
  mocks.load.mockImplementation(async (_captureId, scope) => ({ captureId: "local-video", kind: "media_capture", title: "本机视频", occurredAt: "2026-09-12T01:00:00Z", localUri: "file:///original.mov", mediaType: "video", fileName: "original.mov", mimeType: "video/quicktime", syncState: "archived", text: null, ...(scope ? { remoteAssetId: "confirmed-original" } : {}) }));
});
afterEach(async () => { if (tree) await act(() => tree!.unmount()); tree = undefined; vi.clearAllMocks(); });

it("preserves an opened local reader when stored-session identity resolves for the first time", async () => {
  await act(async () => { tree = create(createElement(Harness)); });
  expect(mocks.load).toHaveBeenCalledWith("local-video", null);
  await act(() => reader().props.onOpen()); expect(reader().props.open).toBe(true);
  await identity("hydrate");
  expect(reader().props.assets[0].remoteAssetId).toBe("confirmed-original");
  expect(mocks.mounts).toBe(1);
  expect(mocks.unmounts).toBe(0);
  expect(reader().props.open).toBe(true);
});

it.each(["changeFamily", "changeAccount", "revoke"])("clears the old reader when a confirmed identity actually changes (%s)", async (action) => {
  await act(async () => { tree = create(createElement(Harness)); }); await identity("hydrate");
  await act(() => reader().props.onOpen());
  const previousMounts = mocks.mounts;
  await identity(action);
  expect(mocks.mounts).toBe(previousMounts + 1); expect(reader().props.open).toBe(false);
});
