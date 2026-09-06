import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const appState = vi.hoisted(() => ({
  setWelcomeSeen: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  completeOnboarding: vi.fn(),
  credentials: { serverUrl: "https://capsule.example", token: "session" } as
    | { serverUrl: string; token: string }
    | null,
}));

vi.mock("react-native", () => ({
  ActivityIndicator: "ActivityIndicator", Pressable: "Pressable", ScrollView: "ScrollView",
  Switch: "Switch", Text: "Text", TextInput: "TextInput", View: "View",
  StyleSheet: { create: (s: unknown) => s, hairlineWidth: 1 },
}));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
vi.mock("../src/state/AppContext", () => ({
  useApp: () => appState,
}));
vi.mock("../src/api/client", () => ({
  ApiError: class ApiError extends Error {
    constructor(message: string, readonly status: number) { super(message); this.name = "ApiError"; }
  },
  fetchBootstrap: vi.fn(),
  bootstrapSetup: vi.fn(),
  signIn: vi.fn(),
}));

const { WelcomeFlow, OnboardingGate } = await import("../src/screens/WelcomeFlow");
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let tree: ReactTestRenderer | undefined;
afterEach(() => {
  if (tree) tree.unmount();
  tree = undefined;
  vi.clearAllMocks();
});

function textOf(): string {
  return currentTree().root
    .findAll((node) => String(node.type) === "Text")
    .map((node) => String(node.props.children))
    .join("\n");
}

function currentTree(): ReactTestRenderer {
  if (!tree) throw new Error("tree is not mounted");
  return tree;
}

function press(label: string) {
  const root = currentTree().root;
  const target = root
    .findAll((node) => String(node.type) === "Pressable")
    .find((node) =>
      node
        .findAll((child) => String(child.type) === "Text")
        .some((child) => String(child.props.children).includes(label)),
    );
  if (!target) throw new Error(`button not found: ${label}`);
  act(() => { target.props.onPress(); });
}

function setInput(placeholder: string, value: string) {
  const input = currentTree()
    .root.findAllByType("TextInput" as never)
    .find((node) => node.props.placeholder === placeholder);
  if (!input) throw new Error(`input not found: ${placeholder}`);
  act(() => { input.props.onChangeText(value); });
}

describe("首次启动欢迎页", () => {
  beforeEach(() => { appState.credentials = null; });

  it("提供创建家庭、加入家庭、仅本机记录与已有账号登录四个入口", () => {
    act(() => { tree = create(createElement(WelcomeFlow)); });
    const text = textOf();
    expect(text).toContain("创建我的家庭");
    expect(text).toContain("加入家人的家庭");
    expect(text).toContain("暂时只在本机记录");
    expect(text).toContain("已有账号登录");
    // 诚实说明：不暗示存在官方云
    expect(text).toContain("没有官方云服务");
  });

  it("选择仅本机记录即写入欢迎完成标记，不要求连接", () => {
    act(() => { tree = create(createElement(WelcomeFlow)); });
    press("暂时只在本机记录");
    expect(appState.setWelcomeSeen).toHaveBeenCalledOnce();
    expect(appState.connect).not.toHaveBeenCalled();
  });

  it("加入家庭入口解析完整邀请链接并显示目标空间；拒绝非 https 链接", () => {
    act(() => { tree = create(createElement(WelcomeFlow)); });
    press("加入家人的家庭");
    setInput("https://capsule.example.com/invite/…", "https://capsule.example.com/invite/abc123");
    expect(textOf()).toContain("https://capsule.example.com");

    setInput("https://capsule.example.com/invite/…", "javascript:alert(1)");
    expect(textOf()).toContain("必须以 https:// 开头");
  });
});

describe("初始化门（账号已建立但还没有家庭）", () => {
  beforeEach(() => { appState.credentials = { serverUrl: "https://capsule.example", token: "session" }; });

  it("日期格式错误时不提交并给出提示", async () => {
    act(() => { tree = create(createElement(OnboardingGate)); });
    setInput("例如：河边的小满家", "小满家");
    setInput("例如：小满", "小满");
    setInput("2026-09-02", "9月2日");
    setInput("例如：妈妈", "妈妈");
    setInput("例如：妈妈", "妈妈");
    await act(async () => { press("建立家庭并开始同步"); });
    expect(appState.completeOnboarding).not.toHaveBeenCalled();
    expect(textOf()).toContain("2026-09-02 这样的格式");
  });

  it("填写完整后提交时携带家庭时区", async () => {
    act(() => { tree = create(createElement(OnboardingGate)); });
    setInput("例如：河边的小满家", "小满家");
    setInput("例如：小满", "小满");
    setInput("2026-09-02", "2026-09-02");
    setInput("例如：妈妈", "妈妈");
    setInput("例如：妈妈", "妈妈");
    await act(async () => { press("建立家庭并开始同步"); });
    expect(appState.completeOnboarding).toHaveBeenCalledOnce();
    const input = appState.completeOnboarding.mock.calls[0]![0] as { timezone: string; familyName: string };
    expect(input.familyName).toBe("小满家");
    expect(typeof input.timezone).toBe("string");
    expect(input.timezone.length).toBeGreaterThan(0);
  });
});
