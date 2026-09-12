import { createElement, useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";
import type { MobileCalendar } from "../src/types";
const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  navigate: vi.fn(),
  credentials: {
    serverUrl: "https://fictional.example.test",
    token: "fictional-test-token",
  },
}));
vi.mock("../src/components/GlassSheet", () => ({ GlassSheet: ({ children }: { children: unknown }) => children }));
vi.mock("../src/components/JournalIcon", () => ({ JournalIcon: "Icon" }));
vi.mock("react-native", () => ({
  useWindowDimensions: () => ({ width: 390, height: 844 }),
  ActivityIndicator: "ActivityIndicator",
  Image: "Image",
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  Text: "Text",
  TextInput: "TextInput",
  View: "View",
  StyleSheet: { create: (s: unknown) => s },
  Platform: { OS: "ios", select: (v: { ios: unknown }) => v.ios },
}));
vi.mock("@react-navigation/native", () => ({
  useFocusEffect: (fn: () => void | (() => void)) => useEffect(fn, [fn]),
}));
vi.mock("../src/state/AppContext", () => { const useApp = () => ({
    credentials: mocks.credentials,
    family: { timezone: "Asia/Shanghai" },
    events: [],
  }); return { useApp, useAppData: useApp, useAppActions: useApp, useSyncStatus: useApp }; });
vi.mock("../src/api/client", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchMobileCalendar: mocks.fetch,
}));
const { CalendarScreen } = await import("../src/screens/CalendarScreen");
const { ApiError } = await import("../src/api/client");
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let tree: ReactTestRenderer | undefined;
afterEach(async () => {
  if (tree) await act(() => tree!.unmount());
  tree = undefined;
  vi.clearAllMocks();
});
function response(month = "2026-09"): MobileCalendar {
  return {
    month,
    timezone: "Asia/Shanghai",
    days: [{ date: `${month}-01`, count: 1, covers: [] }],
    entries: [
      {
        id: "event-1",
        title: "虚构家庭的第一天",
        date: `${month}-01`,
        occurredAt: `${month}-01T00:00:00Z`,
      },
    ],
    nextCursor: null,
    people: [{ id: "child", name: "小雨" }],
    ages: [{ label: "满月", date: "2026-02-28" }],
  };
}
async function render() {
  await act(async () => {
    tree = create(
      createElement(CalendarScreen, {
        navigation: { navigate: mocks.navigate },
        route: {},
      } as unknown as Parameters<typeof CalendarScreen>[0]),
    );
  });
}
async function press(label: string) {
  const target = tree!.root.findAll(
    (n) =>
      String(n.type) === "Pressable" &&
      n.findAll((c) => String(c.type) === "Text" && c.props.children === label)
        .length > 0,
  )[0];
  expect(target).toBeTruthy();
  await act(async () => target!.props.onPress());
}
it("renders the real native calendar, changes media/age filters and opens the source memory", async () => {
  mocks.fetch.mockImplementation(async (_credentials, params) =>
    response(params.month),
  );
  await render();
  await press("文档");
  expect(mocks.fetch.mock.lastCall?.[1].media).toBe("document");
  await press("满月");
  expect(mocks.fetch.mock.lastCall?.[1]).toMatchObject({
    month: "2026-02",
    date: "2026-02-28",
    media: "document",
  });
  await press("虚构家庭的第一天");
  expect(mocks.navigate).toHaveBeenCalledWith("Memory", { id: "event-1" });
  expect(tree!.root.findAll(n => String(n.type) === "TextInput" && n.props.accessibilityLabel === "年 / 月")).toHaveLength(0);
  await act(() => tree!.root.findByProps({ testID: "month-picker" }).props.onPress());
  const monthButtons = tree!.root.findAll(n => String(n.type) === "Pressable" && /^2026 年 \d+ 月，本机/.test(n.props.accessibilityLabel ?? ""));
  expect(monthButtons).toHaveLength(12);
  expect(monthButtons.some(n => n.props.accessibilityLabel.includes("13 月"))).toBe(false);
  await press("3 月");
  expect(mocks.fetch.mock.lastCall?.[1]).toMatchObject({ month: "2026-03", date: "", media: "document" });

});
it("distinguishes network errors from permission denial, removes stale results and retries", async () => {
  mocks.fetch.mockRejectedValueOnce(new ApiError("offline", 0));
  await render();
  expect(JSON.stringify(tree!.toJSON())).toContain("当前无法联网");
  mocks.fetch.mockImplementationOnce(async (_credentials, params) => response(params.month));
  await press("重试");
  expect(JSON.stringify(tree!.toJSON())).toContain("虚构家庭的第一天");
  mocks.fetch.mockRejectedValueOnce(new ApiError("当前账号没有权限", 403));
  await press("文档");
  expect(JSON.stringify(tree!.toJSON())).toContain("当前账号没有权限");
  expect(JSON.stringify(tree!.toJSON())).not.toContain("虚构家庭的第一天");
});
