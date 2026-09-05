import { expect, test } from "@playwright/test";
import { ensureBootstrap } from "./helpers";
import path from "node:path";
import { spawn } from "node:child_process";
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
  await page.getByRole("radio", { name: "图文成长册" }).check();
  await page.getByRole("button", { name: "建立可编辑作品" }).click();
  await expect(page).toHaveURL(/\/books\/[a-f0-9-]+$/);
  const url = page.url(),
    id = url.split("/").at(-1)!;
  await page.getByText("从真实记忆中选材", { exact: true }).click();
  await page.getByRole("checkbox", { name: "虚构家庭片段 1" }).check();
  await page.getByRole("checkbox", { name: "虚构家庭片段 2" }).check();
  await page.getByRole("button", { name: "加入所选 2 项来源" }).click();
  await expect(
    page.getByRole("textbox", { name: "正文", exact: true }),
  ).toHaveCount(4);
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
  await expect(
    page.getByRole("textbox", { name: "正文", exact: true }).nth(2),
  ).toHaveValue("手工整理：窗边的第一封家书。");
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
  await expect(
    page.getByRole("textbox", { name: "正文", exact: true }),
  ).toHaveCount(32);
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
  await expect(
    page.getByRole("alert").filter({ hasText: "其他家人已修改这份作品" }),
  ).toContainText("你的输入仍保留");
  await expect(
    page.getByRole("textbox", { name: "正文", exact: true }).first(),
  ).toHaveValue("冲突时必须保留的本地输入");
});

