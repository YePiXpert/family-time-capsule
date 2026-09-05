import { expect, test } from '@playwright/test';
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
