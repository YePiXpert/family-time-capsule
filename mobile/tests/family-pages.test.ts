import { beforeEach, expect, it, vi } from "vitest";
import type { Conflict } from "../src/sync/state";
import { emptyLibrary } from "../src/local/model";
import { Conflicts } from "../src/sync/Conflicts";

const env = vi.hoisted(() => ({
  slots: [] as unknown[], cursor: 0,
  focus: undefined as (() => (() => void) | void) | undefined,
  items: [] as Conflict[],
  change: vi.fn(), write: vi.fn(),
}));
vi.mock("react", () => ({
  useState: (initial: unknown) => {
    const index = env.cursor++;
    if (index >= env.slots.length) env.slots[index] = initial;
    return [env.slots[index], (next: unknown) => { env.slots[index] = next; }];
  },
  useRef: () => ({ current: null }),
  useEffect: vi.fn(),
  useCallback: (fn: unknown) => fn,
}));
vi.mock("react-native", () => ({ View: "View" }));
vi.mock("@react-navigation/native", () => ({ useFocusEffect: (fn: () => void) => { env.focus = fn; } }));
vi.mock("../src/local/context", () => ({ useStore: () => ({ change: env.change }) }));
vi.mock("../src/local/ui", () => ({
  Button: "Button", Card: "Card", ErrorText: "ErrorText", Field: "Field", Page: "Page", Text: "Text",
  messageOf: (e: Error) => e.message, useStyles: () => ({}), useTheme: () => ({ colors: {} }),
}));
vi.mock("../src/sync/state", () => ({
  readConflicts: async () => structuredClone(env.items),
  writeConflicts: (items: Conflict[]) => { env.write(items); env.items = items; },
}));

type Element = { type?: unknown; props?: { testID?: string; children?: unknown; title?: string; message?: string; onPress?: () => void; onChangeText?: (text: string) => void } };
function nodes(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!node || typeof node !== "object") return [];
  const element = node as Element;
  return [element, ...nodes(element.props?.children)];
}
function find(tree: unknown, id: string) {
  return nodes(tree).find((el) => el.props?.testID === id);
}
function text(tree: unknown): string {
  if (typeof tree === "string") return tree;
  if (Array.isArray(tree)) return tree.map(text).join("");
  return tree && typeof tree === "object" ? text((tree as Element).props?.children) : "";
}
function renderConflicts() { env.cursor = 0; return Conflicts(); }
const at = "2026-09-20T10:00:00.000Z";
function conflict(id = "r", time = at): Conflict {
  return {
    key: `records:${id}`, kind: "records", entityId: id, at: time, device: null,
    winner: { updatedAt: time, deleted: true },
    loser: { id, title: "", text: "妈妈的全文", revision: 1, updatedAt: time, date: time, location: "", first: false, mediaIds: [], coverId: null },
  };
}
async function focusedConflicts() {
  renderConflicts(); env.focus!();
  await vi.waitFor(() => expect(env.slots[0]).toHaveLength(env.items.length));
  return renderConflicts();
}
beforeEach(() => {
  vi.clearAllMocks();
  env.slots = []; env.cursor = 0; env.items = []; env.focus = undefined;
});
it("冲突倒序显示全文、删除赢家与本机来源，无标题时不拿正文充数", async () => {
  env.items = [conflict("old"), conflict("new", "2026-09-21T10:00:00.000Z")];
  const tree = await focusedConflicts();
  expect(nodes(tree).filter((el) => el.type === "Card").map((el) => el.props!.testID)).toEqual(["conflict-new", "conflict-old"]);
  expect(text(tree)).toContain("留下的一版：已被删掉");
  expect(text(tree)).toContain("这一版：这台手机");
  expect(text(tree).match(/妈妈的全文/g)).toHaveLength(2);
});
it("冲突标题去掉首尾空白后显示", async () => {
  const c = conflict();
  c.loser.title = "  笑了 \n";
  env.items = [c];
  const tree = await focusedConflicts();
  expect(nodes(tree).filter((el) => el.type === "Text").map((el) => el.props?.children)).toContain("笑了");
  expect(text(tree)).not.toContain(c.loser.title);
});
it("写库成功才移除留底并显示换回结果", async () => {
  env.items = [conflict()];
  const lib = emptyLibrary();
  env.change.mockImplementationOnce(async (apply) => apply(lib));
  find(await focusedConflicts(), "conflict-use-r")!.props!.onPress!();
  await vi.waitFor(() => expect(env.slots[2]).toBe("已换回这一版。"));
  expect(lib.records.r!.text).toBe("妈妈的全文");
  expect(env.items).toEqual([]);
  expect(find(renderConflicts(), "conflict-r")).toBeUndefined();
});
it("写库失败保留冲突，页顶显示错误", async () => {
  env.items = [conflict()];
  env.change.mockRejectedValueOnce(new Error("写不进去"));
  find(await focusedConflicts(), "conflict-use-r")!.props!.onPress!();
  await vi.waitFor(() => expect(env.slots[1]).toBe("写不进去"));
  expect(env.write).not.toHaveBeenCalled();
  expect(find(renderConflicts(), "conflict-r")).toBeDefined();
});
it("知道了只移除所选留底，保留后来追加的另一条", async () => {
  env.items = [conflict()];
  const tree = await focusedConflicts();
  env.items.push(conflict("new"));
  find(tree, "conflict-dismiss-r")!.props!.onPress!();
  await vi.waitFor(() => expect(env.items.map((c) => c.entityId)).toEqual(["new"]));
  expect(env.change).not.toHaveBeenCalled();
});
