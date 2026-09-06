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
  Share: { share: vi.fn() },
  Switch: "Switch", Text: "Text", TextInput: "TextInput", View: "View",
  StyleSheet: { create: (s: unknown) => s, hairlineWidth: 1 },
}));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
vi.mock("../src/state/AppContext", () => ({
  useApp: () => appState,
}));
vi.mock("expo-camera", () => ({
  CameraView: "CameraView",
  useCameraPermissions: () => [
    { granted: true, canAskAgain: true },
    async () => ({ granted: true }),
  ],
}));
vi.mock("../src/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/api/client")>();
  return {
    ...actual,
    fetchBootstrap: vi.fn(),
    bootstrapSetup: vi.fn(),
    signIn: vi.fn(),
    previewInvitation: vi.fn(),
    acceptInvitation: vi.fn(),
  };
});

const { WelcomeFlow, OnboardingGate } = await import("../src/screens/WelcomeFlow");
const { previewInvitation, acceptInvitation, signIn } = await import("../src/api/client");
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let tree: ReactTestRenderer | undefined;
afterEach(() => {
  if (tree) tree.unmount();
  tree = undefined;
  vi.clearAllMocks();
});

function flattenText(value: unknown): string {
  if (Array.isArray(value)) return value.map(flattenText).join("");
  if (typeof value === "string" || typeof value === "number") return String(value);
  return "";
}

function textOf(): string {
  return currentTree().root
    .findAll((node) => String(node.type) === "Text")
    .map((node) => flattenText(node.props.children))
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

async function pressAsync(label: string) {
  const root = currentTree().root;
  const target = root
    .findAll((node) => String(node.type) === "Pressable")
    .find((node) =>
      node
        .findAll((child) => String(child.type) === "Text")
        .some((child) => String(child.props.children).includes(label)),
    );
  if (!target) throw new Error(`button not found: ${label}`);
  await act(async () => { await target.props.onPress(); });
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
});

describe("加入家庭（受邀注册）", () => {
  beforeEach(() => { appState.credentials = null; });

  it("拒绝非 https 或非 /invite/ 路径的链接", async () => {
    act(() => { tree = create(createElement(WelcomeFlow)); });
    press("加入家人的家庭");
    setInput("https://capsule.example.com/invite/…", "javascript:alert(1)");
    await pressAsync("查看邀请");
    expect(textOf()).toContain("必须以 https:// 开头");
    expect(previewInvitation).not.toHaveBeenCalled();

    setInput("https://capsule.example.com/invite/…", "https://capsule.example.com/other/path");
    await pressAsync("查看邀请");
    expect(textOf()).toContain("必须以 https:// 开头");
    expect(previewInvitation).not.toHaveBeenCalled();
  });

  it("粘贴有效邀请后展示家庭预览，注册成功即自动登录连接", async () => {
    vi.mocked(previewInvitation).mockResolvedValue({
      status: "active",
      familyName: "小满家",
      role: "contributor",
      email: null,
      personName: null,
      expiresAt: "2026-09-13T00:00:00.000Z",
    });
    vi.mocked(acceptInvitation).mockResolvedValue(undefined);
    vi.mocked(signIn).mockResolvedValue({ serverUrl: "https://capsule.example.com", token: "member-session" });

    act(() => { tree = create(createElement(WelcomeFlow)); });
    press("加入家人的家庭");
    setInput("https://capsule.example.com/invite/…", "https://capsule.example.com/invite/abcdefgh23456789");
    await pressAsync("查看邀请");
    expect(previewInvitation).toHaveBeenCalledWith(
      "https://capsule.example.com",
      "abcdefgh23456789",
    );
    expect(textOf()).toContain("将加入：小满家");
    expect(textOf()).toContain("记录者");

    setInput("例如：爸爸", "爸爸");
    setInput("dad@example.com", "dad@example.com");
    setInput("至少 10 位", "a-long-password");
    await pressAsync("注册并加入家庭");
    expect(acceptInvitation).toHaveBeenCalledWith(
      "https://capsule.example.com",
      {
        token: "abcdefgh23456789",
        displayName: "爸爸",
        email: "dad@example.com",
        password: "a-long-password",
      },
    );
    expect(appState.connect).toHaveBeenCalledWith({
      serverUrl: "https://capsule.example.com",
      token: "member-session",
    });
  });

  it("已使用/过期邀请不能注册", async () => {
    vi.mocked(previewInvitation).mockResolvedValue({
      status: "used",
      familyName: "小满家",
      role: "viewer",
      email: null,
      personName: null,
      expiresAt: "2026-09-13T00:00:00.000Z",
    });
    act(() => { tree = create(createElement(WelcomeFlow)); });
    press("加入家人的家庭");
    setInput("https://capsule.example.com/invite/…", "https://capsule.example.com/invite/abcdefgh23456789");
    await pressAsync("查看邀请");
    expect(textOf()).toContain("不能再使用");
    expect(textOf()).not.toContain("注册并加入家庭");
    expect(acceptInvitation).not.toHaveBeenCalled();
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
