import { expect, test } from '@playwright/test';
import path from 'node:path';
import { ensureBootstrap } from './helpers';
test('真实相册编辑：多选、章节、顺序、重开、冲突与删除恢复',async({page})=>{
  await ensureBootstrap(page);
  for(const [index,title] of ['回家第一天','窗边的午后'].entries()){
    await page.goto('/capture');await page.getByLabel('写下这一刻').fill(`虚构家庭记录：${title}。`);await page.getByLabel('标题',{exact:true}).fill(title);await page.getByLabel('发生时间',{exact:true}).fill(`2026-08-${10+index}T12:30`);await page.getByRole('button',{name:/先收进来/}).click();await expect(page.getByText('已收进收件箱')).toBeVisible();await page.goto('/inbox');await page.getByRole('button',{name:'确认进入时间轴'}).click();await expect(page.getByRole('heading',{level:1,name:title})).toBeVisible();
  }
  await page.goto('/collections');await page.getByLabel('名称',{exact:true}).fill('出生第一周');await page.getByLabel('形式').selectOption('chapter');await page.getByRole('button',{name:'新建相册 / 章节',exact:true}).click();
  await expect(page).toHaveURL(/\/collections\/[\w-]+$/);const url=page.url(),id=url.split('/').at(-1)!;
  await page.getByLabel('简介').fill('虚构家庭的第一本相册，保留每个人当时的原话。');await page.getByRole('button',{name:'添加小节',exact:true}).click();await page.getByLabel('小节 1 名称').fill('在家里的日子');await page.getByRole('button',{name:'保存相册',exact:true}).click();await expect(page.getByRole('status')).toHaveText('已保存，可以随时重开。');
  await page.getByRole('link',{name:'从时间轴多选记忆'}).click();await page.getByLabel('回家第一天',{exact:true}).check();await page.getByLabel('窗边的午后',{exact:true}).check();await page.getByRole('button',{name:'加入所选 2 条记忆',exact:true}).click();await page.getByRole('link',{name:'打开相册',exact:true}).click();
  await page.getByLabel('图文说明').first().fill('手写说明：那天阳光很暖。');await page.getByLabel('所属小节').first().selectOption({label:'在家里的日子'});await page.getByRole('button',{name:'下移 回家第一天',exact:true}).focus();await page.keyboard.press('Enter');await page.getByRole('button',{name:'保存排序与说明'}).click();await expect(page.getByRole('status')).toHaveText('已保存，可以随时重开。');
  await page.reload();await expect(page.getByRole('link',{name:'窗边的午后',exact:true})).toBeVisible();await expect(page.getByLabel('图文说明').nth(1)).toHaveValue('手写说明：那天阳光很暖。');expect(await page.locator('ol li a').allTextContents()).toEqual(['窗边的午后','回家第一天']);
  for(const width of [375,768,1024,1440]){await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);await page.screenshot({path:`test-results/collection-fictional-${width}.png`,fullPage:true});}
  await page.getByRole('button',{name:'阅读相册',exact:true}).click();await expect(page.getByRole('heading',{name:'在家里的日子',exact:true})).toBeVisible();await expect(page.getByText('手写说明：那天阳光很暖。',{exact:true})).toBeVisible();await expect(page.getByLabel('图文说明')).toHaveCount(0);await page.getByRole('button',{name:'继续编辑',exact:true}).click();
  const response=await page.request.get(`/api/collections/${id}`),current=await response.json();const remote=await page.request.patch(`/api/collections/${id}`,{data:{operation:'save',revision:current.revision,edit:{...current,title:'另一位家人的更新'}}});expect(remote.status()).toBe(200);
  await page.getByLabel('名称',{exact:true}).fill('我的未保存标题');await page.getByRole('button',{name:'保存相册',exact:true}).click();await expect(page.locator('main').getByRole('alert')).toContainText('其他家人已修改');await expect(page.getByLabel('名称',{exact:true})).toHaveValue('我的未保存标题');
  page.on('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'重新读取服务器版本'}).click();await expect(page.getByLabel('名称',{exact:true})).toHaveValue('另一位家人的更新');
  await page.getByRole('button',{name:'删除相册',exact:true}).click();await expect(page.getByRole('button',{name:'恢复相册',exact:true})).toBeVisible();await page.getByRole('button',{name:'恢复相册',exact:true}).click();await expect(page.getByRole('link',{name:'回家第一天',exact:true})).toBeVisible();
  await page.goto('/timeline');await expect(page.getByRole('link',{name:/回家第一天/})).toBeVisible();await expect(page.getByRole('link',{name:/窗边的午后/})).toBeVisible();
});

