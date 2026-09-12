import { createElement, type ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ request: vi.fn(), close: vi.fn() }));
vi.mock("react-native", () => ({ ActivityIndicator: "ActivityIndicator", Modal: "Modal", ScrollView: "ScrollView", View: "View" }));
vi.mock("react-native-safe-area-context", () => ({ SafeAreaView: "SafeAreaView" }));
vi.mock("expo-sqlite", async () => await import("../../tests/mocks/expo-sqlite"));
vi.mock("../src/components/typography", () => ({ Text: "Text" }));
vi.mock("../src/components/ui", () => ({ Button: "Button" }));
vi.mock("../src/components/ImportPhotoPicker", () => ({ ImportPhotoPicker: ({ header, footer, ...props }: { header: ReactNode; footer: ReactNode }) => createElement("PhotoPicker", props, header, footer) }));
vi.mock("../src/media/NativeMediaReader", () => ({ NativeMediaReader: "NativeMediaReader" }));
vi.mock("../src/screens/AssetLibraryScreen", () => ({ NativeLibraryActions: "LibraryActions" }));
vi.mock("../src/theme", () => ({ useSharedStyles: () => ({ colors: {} }) }));
const credentials = { serverUrl: "https://family.test", instanceId: "instance", token: "synthetic" };
vi.mock("../src/state/AppContext", () => ({ useAppData: () => ({ credentials, viewer: { id: "author", canEditEvents: true }, family: { id: "family" }, online: true }) }));
vi.mock("../src/api/client", async original => ({ ...await original<object>(), requestMobileJson: mocks.request }));
const { ApiError } = await import("../src/api/client");
const { RemoteImportPicker } = await import("../src/imports/RemoteImportPicker");
const { createPhotoSelection } = await import("../src/imports/photo-selection");
const { loadPhotoSelection, savePhotoSelection, drainPhotoSelectionWrites } = await import("../src/imports/photo-selection-store");
const { initializeLocalStore, clearLocalArchive } = await import("../src/storage/database");
const { getRawMockDatabase } = await import("../../tests/mocks/expo-sqlite");
const { memoryEditScope } = await import("../src/memories/edit-model");
const scope = memoryEditScope(credentials, "author", "family")!;
const photos = ["photo-a", "photo-b"].map(id => ({ id, title: id, type: "image" as const, capturedAt: "2026-09-01T00:00:00.000Z" }));
const metadata = (id: string) => ({ ...photos.find(item => item.id === id), previewId: id, mimeType: "image/jpeg" });
let tree: ReactTestRenderer | undefined;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(async () => {
  await drainPhotoSelectionWrites(); await initializeLocalStore(); await clearLocalArchive();
  mocks.close.mockReset(); mocks.request.mockReset().mockImplementation(async (_credentials, path: string) => path.startsWith("/api/imports/")
    ? { items: [{ status: "completed", assetId: "photo-a" }, { status: "completed", assetId: "photo-b" }, { status: "failed", assetId: "unfinished" }] }
    : metadata(path.split("/").at(-1)!));
});
afterEach(async () => { if (tree) await act(async () => tree!.unmount()); tree = undefined; await drainPhotoSelectionWrites(); });
async function open() { await act(async () => { tree = create(createElement(RemoteImportPicker, { sessionId: "batch", title: "这次旅行", onClose: mocks.close })); }); }

it("loads only completed originals, saves rapid selections in order, and forwards selected cover and navigation closure", async () => {
  await open();
  const picker = tree!.root.findByType("PhotoPicker" as never);
  expect(picker.props.items.map((item: { id: string }) => item.id)).toEqual(["photo-a", "photo-b"]);
  expect(mocks.request.mock.calls.every(call => !call[2]?.method)).toBe(true);
  const initial = picker.props.selection;
  await act(async () => {
    picker.props.onSelectionChange({ ...initial, selectedIds: ["photo-a"], coverId: "photo-a" });
    picker.props.onSelectionChange({ ...initial, selectedIds: ["photo-b"], coverId: "photo-b" });
  });
  expect(await loadPhotoSelection(scope, "remote:batch")).toMatchObject({ revision: 2, selectedIds: ["photo-b"], coverId: "photo-b" });
  const actions = tree!.root.findByType("LibraryActions" as never);
  expect(actions.props.ids).toEqual(["photo-b"]);
  expect(actions.props.coverAssetId).toBe("photo-b");
  actions.props.onNavigate();
  expect(mocks.close).toHaveBeenCalledOnce();
});

it("does not replace an earlier complete selection when one metadata request fails offline", async () => {
  const saved = await savePhotoSelection(scope, "remote:batch", createPhotoSelection(photos), 0);
  mocks.request.mockImplementation(async (_credentials, path: string) => {
    if (path.startsWith("/api/imports/")) return { items: photos.map(item => ({ assetId: item.id, status: "completed" })) };
    if (path.endsWith("photo-b")) throw new ApiError("network unavailable", 0);
    return metadata("photo-a");
  });
  await open();
  expect(tree!.root.findAllByType("PhotoPicker" as never)).toHaveLength(0);
  expect(tree!.root.findAllByType("LibraryActions" as never)).toHaveLength(0);
  expect(await loadPhotoSelection(scope, "remote:batch")).toEqual(saved);
});

it("keeps an unreadable saved selection intact instead of overwriting it with a default", async () => {
  await savePhotoSelection(scope, "remote:batch", createPhotoSelection(photos), 0);
  getRawMockDatabase().prepare("UPDATE local_import_selection SET snapshot_json='broken' WHERE scope=?").run(scope);
  await open();
  expect(tree!.root.findAllByType("PhotoPicker" as never)).toHaveLength(0);
  expect(tree!.root.findAllByType("LibraryActions" as never)).toHaveLength(0);
  expect(getRawMockDatabase().prepare("SELECT snapshot_json FROM local_import_selection WHERE scope=?").get(scope)).toEqual({ snapshot_json: "broken" });
});
