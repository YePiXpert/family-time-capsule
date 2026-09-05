import { expect, test } from "@playwright/test";
import { ensureBootstrap } from "./helpers";
import { randomUUID } from "node:crypto";
import { defaultBookLayout } from "../../mobile/src/books/types";
import type { BookDetail } from "../../mobile/src/books/types";
test("真实记忆选材 → 手工编辑与排序 → 保存重开 → 32 页虚构作品预览与冲突保留", async ({
  page,
}) => {
  await ensureBootstrap(page);
  for (let i = 1; i <= 2; i++) {
    await page.goto("/capture");
    await page
      .getByPlaceholder("今天想留下什么话？写给未来的她，或只是记下此刻。")
      .fill(`虚构素材 ${i}：我们在窗边读了一封信。`);
    await page.getByRole("button", { name: "写一段话" }).click();
    await expect(page.getByText("已收进收件箱。")).toBeVisible();
    await page.goto("/inbox");
    await page.getByLabel("事件标题").fill(`虚构家庭片段 ${i}`);
    await page.getByRole("button", { name: "确认进入时间轴" }).click();
    await expect(page).toHaveURL(/\/memories\//);
  }
  await page.goto("/books");
  await page.getByLabel("作品名称").fill("虚构家庭的成长年册");
  await page.getByRole("radio", {name:"图文成长册"}).check();
  await page.getByRole("button", { name: "建立可编辑作品" }).click();
  await expect(page).toHaveURL(/\/books\/[a-f0-9-]+$/);
  const url = page.url(),
    id = url.split("/").at(-1)!;
  await page.getByText("从真实记忆中选材", { exact: true }).click();
  await page.getByRole("checkbox", { name: "虚构家庭片段 1" }).check();
  await page.getByRole("checkbox", { name: "虚构家庭片段 2" }).check();
  await page.getByRole("button", { name: "加入所选 2 项来源" }).click();
  await expect(page.getByRole("textbox", { name: "正文", exact: true })).toHaveCount(4);
  await page
    .getByRole("textbox", { name: "正文", exact: true })
    .nth(1)
    .fill("手工整理：窗边的第一封家书。");
  await page
    .getByRole("button", { name: "内容下移", exact: true })
    .nth(1)
    .click();
  await page.getByRole("button", { name: "保存当前编辑" }).click();
  await expect(page.getByText("已自动保存，可以随时重开。")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("textbox", { name: "正文", exact: true }).nth(2)).toHaveValue(
    "手工整理：窗边的第一封家书。",
  );
  let doc = (await (
    await page.request.get(`/api/books/projects/${id}`)
  ).json()) as BookDetail;
  const response = await page.request.patch(`/api/books/projects/${id}`, {
    data: {
      operation: "save",
      revision: doc.revision,
      edit: {
        ...doc,
        blocks: Array.from({ length: 32 }, (_, i) => ({
          id: randomUUID(),
          chapterId: doc.chapters[0]!.id,
          kind: "text",
          text: `第 ${i + 1} 页虚构家书。春天，我们在窗边一起阅读。This fictional family keeps a letter.`,
          caption: "虚构出版验收素材",
          layout: { ...defaultBookLayout(), breakBefore: true },
          sourceIds: doc.blocks[0]!.sourceIds,
        })),
      },
    },
  });
  expect(response.status()).toBe(200);
  await page.reload();
  await expect(page.getByRole("textbox", { name: "正文", exact: true })).toHaveCount(32);
  await page.getByRole("button", { name: "保存版本快照" }).click();
  await expect(page.getByText("已保存版本快照。")).toBeVisible();
  await page.getByRole("button", { name: "预览作品" }).click();
  await expect(
    page.getByText(
      "第 32 页虚构家书。春天，我们在窗边一起阅读。This fictional family keeps a letter.",
    ),
  ).toBeVisible();
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 950 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/book-fictional-${width}.png`,
      fullPage: true,
    });
  }
  await page.getByRole("button", { name: "继续编辑" }).click();
  doc = await (await page.request.get(`/api/books/projects/${id}`)).json();
  await page.request.patch(`/api/books/projects/${id}`, {
    data: {
      operation: "save",
      revision: doc.revision,
      edit: { ...doc, subtitle: "另一位家人的服务器修改" },
    },
  });
  await page
    .getByRole("textbox", { name: "正文", exact: true })
    .first()
    .fill("冲突时必须保留的本地输入");
  await page.getByRole("button", { name: "保存当前编辑" }).click();
  await expect(page.getByRole("alert").filter({hasText:"其他家人已修改这份作品"})).toContainText("你的输入仍保留");
  await expect(page.getByRole("textbox", { name: "正文", exact: true }).first()).toHaveValue(
    "冲突时必须保留的本地输入",
  );
});
