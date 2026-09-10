import type { ReactTestRenderer } from "react-test-renderer";
import { expect } from "vitest";

/** Capture actions must already be available; tests never open a menu for them. */
export async function revealCaptureAction(tree: ReactTestRenderer, label: string) {
  expect(tree.root.findAllByType("Pressable" as never).some(node => node.props.accessibilityLabel === label || node.findAllByType("Text" as never).some(text => text.children.join("") === label)), `Direct action: ${label}`).toBe(true);
}
