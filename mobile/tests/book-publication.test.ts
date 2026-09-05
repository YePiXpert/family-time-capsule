import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";
import type { BookRenderStatus } from "../src/books/render-types";
const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  start: vi.fn(),
  change: vi.fn(),
  prepare: vi.fn(),
  download: vi.fn(),
  share: vi.fn(),
  remove: vi.fn(),
  info: vi.fn(),
  createDownload: vi.fn(),
}));
vi.mock("react-native", () => ({
  Pressable: "Pressable",
  Text: "Text",
  View: "View",
  StyleSheet: { create: (s: unknown) => s },
}));
vi.mock("../src/api/client", () => ({
  fetchBookRenders: mocks.list,
  startBookRender: mocks.start,
  changeBookRender: mocks.change,
}));
vi.mock("expo-file-system/legacy", () => ({
  cacheDirectory: "file:///cache/",
  createDownloadResumable: mocks.createDownload,
  deleteAsync: mocks.remove,
  getInfoAsync: mocks.info,
}));
vi.mock("expo-sharing", () => ({
  isAvailableAsync: async () => true,
  shareAsync: mocks.share,
}));
vi.mock("expo-crypto", () => ({ randomUUID: () => "fictional-file" }));
const { NativeBookPublication } =
  await import("../src/books/NativeBookPublication");
const { exportPublication } = await import("../src/books/export-publication");
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const credentials = {
  serverUrl: "https://fictional.example.test",
  token: "fictional-token",
};
const job: BookRenderStatus = {
  id: "job",
  projectId: "book",
  revision: 3,
  format: "pdf",
  audience: "family",
  status: "succeeded",
  progress: 100,
  pages: 34,
  bytes: 1024,
  sha256: null,
  errorCode: null,
  downloadable: true,
  updatedAt: "2026-09-01T00:00:00Z",
};
let tree: ReactTestRenderer | undefined;
afterEach(async () => {
  if (tree) await act(() => tree!.unmount());
  tree = undefined;
  vi.resetAllMocks();
});
async function press(text: string) {
  const button = tree!.root.findAll(
    (n) =>
      String(n.type) === "Pressable" &&
      n.findAll((c) => String(c.type) === "Text" && c.props.children === text)
        .length,
  )[0]!;
  expect(button).toBeTruthy();
  expect(button.props.disabled).not.toBe(true);
  await act(async () => {
    button.props.onPress();
  });
}
it("saves before publishing, cancels queued work and refuses publication on editor conflict", async () => {
  mocks.list.mockResolvedValue([]);
  mocks.prepare.mockResolvedValue(3);
  mocks.start.mockResolvedValue(job);
  await act(async () => {
    tree = create(
      createElement(NativeBookPublication, {
        credentials,
        id: "book",
        audience: "family",
        prepare: mocks.prepare,
      }),
    );
  });
  await press("生成 PDF");
  expect(mocks.prepare).toHaveBeenCalledOnce();
  expect(mocks.start).toHaveBeenCalledWith(credentials, "book", 3, "pdf");
  mocks.prepare.mockResolvedValue(null);
  await press("生成 EPUB");
  expect(mocks.start).toHaveBeenCalledOnce();
  mocks.list.mockResolvedValue([
    { ...job, status: "queued", downloadable: false, progress: 0 },
  ]);
  await press("刷新出版任务");
  await press("取消排版");
  expect(mocks.change).toHaveBeenCalledWith(credentials, "job", "cancel");
  mocks.list.mockResolvedValue([{ ...job, downloadable: false }]);
  await press("刷新出版任务");
  expect(JSON.stringify(tree!.toJSON())).toContain("来源或权限已变化");
  expect(JSON.stringify(tree!.toJSON())).not.toContain("下载并导出副本");
});
it("exports one full copy and cleans only its own temporary file, including denied or incomplete downloads", async () => {
  mocks.createDownload.mockReturnValue({ downloadAsync: mocks.download });
  mocks.download.mockResolvedValue({ status: 200 });
  mocks.info.mockResolvedValue({ exists: true, size: 1024 });
  await exportPublication(credentials, job);
  expect(mocks.share).toHaveBeenCalledWith(
    "file:///cache/publication-fictional-file.pdf",
    { mimeType: "application/pdf" },
  );
  expect(mocks.remove.mock.calls).toEqual([
    ["file:///cache/publication-fictional-file.pdf", { idempotent: true }],
  ]);
  mocks.download.mockResolvedValue({ status: 403 });
  await expect(exportPublication(credentials, job)).rejects.toThrow(
    "权限或来源已变化",
  );
  expect(mocks.share).toHaveBeenCalledOnce();
  mocks.download.mockResolvedValue({ status: 200 });
  mocks.info.mockResolvedValue({ exists: true, size: 100 });
  await expect(exportPublication(credentials, job)).rejects.toThrow(
    "下载不完整",
  );
  expect(mocks.share).toHaveBeenCalledOnce();
  expect(mocks.remove).toHaveBeenCalledTimes(3);
  expect(mocks.createDownload.mock.calls[0]?.[2]).toEqual({
    headers: { Authorization: "Bearer fictional-token" },
  });
});
