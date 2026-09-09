import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("react-native", () => ({ ActivityIndicator: "ActivityIndicator", Pressable: "Pressable", Text: "Text", TextInput: "TextInput", View: "View", StyleSheet: { create: (s: unknown) => s } }));
vi.mock("../src/api/client", async original => ({ ...await original<typeof import("../src/api/client")>(), signIn: vi.fn(), signOut: vi.fn(), verifyTwoFactor: vi.fn() }));
const { signIn, signOut, verifyTwoFactor, TwoFactorRequiredError } = await import("../src/api/client");
const { AccountLoginForm } = await import("../src/components/AccountLoginForm");
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let tree: ReactTestRenderer | undefined;
const pending = { serverUrl: "https://synthetic.example", challenge: "synthetic-challenge" };
const credentials = { serverUrl: pending.serverUrl, token: "verified-session" };
afterEach(async () => { if (tree) await act(async () => tree!.unmount()); tree = undefined; vi.resetAllMocks(); });
const input = (name: string) => tree!.root.findByProps({ accessibilityLabel: name });
async function fill(name: string, value: string) { await act(async () => input(name).props.onChangeText(value)); }
async function press(label: string) {
  const button = tree!.root.findAllByType("Pressable" as never).find(node => node.findAllByType("Text" as never).some(text => text.props.children === label));
  expect(button).toBeDefined(); expect(button!.props.disabled).not.toBe(true);
  await act(async () => button!.props.onPress());
}
async function begin(onLogin = vi.fn().mockResolvedValue(undefined)) {
  vi.mocked(signIn).mockRejectedValue(new TwoFactorRequiredError(pending));
  await act(async () => { tree = create(createElement(AccountLoginForm, { onLogin })); });
  await fill("家庭空间地址", pending.serverUrl); await fill("邮箱", "owner@example.invalid"); await fill("密码", "synthetic-password");
  await press("登录"); return onLogin;
}

it("password challenge never connects; wrong code preserves input and recovery verification connects once", async () => {
  const onLogin = await begin();
  expect(onLogin).not.toHaveBeenCalled();
  expect(tree!.root.findAllByProps({ accessibilityLabel: "密码" })).toHaveLength(0);
  expect(JSON.stringify(tree!.toJSON())).not.toContain(pending.challenge);
  vi.mocked(verifyTwoFactor).mockRejectedValueOnce(new Error("动态码错误"));
  await fill("动态验证码", "123456"); await press("验证并登录");
  expect(input("动态验证码").props.value).toBe("123456"); expect(onLogin).not.toHaveBeenCalled();
  await press("改用恢复码"); expect(input("一次性恢复码").props.value).toBe("");
  vi.mocked(verifyTwoFactor).mockResolvedValue(credentials);
  await fill("一次性恢复码", "unused-code"); await press("验证并登录");
  expect(verifyTwoFactor).toHaveBeenLastCalledWith(pending, "unused-code", "backup");
  expect(onLogin).toHaveBeenCalledExactlyOnceWith(credentials);
});

it("cancel forgets the pending challenge and password without connecting or deleting local data", async () => {
  const onLogin = await begin(); await fill("动态验证码", "123456");
  await press("取消验证，重新登录");
  expect(input("密码").props.value).toBe("");
  expect(tree!.root.findAllByProps({ accessibilityLabel: "动态验证码" })).toHaveLength(0);
  expect(onLogin).not.toHaveBeenCalled(); expect(verifyTwoFactor).not.toHaveBeenCalled();
});

it("leaving the form discards a late verified response instead of connecting another screen", async () => {
  const onLogin = await begin();
  let finish!: (value: typeof credentials) => void;
  vi.mocked(verifyTwoFactor).mockReturnValue(new Promise(resolve => { finish = resolve; }));
  await fill("动态验证码", "123456"); await press("验证并登录");
  expect(input("动态验证码").props.editable).toBe(false);
  await act(async () => tree!.unmount()); tree = undefined;
  await act(async () => finish(credentials)); expect(onLogin).not.toHaveBeenCalled();
  expect(signOut).toHaveBeenCalledExactlyOnceWith(credentials);
});

it("a failed connection after successful verification asks for fresh login, not reuse of a spent recovery code", async () => {
  const onLogin = vi.fn().mockRejectedValue(new Error("synthetic credential store failure"));
  await begin(onLogin); vi.mocked(verifyTwoFactor).mockResolvedValue(credentials);
  await fill("动态验证码", "123456"); await press("验证并登录");
  expect(input("密码").props.value).toBe("");
  expect(JSON.stringify(tree!.toJSON())).toContain("请重新登录");
});