test('相册选择跨越第一页，并能直接恢复时间轴指定的旧相册', async ({page}) => {
  await ensureBootstrap(page);
  const ids: string[] = [];
  for (let i=0; i<32; i++) {
    const r=await page.request.post('/api/collections',{data:{title:`分页相册 ${i}`,kind:'album'}});
    expect(r.status()).toBe(201);ids.push((await r.json()).id);
  }
  const firstPage=await (await page.request.get('/api/collections')).json();
  const outside=ids.find(id=>!firstPage.entries.some((entry:{id:string})=>entry.id===id))!;expect(outside).toBeTruthy();
  await page.goto('/timeline');
  await page.getByText('多选整理到相册 / 章节',{exact:true}).click();
  const select=page.getByRole('combobox',{name:'目标相册',exact:true});
  await expect(select.locator('option')).toHaveCount(31);
  await page.getByRole('button',{name:'读取更多相册',exact:true}).click();
  await expect(select.locator(`option[value="${outside}"]`)).toHaveCount(1);
  await page.goto(`/timeline?collection=${outside}`);
  await expect(page.getByRole('combobox',{name:'目标相册',exact:true})).toHaveValue(outside);
  await expect(page.getByRole('combobox',{name:'目标相册',exact:true}).locator(`option[value="${outside}"]`)).toHaveCount(1);
});

test('访客限定阅读链接：只读单册、范围外媒体 404、收回即失效（M2-d ID-5）', async ({ page, browser }) => {
  await ensureBootstrap(page);
  // 自备一条带照片的记忆 + 一本相册
  await page.goto('/capture');
  await page
    .locator('input[type="file"]').first()
    .setInputFiles(path.join(__dirname, '..', 'fixtures', 'sample-exif.jpg'));
  await page.getByRole("button", { name: "保留草稿，稍后继续" }).click(); await expect(page.getByText("服务器已收到草稿", { exact: false })).toBeVisible();
  await page.goto('/capture');
  await page.getByLabel('写下这一刻').fill('虚构记录：给外婆的相册素材。');
  await page.getByLabel('标题', { exact: true }).fill('阳光下的午后');
  await page.getByLabel('发生时间', { exact: true }).fill('2026-08-15T15:00');
  await page.getByRole('button', { name: /先收进来/ }).click();
  await expect(page.getByText('已收进收件箱')).toBeVisible();
  await page.goto('/inbox');
  const checkboxes = page.getByRole('checkbox');
  await expect(checkboxes).toHaveCount(2);
  for (const box of await checkboxes.all()) await box.check();
  await page.getByLabel('合并事件标题').fill('阳光下的午后');
  await page.getByRole('button', { name: '合并' }).click();
  await expect(page.getByRole('heading', { name: '阳光下的午后' })).toBeVisible();
  await page.goto('/collections');
  await page.getByLabel('名称', { exact: true }).fill('给外婆的只读相册');
  await page.getByRole('button', { name: '新建相册 / 章节', exact: true }).click();
  await expect(page).toHaveURL(/\/collections\/[\w-]+$/);
  const collectionUrl = page.url();
  await page.getByRole('link', { name: '从时间轴多选记忆' }).click();
  await page.getByLabel('阳光下的午后', { exact: true }).check();
  await page.getByRole('button', { name: /加入所选/ }).click();
  await page.getByRole('link', { name: '打开相册', exact: true }).click();

  // 生成只读链接
  await page.goto(collectionUrl);
  await page.getByLabel('有效期').selectOption('7');
  await page.getByRole('button', { name: '生成只读链接' }).click();
  const pathText = await page.locator('code').first().textContent();
  expect(pathText).toMatch(/^\/view\/[A-Za-z0-9_-]+$/);
  const viewPath = pathText!.trim();

  // 无会话访客上下文：能打开、能看到内容；越权媒体 404
  const guestContext = await browser.newContext();
  try {
    const guest = await guestContext.newPage();
    await guest.goto(viewPath);
    await expect(guest.getByRole('heading', { name: '给外婆的只读相册' })).toBeVisible();
    await expect(guest.getByRole('heading', { name: '阳光下的午后' })).toBeVisible();
    const img = guest.locator('img').first();
    await expect(img).toBeVisible();
    const src = await img.getAttribute('src');
    expect(src).toMatch(/^\/api\/media\/[\w-]+\?grant=/);
    // 相册内媒体可流式读取
    const inScope = await guest.request.get(src!);
    expect(inScope.status()).toBe(200);
    // 范围外（不存在的资产）与无 grant 参数都被拒绝
    expect((await guest.request.get('/api/media/not-an-asset')).status()).toBe(401);
    expect((await guest.request.get('/api/media/not-an-asset?grant=bad-token-000000')).status()).toBe(401);
  } finally {
    await guestContext.close();
  }

  // 收回后访客立即失效
  await page.getByRole('button', { name: '收回链接' }).click();
  await expect(page.getByText('已收回').first()).toBeVisible();
  const guestContext2 = await browser.newContext();
  try {
    const guest2 = await guestContext2.newPage();
    const gone = await guest2.goto(viewPath);
    expect(gone?.status()).toBe(404);
  } finally {
    await guestContext2.close();
  }
});
