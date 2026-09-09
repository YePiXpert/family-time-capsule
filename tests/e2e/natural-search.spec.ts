import { test, expect } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import path from "node:path";
import { ensureBootstrap } from "./helpers";

let provider: Server, calls = 0;
test.beforeAll(async () => {
  provider=createServer(async(req,res)=>{
    for await (const _ of req) { void _; }
    calls++;res.setHeader("content-type","application/json");
    res.end(JSON.stringify({choices:[{finish_reason:"stop",message:{content:JSON.stringify({keywords:["公园"],synonyms:[],personNames:[],year:2024,month:2,mediaType:null})}}]}));
  });
  await new Promise<void>(resolve=>provider.listen(3998,"127.0.0.1",resolve));
});
test.afterAll(async()=>{provider.closeAllConnections();await new Promise<void>(resolve=>provider.close(()=>resolve()));});

test("explicit conversion persists once; refresh and prefetch do not call AI, month end and manual filters survive",async({page})=>{
  await ensureBootstrap(page);
  await page.goto("/settings/ai");
  const card=page.locator("article",{has:page.getByRole("heading",{name:"文字整理与信息建议"})});
  await card.getByRole("button",{name:"同意启用这项外部处理"}).click();
  await expect(card.getByText("可使用")).toBeVisible();
  for(const [date,title] of [["2024-02-29T12:00:00.000Z","公园二月最后一天"],["2024-03-01T12:00:00.000Z","公园三月第一天"]]){
    const id=randomUUID();
    const saved=await page.request.put(`/api/mobile/v1/drafts/${id}`,{data:{expectedRevision:0,mutationId:randomUUID(),content:{title,text:"公园的回忆",occurredAt:date,occurredAtPrecision:"date_only",locationText:"",participantIds:[],visibility:"family",readerUserIds:[],coverItemId:null,items:[]}}});
    expect(saved.ok(),await saved.text()).toBe(true);
    const published=await page.request.post(`/api/mobile/v1/drafts/${id}/publish`,{data:{expectedRevision:1}});
    expect(published.ok(),await published.text()).toBe(true);
  }
  await page.goto("/search?mode=natural&q=二月的公园");
  expect(calls).toBe(0);
  await expect(page.getByText("请点击“用一句话找”明确发起转换。打开或刷新链接不会调用模型。")).toBeVisible();
  const posted=page.waitForRequest(req=>req.url().endsWith("/api/search/natural")&&req.method()==="POST");
  await page.getByRole("button",{name:"自然语言辅助检索：先把这句话转换成受限检索条件，再查本地索引"}).click();
  const originalPost=await posted;
  await expect(page.getByRole("link",{name:"公园二月最后一天",exact:true})).toBeVisible();
  await expect(page.getByRole("link",{name:"公园三月第一天",exact:true})).toHaveCount(0);
  expect(calls).toBe(1);
  const resultUrl=page.url();
  await page.reload();
  await page.request.get(resultUrl,{headers:{purpose:"prefetch"}});
  const duplicate=await page.request.post("/api/search/natural",{headers:{"content-type":"application/x-www-form-urlencoded"},data:originalPost.postData()!,maxRedirects:0});
  expect(duplicate.status()).toBe(303); expect(calls).toBe(1);
  await page.getByLabel("开始日期").fill("2025-01-01");
  await page.getByLabel("结束日期").fill("2025-12-31");
  await page.getByLabel("按媒介过滤").selectOption("audio");
  await page.getByRole("button",{name:"自然语言辅助检索：先把这句话转换成受限检索条件，再查本地索引"}).click();
  await expect(page.getByText(/共 0 条结果/)).toBeVisible();
  expect(calls).toBe(2);
  const db=new Database(path.join(process.cwd(),"data/e2e-natural-search/db/capsule.sqlite"),{readonly:true});
  try {
    const row=db.prepare("select result_json from ai_search_operation where state='completed' order by created_at desc limit 1").get() as {result_json:string};
    expect(JSON.parse(row.result_json).params).toMatchObject({dateFrom:"2025-01-01",dateTo:"2025-12-31",mediaType:"audio"});
  } finally {db.close();}
  await page.getByRole("button",{name:"自然语言辅助检索：先把这句话转换成受限检索条件，再查本地索引"}).click();
  await expect(page.getByText(/这次转换未完成或已经失效/)).toBeVisible();
  expect(calls).toBe(2);
});
