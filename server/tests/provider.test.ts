import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { mimoProvider } from '../src/provider.ts';
import { loadMiMoConfig } from '../src/ai-config.ts';
import { inputSchema, type AIInput } from '../src/contracts.ts';
import { PROMPTS } from '../src/prompts.ts';
import { Problem } from '../src/store.ts';
import { editorContext, editorResult } from './helpers.ts';

const photo={id:'p',date:'2026-09-01T12:00:00',place:'place-1',image:'data:image/jpeg;base64,/9j/2Q=='};
const group={groups:[{photoIds:['p'],title:'图形',summary:'方块'}]};
const write={title:'桌边的积木',text:'我把积木放在桌边。'};
const input=(extra:Partial<AIInput>={})=>inputSchema.parse({requestId:randomUUID(),photos:[photo],...extra});
const response=(result:unknown,finish_reason:unknown='stop')=>Response.json({choices:[{finish_reason,message:{content:JSON.stringify(result),reasoning_content:'private reasoning'}}],usage:{total_tokens:42}});
const invalid=(error:unknown)=>error instanceof Problem&&error.status===502&&error.code==='INVALID_RESULT';
function fixture(t:TestContext) {
 const dir=mkdtempSync(join(tmpdir(),'anan-mimo-provider-')),keyFile=join(dir,'key');writeFileSync(keyFile,'test-only-key\n');
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const config=loadMiMoConfig('AI',{AI_PROVIDER:'mimo',AI_MODEL:'mimo-v2.6-pro',AI_BASE_URL:'https://api.xiaomimimo.com/v1',AI_KEY_FILE:keyFile,AI_ACCESS:'payg-approved'});
 let respond:()=>Response=()=>response(write);
 const sent:{url:string;body:any;authorization:string|null}[]=[];
 t.mock.method(globalThis,'fetch',async(url:URL,options:RequestInit)=>{
  assert.equal(url.href,'https://api.xiaomimimo.com/v1/chat/completions');
  assert.equal(options.method,'POST');assert.equal(options.redirect,'error');assert.ok(options.signal instanceof AbortSignal);
  sent.push({url:url.href,body:JSON.parse(String(options.body)),authorization:new Headers(options.headers).get('authorization')});
  return respond();
 });
 return {provider:mimoProvider(config),sent,keyFile,respond:(fn:()=>Response)=>{respond=fn;}};
}
const modes=[
 ['group','enabled',group],['generate','enabled',write],['polish','disabled',write],['recap','enabled',write],
 ['ask','disabled',{questions:['谁在旁边？'],first:false}],['question','disabled',{question:'谁在旁边？'}],
 ['letter','disabled',{questions:['你现在想记下什么？','想给她留哪句话？']}],['editor','enabled',editorResult],
] as const;
for(const [mode,thinking,result] of modes)test(`MiMo ${mode}: pinned model, ${thinking} thinking and exact existing prompt`,async t=>{
 const f=fixture(t);f.respond(()=>response(result));
 const photos=mode==='group'||mode==='generate'?[photo]:[];
 const context=mode==='editor'?JSON.stringify(editorContext):'合成上下文';
 const out=await f.provider(mode==='group'?'group':'write',input({photos,context,writingMode:mode==='group'?undefined:mode}));
 assert.deepEqual(out,{result,tokens:42});assert.ok(!JSON.stringify(out).includes('private reasoning'));
 assert.equal(f.sent.length,1);const {body,authorization}=f.sent[0]!;
 assert.equal(authorization,'Bearer test-only-key');assert.equal(body.model,'mimo-v2.6-pro');
 assert.deepEqual(body.thinking,{type:thinking});assert.equal(body.max_completion_tokens,16384);
 for(const field of ['max_tokens','reasoning_effort','temperature','top_p'])assert.equal(field in body,false,field);
 assert.equal(body.stream,false);assert.deepEqual(body.response_format,{type:'json_object'});
 assert.equal(body.messages[0].content,PROMPTS[mode]);
 assert.equal(JSON.parse(body.messages[1].content[0].text).userContext,context);
 assert.equal(body.messages[1].content.length,photos.length?3:1);
 if(photos.length){
  assert.deepEqual(JSON.parse(body.messages[1].content[1].text),{photoId:'p',capturedAt:photo.date,localPlaceGroup:'place-1'});
  assert.deepEqual(body.messages[1].content[2],{type:'image_url',image_url:{url:photo.image}});
 }
});

test('multiple images preserve every thumbnail and ID; merge sends only original group summaries',async t=>{
 const f=fixture(t),second={...photo,id:'q'},merged={groups:[{photoIds:['p','q'],title:'桌边',summary:'方块'}]};f.respond(()=>response(merged));
 await f.provider('group',input({photos:[photo,second]}));
 const content=f.sent[0]!.body.messages[1].content;
 assert.deepEqual(content.filter((v:any)=>v.type==='image_url'),[photo,second].map(p=>({type:'image_url',image_url:{url:p.image}})));
 assert.deepEqual([content[1],content[3]].map(v=>JSON.parse(v.text).photoId),['p','q']);
 const groups=[{photoIds:['p'],title:'桌边',summary:'方块'},{photoIds:['q'],title:'桌边',summary:'另一块'}];
 await f.provider('group',input({mode:'merge',photos:[],groups}));
 const body=f.sent[1]!.body;assert.deepEqual(body.thinking,{type:'enabled'});assert.equal(body.messages[0].content,PROMPTS.group);
 assert.equal(body.messages[1].content.length,1);assert.deepEqual(JSON.parse(body.messages[1].content[0].text),{task:'合并属于同一天同一件事情的分组摘要，保留全部照片ID',userContext:'',groups});
});

