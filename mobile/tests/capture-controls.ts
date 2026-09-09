import { act, type ReactTestRenderer } from "react-test-renderer";

/** Editing tests still exercise the actual disclosure buttons; the new basic
 * save tests inspect the collapsed screen before performing any action. */
export async function revealCaptureAction(tree: ReactTestRenderer, label: string) {
  const action = (name: string) => tree.root.findAllByType("Pressable" as never).find(node => node.findAllByType("Text" as never).some(text => text.children.join("") === name));
  if (action(label)) return;
  const more = label.startsWith("发送草稿") || label === "保留整件事草稿" || label === "交给家人整理" || label === "仅保存，稍后整理";
  const toggle = action(more ? "更多保存选项" : "补充信息（可选）");
  if (toggle) await act(async () => { toggle.props.onPress(); });
}