test("生产 worker 完成 PDF/EPUB，浏览器可预览下载并清理产物", async ({
  page, browser,
}) => {
  await ensureBootstrap(page);
  await page.goto("/books");
  await page.getByRole("link", { name: /虚构家庭的成长年册/ }).click();
  await expect(
    page.getByRole("heading", { name: "虚构家庭的成长年册", exact: true }),
  ).toBeVisible();
  const panel = page.getByRole("region", { name: "出版与下载" });
  for (const format of ["PDF", "EPUB", "精选阅读包 ZIP"]) {
    await panel
      .getByRole("button", { name: format === "精选阅读包 ZIP" ? "生成精选阅读包 ZIP" : `生成 ${format}`, exact: true })
      .click();
    await expect(panel.getByText(/等待后台排版/)).toBeVisible();
    const worker = spawn(process.execPath, [".next/ops/worker.mjs", "--once"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATA_DIR: path.join(process.cwd(), "data", "e2e-book-projects"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let log = "";
    worker.stdout.on("data", (c) => {
      log += c.toString();
    });
    worker.stderr.on("data", (c) => {
      log += c.toString();
    });
    const done = new Promise<number | null>((resolve, reject) => {
      worker.once("error", reject);
      worker.once("close", resolve);
    });
    expect((await page.request.get("/api/mobile/v1/home")).status()).toBe(200);
    expect(await done, log).toBe(0);
    expect(log).toContain("[book-worker] succeeded");
    await panel.getByRole("button", { name: "刷新出版状态" }).click();
    const link = panel.getByRole("link", {
      name: `下载 ${format}`,
      exact: true,
    });
    await expect(link).toBeVisible();
    const download = page.waitForEvent("download");
    await link.click();
    const file = await download;
    expect(await file.failure()).toBeNull();
    expect(file.suggestedFilename().endsWith(`.${format === "精选阅读包 ZIP" ? "zip" : format.toLowerCase()}`)).toBe(true);
    if(format === "精选阅读包 ZIP") {
      const {mkdtemp,mkdir,writeFile,readFile,rm}=await import("node:fs/promises"),{tmpdir}=await import("node:os"),{pathToFileURL}=await import("node:url"),JSZip=(await import("jszip")).default;
      const dir=await mkdtemp(path.join(tmpdir(),"ftc-production-reading-")),zip=await JSZip.loadAsync(await readFile((await file.path())!));
      const offline=await browser.newContext({offline:true});try{
        for(const entry of Object.values(zip.files)){if(entry.dir)continue;const target=path.join(dir,entry.name);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,await entry.async("nodebuffer"));}
        const reader=await offline.newPage(),network:string[]=[];reader.on("request",r=>{if(/^https?:/.test(r.url()))network.push(r.url());});await reader.goto(pathToFileURL(path.join(dir,"index.html")).href);await expect(reader.getByRole("heading",{name:"虚构家庭的成长年册",exact:true})).toBeVisible();await expect(reader.getByText(/第 32 页虚构家书/)).toBeVisible();expect(network).toEqual([]);
      }finally{await offline.close();await rm(dir,{recursive:true,force:true});}
    }
  }
  await expect(
    panel.getByRole("link", { name: "打开 PDF 预览" }),
  ).toBeVisible();
  await panel.getByRole("button", { name: "清理此下载产物" }).first().click();
  await expect(panel.getByText(/已取消/)).toBeVisible();
});

test("出生第一周回顾 → 人工精选 → 幂等年册草稿 → 明确复制，改日期后回顾与日历同步", async ({page}) => {
  await ensureBootstrap(page);
  const shelf=await(await page.request.get('/api/books/projects')).json();
  const sourceBook=await(await page.request.get(`/api/books/projects/${shelf.entries[0].id}`)).json();
  const sourceIds=sourceBook.sources.filter((s:{kind:string})=>s.kind==='memory').map((s:{memoryEventId:string})=>s.memoryEventId);
  expect(sourceIds.length).toBe(2);
  for(const [i,id] of sourceIds.entries()){
    const response=await page.request.patch(`/api/mobile/v1/memories/${id}`,{data:{occurredAtWall:`2026-08-${11+i}T08:00`,occurredAtPrecision:'exact'}});expect(response.status()).toBe(200);
  }
  await page.goto('/books/review');
  await page.getByRole('button',{name:'出生第一周',exact:true}).click();
  await expect(page.getByText(/2 段记忆 · 人工精选 0 段/)).toBeVisible();
  await page.getByRole('button',{name:'设为人工精选',exact:true}).first().click();
  await expect(page.getByText(/2 段记忆 · 人工精选 1 段/)).toBeVisible();
  for(const width of [375,768,1440]){
    await page.setViewportSize({width,height:1000});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
    await page.screenshot({path:`test-results/fictional-book-review-${width}.png`,fullPage:true});
  }
  await page.getByRole('button',{name:'建立可编辑年册草稿',exact:true}).focus();await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/books\/[a-f0-9-]+$/);const draftUrl=page.url();
  await page.getByLabel('副标题',{exact:true}).fill('虚构第一周手工整理，继续保存');
  await page.getByRole('button',{name:'保存当前编辑',exact:true}).click();
  await expect(page.getByText('已自动保存，可以随时重开。')).toBeVisible();
  await page.goto('/books/review?startDate=2026-08-10&endDate=2026-08-16');
  await expect(page.getByText(/还有 1 段当前范围的记忆尚未选入/)).toBeVisible();
  await page.getByRole('button',{name:'恢复同一草稿',exact:true}).click();await expect(page).toHaveURL(draftUrl);
  await expect(page.getByLabel('副标题',{exact:true})).toHaveValue('虚构第一周手工整理，继续保存');
  await page.getByRole('button',{name:'复制成新册',exact:true}).click();await expect(page).not.toHaveURL(draftUrl);await expect(page).toHaveURL(/\/books\/[a-f0-9-]+$/);
  await expect(page.getByLabel('副标题',{exact:true})).toHaveValue('虚构第一周手工整理，继续保存');
  const moved=await page.request.patch(`/api/mobile/v1/memories/${sourceIds[0]}`,{data:{occurredAtWall:'2026-09-10T08:00',occurredAtPrecision:'exact'}});expect(moved.status()).toBe(200);
  await page.goto('/books/review?startDate=2026-08-10&endDate=2026-08-16');await expect(page.getByText(/1 段记忆 · 人工精选/)).toBeVisible();
  await page.goto('/timeline/calendar?month=2026-09');await expect(page.getByRole('link',{name:'2026-09-10，1 条记忆',exact:true})).toBeVisible();
});