for(const finish of ['length','content_filter','tool_calls','repetition_truncation',null,'unknown'])test(`reject ${finish} even when final JSON looks valid`,async t=>{
 const f=fixture(t);f.respond(()=>response(write,finish));await assert.rejects(f.provider('write',input()),invalid);assert.equal(f.sent.length,1);
});
for(const [name,body] of [
 ['missing finish_reason',{choices:[{message:{content:JSON.stringify(write)}}]}],
 ['no choices',{choices:[]}],['null content',{choices:[{finish_reason:'stop',message:{content:null}}]}],
 ['empty content',{choices:[{finish_reason:'stop',message:{content:'  '}}]}],
 ['reasoning is not final content',{choices:[{finish_reason:'stop',message:{reasoning_content:JSON.stringify(write)}}]}],
 ['bad final JSON',{choices:[{finish_reason:'stop',message:{content:'{"title":'}}]}],
 ['markdown instead of JSON',{choices:[{finish_reason:'stop',message:{content:'```json\n'+JSON.stringify(write)+'\n```'}}]}],
] as const)test(name,async t=>{const f=fixture(t);f.respond(()=>Response.json(body));await assert.rejects(f.provider('write',input()),invalid);});

for(const result of [{title:'没有正文'},{title:'标题',text:'正文',extra:'invented'},{title:'标题',text:5}])test('reject invalid business fields',async t=>{
 const f=fixture(t);f.respond(()=>response(result));await assert.rejects(f.provider('write',input()),invalid);
});
for(const ids of [['unknown'],[],['p','p']])test(`reject unknown, missing or duplicate photo IDs: ${ids.join(',')}`,async t=>{
 const f=fixture(t);f.respond(()=>response({groups:[{photoIds:ids,title:'桌边',summary:'方块'}]}));
 await assert.rejects(f.provider('group',input()),invalid);
 await assert.rejects(f.provider('group',input({mode:'merge',photos:[],groups:group.groups})),invalid);
});
test('reject unknown annual-record IDs and invented quotations',async t=>{
 const f=fixture(t),req=input({photos:[],writingMode:'editor',context:JSON.stringify(editorContext)});
 for(const mutate of [
  (r:typeof editorResult)=>{r.chapters[0]!.picks=['unknown'];},
  (r:typeof editorResult)=>{r.chapters[0]!.quote={recordId:'unknown',text:'再搭一层'};},
  (r:typeof editorResult)=>{r.chapters[0]!.quote.text='并不存在的原话';},
 ]){const bad=structuredClone(editorResult);mutate(bad);f.respond(()=>response(bad));await assert.rejects(f.provider('write',req),invalid);}
});
test('question business validation and cross-date photo grouping remain strict',async t=>{
 const f=fixture(t);f.respond(()=>response({questions:['温馨吗？'],first:false}));await assert.rejects(f.provider('write',input({photos:[],writingMode:'ask',context:'今天她笑了'})),invalid);
 f.respond(()=>response({groups:[{photoIds:['p','q'],title:'桌边',summary:'方块'}]}));
 await assert.rejects(f.provider('group',input({photos:[photo,{...photo,id:'q',date:'2026-09-02'}]})),invalid);
});
for(const status of [401,403,429,500,502,503])test(`HTTP ${status} is sanitized, not retried or rerouted`,async t=>{
 const f=fixture(t);f.respond(()=>new Response('secret upstream body',{status}));
 await assert.rejects(f.provider('write',input()),(e:unknown)=>e instanceof Problem&&e.status===(status===429?429:502)&&e.code==='UPSTREAM_UNAVAILABLE'&&!e.message.includes('secret'));
 assert.equal(f.sent.length,1);
});
for(const error of [new TypeError('connection failed'),new DOMException('deadline','TimeoutError')])test(`${error.name} maps to connection failure without retry`,async t=>{
 const f=fixture(t);f.respond(()=>{throw error;});await assert.rejects(f.provider('write',input()),{code:'UPSTREAM_UNAVAILABLE',status:502});assert.equal(f.sent.length,1);
});
test('body read failure, malformed JSON and oversized responses fail closed',async t=>{
 const f=fixture(t);
 f.respond(()=>new Response(new ReadableStream({start(controller){controller.error(new Error('broken stream'));}})));
 await assert.rejects(f.provider('write',input()),{code:'UPSTREAM_UNAVAILABLE',status:502});
 for(const body of ['not JSON','x'.repeat(250001)]){f.respond(()=>new Response(body));await assert.rejects(f.provider('write',input()),invalid);}
});
test('read secret on each request; mismatched rotated key is rejected before any request',async t=>{
 const f=fixture(t);await f.provider('write',input());writeFileSync(f.keyFile,'rotated-test-key');await f.provider('write',input());
 assert.equal(f.sent[1]!.authorization,'Bearer rotated-test-key');
 writeFileSync(f.keyFile,'tp-test-only-mismatch');await assert.rejects(f.provider('write',input()),{code:'UPSTREAM_UNAVAILABLE'});assert.equal(f.sent.length,2);
});
