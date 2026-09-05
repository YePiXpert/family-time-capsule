import { createElement, useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";
import type { BookReview } from "../src/books/review-types";
const m = vi.hoisted(() => ({
  get: vi.fn(),
  mutate: vi.fn(),
  book: vi.fn(),
  navigate: vi.fn(),
  credentials: {
    serverUrl: "https://fictional.example.test",
    token: "fictional-token",
  },
}));
vi.mock("react-native", () => ({
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  Text: "Text",
  TextInput: "TextInput",
  View: "View",
  StyleSheet: { create: (s: unknown) => s },
}));
vi.mock("@react-navigation/native", () => ({
  useFocusEffect: (fn: () => void | (() => void)) => useEffect(fn, [fn]),
}));
vi.mock("../src/state/AppContext", () => ({
  useApp: () => ({
    credentials: m.credentials,
    family: { timezone: "Asia/Shanghai" },
  }),
}));
vi.mock("../src/api/client", () => ({
  fetchBookReview: m.get,
  mutateBookReview: m.mutate,
  mutateBook: m.book,
}));
const { BookReviewScreen } = await import("../src/screens/BookReviewScreen");
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const data: BookReview = {
  startDate: "2024-01-31",
  endDate: "2024-02-06",
  timezone: "Asia/Shanghai",
  periodId: "period",
  birthDate: "2024-01-31",
  total: 1,
  selectedCount: 0,
  months: [
    { month: "2024-01", count: 1 },
    { month: "2024-02", count: 0 },
  ],
  materials: [
    {
      id: "memory",
      kind: "memory",
      title: "虚构窗边家书",
      date: "2024-01-31",
      selected: false,
      included: false,
      milestone: null,
      author: null,
    },
  ],
  nextCursor: null,
  draft: null,
  audience: "family",
  template: "growth",
  canWrite: true,
};
let tree: ReactTestRenderer | undefined;
afterEach(async () => {
  if (tree) await act(() => tree!.unmount());
  tree = undefined;
  vi.resetAllMocks();
});
async function press(label: string) {
  const b = tree!.root.findAll(
    (n) =>
      String(n.type) === "Pressable" &&
      n.findAll((c) => String(c.type) === "Text" && c.props.children === label)
        .length > 0,
  )[0]!;
  expect(b).toBeTruthy();
  expect(b.props.disabled).not.toBe(true);
  await act(async () => {
    b.props.onPress();
  });
}
async function open() {
  await act(async () => {
    tree = create(
      createElement(BookReviewScreen, {
        navigation: { navigate: m.navigate },
        route: {},
      } as unknown as Parameters<typeof BookReviewScreen>[0]),
    );
  });
}
it("selects birth-first-week material, persists a highlight and creates an editable book with explicit selection", async () => {
  m.get.mockResolvedValue(data);
  m.mutate.mockResolvedValue({ id: "created-book" });
  await open();
  await press("出生第一周");
  expect(m.get.mock.lastCall?.[1]).toMatchObject({
    startDate: "2024-01-31",
    endDate: "2024-02-06",
  });
  await press("设为人工精选");
  expect(m.mutate.mock.lastCall?.[1]).toMatchObject({
    operation: "highlight",
    id: "memory",
    selected: true,
  });
  const checkbox = tree!.root.findByProps({
    accessibilityRole: "checkbox",
    accessibilityLabel: "虚构窗边家书",
  });
  await act(() => checkbox.props.onPress());
  await press("建立可编辑年册草稿");
  expect(m.mutate.mock.lastCall?.[1]).toMatchObject({
    operation: "draft",
    audience: "family",
    selection: [{ kind: "memory", id: "memory" }],
  });
  expect(m.navigate).toHaveBeenCalledWith("BookDetail", { id: "created-book" });
});
it("keeps choices after a failed write and only appends new material after an explicit action", async () => {
  m.get.mockResolvedValue({
    ...data,
    draft: {
      id: "draft",
      title: "虚构正在制作",
      revision: 5,
      newMemoryCount: 1,
    },
  });
  m.book.mockRejectedValue(new Error("其他家人已保存修改"));
  await open();
  const checkbox = tree!.root.findByProps({
    accessibilityRole: "checkbox",
    accessibilityLabel: "虚构窗边家书",
  });
  await act(() => checkbox.props.onPress());
  expect(m.book).not.toHaveBeenCalled();
  await press("将所选加入现有草稿");
  expect(JSON.stringify(tree!.toJSON())).toContain("其他家人已保存修改");
  expect(
    tree!.root.findByProps({
      accessibilityRole: "checkbox",
      accessibilityLabel: "虚构窗边家书",
    }).props.accessibilityState.checked,
  ).toBe(true);
  m.book.mockResolvedValue({});
  await press("将所选加入现有草稿");
  expect(m.book.mock.lastCall?.[2]).toEqual({
    operation: "add",
    revision: 5,
    selection: [{ kind: "memory", id: "memory" }],
  });
  expect(
    tree!.root.findByProps({
      accessibilityRole: "checkbox",
      accessibilityLabel: "虚构窗边家书",
    }).props.accessibilityState.checked,
  ).toBe(false);
});
