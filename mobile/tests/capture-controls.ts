import { act, type ReactTestRenderer } from "react-test-renderer";

export async function revealCaptureAction(tree: ReactTestRenderer, label: string) {
  const action = (name: string) => tree.root.findAllByType("Pressable" as never).find(node => node.props.accessibilityLabel === name || node.findAllByType("Text" as never).some(text => text.children.join("") === name));
  if (action(label)) return;
  const privacy = ["全家", "指定成员", "仅自己", "重新核对成员"].includes(label);
  const toggle = privacy
    ? tree.root.findAllByType("Pressable" as never).find(node => typeof node.props.accessibilityLabel === "string" && node.props.accessibilityLabel.endsWith("可见") && !node.props.accessibilityState?.expanded)
    : action(["放弃草稿", "新建一件事", "继续编辑"].includes(label) || label.startsWith("继续：") ? "草稿" : "补充信息（可选）");
  if (toggle) await act(async () => { toggle.props.onPress(); });
}
