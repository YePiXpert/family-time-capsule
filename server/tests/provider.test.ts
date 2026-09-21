import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { cpaProvider } from '../src/provider.ts';

test('CPA receives Flash with High thinking for grouping and writing', async () => {
 const dir=mkdtempSync(join(tmpdir(),'anan-provider-'));
 const keyFile=join(dir,'key');writeFileSync(keyFile,'test-only-key');
 const sent:Record<string,unknown>[]=[];
 const server=createServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk;
  const body=JSON.parse(raw);sent.push(body);
  assert.equal(req.url,'/v1/chat/completions');
  assert.equal(req.headers.authorization,'Bearer test-only-key');
  const result=sent.length===1?{groups:[{photoIds:['photo'],title:'图形',summary:'红色方块'}]}:{title:'图形',text:'一块红色方块。'};
  res.setHeader('Content-Type','application/json');
  res.end(JSON.stringify({choices:[{message:{reasoning_content:'private reasoning',content:JSON.stringify(result)}}],usage:{total_tokens:42}}));
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 try {
  const port=(server.address() as {port:number}).port;
  const provider=cpaProvider(`http://127.0.0.1:${port}/v1`,keyFile);
  for(const kind of ['group','write'] as const){
   const output=await provider(kind,{requestId:randomUUID(),model:'deepseek-flash',photos:[{id:'photo',image:'data:image/jpeg;base64,/9j/2Q=='}],mode:'photos',context:''});
   assert.equal(output.tokens,42);
   assert.ok(!JSON.stringify(output).includes('private reasoning'));
  }
  for(const body of sent){
   assert.equal(body.model,'deepseek-flash');
   assert.equal(body.reasoning_effort,'high');
   assert.deepEqual(body.thinking,{type:'enabled'});
   assert.ok(Number(body.max_tokens)>=8192,'Thinking and final JSON need a shared output budget');
  }
 } finally {
  await new Promise<void>((resolve,reject)=>server.close(err=>err?reject(err):resolve()));
  rmSync(dir,{recursive:true,force:true});
 }
});

test('recap requests use the year-note prompt and send no images', async () => {
 const dir=mkdtempSync(join(tmpdir(),'anan-provider-'));
 const keyFile=join(dir,'key');writeFileSync(keyFile,'test-only-key');
 let sentBody:Record<string,unknown>|undefined;
 const server=createServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk;
  sentBody=JSON.parse(raw);
  res.setHeader('Content-Type','application/json');
  res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({title:'这一年想说的话',text:'慢慢长大。'})}}],usage:{total_tokens:7}}));
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 try {
  const port=(server.address() as {port:number}).port;
  const provider=cpaProvider(`http://127.0.0.1:${port}/v1`,keyFile);
  const output=await provider('write',{requestId:randomUUID(),model:'deepseek-flash',photos:[],mode:'photos',context:'这一年共有 3 条记录。',writingMode:'recap'});
  assert.equal((output.result as {title:string;text:string}).text,'慢慢长大。');
  const messages=(sentBody!.messages as {role:string,content:unknown}[]);
  assert.ok(String(messages[0]!.content).includes('扉页寄语'),'recap must use the year-note prompt');
  const userContent=JSON.stringify(messages[1]!.content);
  assert.ok(!userContent.includes('image_url'),'recap never uploads photos');
  assert.ok(userContent.includes('年度寄语'));
 } finally {
  await new Promise<void>((resolve,reject)=>server.close(err=>err?reject(err):resolve()));
  rmSync(dir,{recursive:true,force:true});
 }
});

test('each mode sends its exact prompt and preserves text-only context',async(t)=>{
 const {PROMPTS}=await import('../src/prompts.ts');
 const {editorContext,editorResult}=await import('./helpers.ts');
 const dir=mkdtempSync(join(tmpdir(),'anan-provider-modes-')),keyFile=join(dir,'key');writeFileSync(keyFile,'test-only-key');
 const provider=cpaProvider('http://gateway.invalid/v1',keyFile);
 let sent:{messages:{role:string;content:unknown}[];max_tokens:number;response_format:unknown;thinking:unknown;reasoning_effort:string}|undefined;
 let result:unknown;
 // 模拟网关的 fetch 边界，不需要监听端口。
 t.mock.method(globalThis,'fetch',async(_url:unknown,options:RequestInit)=>{
  sent=JSON.parse(String(options.body));
  return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(result)}}],usage:{total_tokens:8}}));
 });
 try {
  for(const mode of ['group','generate','polish','recap','ask','question','letter','editor'] as const){
   result=mode==='group'?{groups:[{photoIds:['p'],title:'图形',summary:'方块'}]}:mode==='ask'?{questions:['谁在旁边？'],first:false}:mode==='question'?{question:'谁在旁边？'}:mode==='letter'?{questions:['你现在想记下什么？','想给她留哪句话？']}:mode==='editor'?editorResult:{title:'标题',text:'正文'};
   const context=mode==='editor'?JSON.stringify(editorContext):'合成上下文';
   const photos=mode==='group'||mode==='generate'?[{id:'p',image:'data:image/jpeg;base64,/9j/2Q=='}]:[];
   const output=await provider(mode==='group'?'group':'write',{requestId:randomUUID(),model:'deepseek-flash',mode:'photos',writingMode:mode==='group'?undefined:mode,photos,context});
   assert.equal(output.tokens,8);assert.equal(sent!.messages[0]!.content,PROMPTS[mode]);
   const content=sent!.messages[1]!.content as {type:string;text:string}[];
   assert.equal(content.length,photos.length?3:1);assert.equal(JSON.parse(content[0]!.text).userContext,context);
   const task={ask:'像访谈者追问一到三个问题，不写正文',question:'给今天一个小问题',letter:'给写信前的两到三个问题',editor:'提一个目录建议，不改原文'};
   if(mode in task)assert.equal(JSON.parse(content[0]!.text).task,task[mode as keyof typeof task]);
   assert.equal(sent!.max_tokens,16384);assert.deepEqual(sent!.response_format,{type:'json_object'});
   assert.deepEqual(sent!.thinking,{type:'enabled'});assert.equal(sent!.reasoning_effort,'high');
  }
  result={questions:['温馨吗？'],first:false};
  await assert.rejects(()=>provider('write',{requestId:randomUUID(),model:'deepseek-flash',mode:'photos',writingMode:'ask',photos:[],context:'今天她笑了'}),{message:'AI 问得不合规矩，请重试。'});
 } finally {rmSync(dir,{recursive:true,force:true});}
});
