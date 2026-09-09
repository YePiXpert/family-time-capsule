import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { expect, it, vi } from "vitest";
vi.mock("react-native", () => ({ Text: "Text", TextInput: "TextInput", StyleSheet: { flatten: (style: unknown) => style } }));
const { Text, TextInput, TextScaleContext } = await import("../src/components/typography");
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
it("large display enlarges both reading and writing while keeping native font scaling", async () => {
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(createElement(TextScaleContext.Provider, {value:1.2}, createElement(Text,{style:{fontSize:20,lineHeight:28}},"记忆"),createElement(TextInput,{style:{fontSize:16},value:"一句话"}))); });
  expect(tree.root.findByType("Text" as never).props.style).toEqual([{fontSize:20,lineHeight:28},{fontSize:24,lineHeight:33.6}]);
  expect(tree.root.findByType("TextInput" as never).props.style).toEqual([{fontSize:16},{fontSize:19.2}]);
  expect(tree.root.findByType("Text" as never).props.allowFontScaling).not.toBe(false);
  await act(async () => tree.unmount());
});
