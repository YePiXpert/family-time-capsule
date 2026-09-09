import type { Page } from "@playwright/test";

/** Legacy editing/review journeys explicitly open the new optional controls.
 * Quick-capture tests deliberately do not call this helper. */
export async function expandCaptureOptions(page: Page) {
  if (new URL(page.url()).pathname !== "/capture") return;
  if (await page.getByText("当前账号是只读角色", { exact: false }).isVisible()) return;
  for (const label of ["补充信息（可选）", "更多保存选项"]) {
    const summary = page.getByText(label, { exact: true });
    await summary.waitFor({ state: "visible" });
    if (!await summary.evaluate(node => (node.parentElement as HTMLDetailsElement).open)) await summary.click();
  }
}
