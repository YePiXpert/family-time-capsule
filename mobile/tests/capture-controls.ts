import { act, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { expect } from "vitest";

const matchesLabel = (label: string) => (node: ReactTestInstance) => node.props.accessibilityLabel === label || node.findAllByType("Text" as never).some(text => text.children.join("") === label);

/** Follow the visible composer controls, including closing reader choices first. */
export async function revealCaptureAction(tree: ReactTestRenderer, label: string) {
  const sheet = tree.root.findAllByType("GlassSheet" as never)[0];
  if (sheet && !sheet.findAllByType("Pressable" as never).some(matchesLabel(label))) {
    const done = sheet.findAllByType("Pressable" as never).find(node => matchesLabel("完成选择")(node) || matchesLabel("完成日期选择")(node));
    if (done) await act(async () => done.props.onPress());
  }
  const find = (target: string) => tree.root.findAllByType("Pressable" as never).find(matchesLabel(target));
  if (!find(label)) {
    if (["拍照", "录像", "录音", "文件"].includes(label)) {
      const tools = find("更多素材方式");
      expect(tools, "Capture tools entry").toBeDefined();
      await act(async () => tools!.props.onPress());
    } else if (["全家", "指定成员", "仅自己"].includes(label)) {
      const readers = tree.root.findByProps({ testID: "capture-readers" });
      await act(async () => readers.props.onPress());
    }
  }
  expect(find(label), `Visible capture action: ${label}`).toBeDefined();
}
