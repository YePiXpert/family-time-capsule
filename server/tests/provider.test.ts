import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { textProvider } from '../src/provider.ts';
import { loadAIConfig } from '../src/ai-config.ts';
import { inputSchema, type AIInput } from '../src/contracts.ts';
import { PROMPTS } from '../src/prompts.ts';
import { Problem } from '../src/store.ts';
import { editorContext, editorResult } from './helpers.ts';

const write={title:'桌边的积木',text:'我把积木放在桌边。'};
const input=(extra:Partial<AIInput>={})=>inputSchema.parse({requestId:randomUUID(),photos:[],writingMode:'polish',...extra});
const response=(result:unknown,finish_reason:unknown='stop')=>Response.json({choices:[{finish_reason,message:{content:JSON.stringify(result),reasoning_content:'private reasoning'}}],usage:{total_tokens:42}});
const invalid=(error:unknown)=>error instanceof Problem&&error.status===502&&error.code==='INVALID_RESULT';
function fixture(t:TestContext) {
 const dir=mkdtempSync(join(tmpdir(),'anan-text-provider-')),keyFile=join(dir,'key');writeFileSync(keyFile,'test-only-key\n');
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const config=loadAIConfig('AI',{AI_MODEL:'gpt-6-astra',UPSTREAM_BASE_URL:'https://upstream.example.invalid/v1',UPSTREAM_KEY_FILE:keyFile});
 let respond:()=>Response=()=>response(write);
 const sent:{url:string;body:any;authorization:string|null}[]=[];
 t.mock.method(globalThis,'fetch',async(url:URL,options:RequestInit)=>{
  assert.equal(url.href,'https://upstream.example.invalid/v1/chat/completions');
  assert.equal(options.method,'POST');assert.equal(options.redirect,'error');assert.ok(options.signal instanceof AbortSignal);
  sent.push({url:url.href,body:JSON.parse(String(options.body)),authorization:new Headers(options.headers).get('authorization')});
  return respond();
 });
 return {provider:textProvider(config),sent,keyFile,respond:(fn:()=>Response)=>{respond=fn;}};
}
const modes=[
 ['polish','medium',write],['recap','medium',write],
 ['ask','medium',{questions:['谁在旁边？'],first:false}],['question','medium',{question:'谁在旁边？'}],
 ['editor','medium',editorResult],
] as const;
for(const [mode,thinking,result] of modes)test(`GPT-6 Astra ${mode}: pinned model, ${thinking} reasoning and exact existing prompt`,async t=>{
 const f=fixture(t);f.respond(()=>response(result));
 const context=mode==='editor'?JSON.stringify(editorContext):'合成上下文';
 const out=await f.provider(input({context,writingMode:mode}));
 assert.deepEqual(out,{result,tokens:42});assert.ok(!JSON.stringify(out).includes('private reasoning'));
 assert.equal(f.sent.length,1);const {body,authorization}=f.sent[0]!;
 assert.equal(authorization,'Bearer test-only-key');assert.equal(body.model,'gpt-6-astra');
 assert.equal(body.reasoning_effort,thinking);assert.equal(body.max_completion_tokens,16384);
 for(const field of ['max_tokens','thinking','temperature','top_p'])assert.equal(field in body,false,field);
 assert.equal(body.stream,false);assert.deepEqual(body.response_format,{type:'json_object'});
 assert.equal(body.messages[0].content,PROMPTS[mode]);
 assert.equal(JSON.parse(body.messages[1].content[0].text).userContext,context);
 assert.equal(body.messages[1].content.length,1);
 assert.equal(body.messages[1].content[0].type,'text');
 assert.ok(!body.messages[1].content.some((part:{type:string})=>part.type==='image_url'));
});


for(const finish of ['length','content_filter','tool_calls','repetition_truncation',null,'unknown'])test(`reject ${finish} even when final JSON looks valid`,async t=>{
 const f=fixture(t);f.respond(()=>response(write,finish));await assert.rejects(f.provider(input()),invalid);assert.equal(f.sent.length,1);
});
for(const [name,body] of [
 ['missing finish_reason',{choices:[{message:{content:JSON.stringify(write)}}]}],
 ['no choices',{choices:[]}],['null content',{choices:[{finish_reason:'stop',message:{content:null}}]}],
 ['empty content',{choices:[{finish_reason:'stop',message:{content:'  '}}]}],
 ['reasoning is not final content',{choices:[{finish_reason:'stop',message:{reasoning_content:JSON.stringify(write)}}]}],
 ['bad final JSON',{choices:[{finish_reason:'stop',message:{content:'{"title":'}}]}],
 ['markdown instead of JSON',{choices:[{finish_reason:'stop',message:{content:'```json\n'+JSON.stringify(write)+'\n```'}}]}],
] as const)test(name,async t=>{const f=fixture(t);f.respond(()=>Response.json(body));await assert.rejects(f.provider(input()),invalid);});

for(const result of [{title:'没有正文'},{title:'标题',text:'正文',extra:'invented'},{title:'标题',text:5}])test('reject invalid business fields',async t=>{
 const f=fixture(t);f.respond(()=>response(result));await assert.rejects(f.provider(input()),invalid);
});
test('reject unknown annual-record IDs and invented quotations',async t=>{
 const f=fixture(t),req=input({photos:[],writingMode:'editor',context:JSON.stringify(editorContext)});
 for(const mutate of [
  (r:typeof editorResult)=>{r.chapters[0]!.picks=['unknown'];},
  (r:typeof editorResult)=>{r.chapters[0]!.quote={recordId:'unknown',text:'再搭一层'};},
  (r:typeof editorResult)=>{r.chapters[0]!.quote.text='并不存在的原话';},
 ]){const bad=structuredClone(editorResult);mutate(bad);f.respond(()=>response(bad));await assert.rejects(f.provider(req),invalid);}
});
test('question business validation remains strict',async t=>{
 const f=fixture(t);f.respond(()=>response({questions:['温馨吗？'],first:false}));await assert.rejects(f.provider(input({photos:[],writingMode:'ask',context:'今天她笑了'})),invalid);
});
for(const status of [401,403,429,500,502,503])test(`HTTP ${status} is sanitized, not retried or rerouted`,async t=>{
 const f=fixture(t);f.respond(()=>new Response('secret upstream body',{status}));
 await assert.rejects(f.provider(input()),(e:unknown)=>e instanceof Problem&&e.status===(status===429?429:502)&&e.code==='UPSTREAM_UNAVAILABLE'&&!e.message.includes('secret'));
 assert.equal(f.sent.length,1);
});
for(const error of [new TypeError('connection failed'),new DOMException('deadline','TimeoutError')])test(`${error.name} maps to connection failure without retry`,async t=>{
 const f=fixture(t);f.respond(()=>{throw error;});await assert.rejects(f.provider(input()),{code:'UPSTREAM_UNAVAILABLE',status:502});assert.equal(f.sent.length,1);
});
test('body read failure, malformed JSON and oversized responses fail closed',async t=>{
 const f=fixture(t);
 f.respond(()=>new Response(new ReadableStream({start(controller){controller.error(new Error('broken stream'));}})));
 await assert.rejects(f.provider(input()),{code:'UPSTREAM_UNAVAILABLE',status:502});
 for(const body of ['not JSON','x'.repeat(250001)]){f.respond(()=>new Response(body));await assert.rejects(f.provider(input()),invalid);}
});
test('read secret on each request; malformed rotated key is rejected before any request',async t=>{
 const f=fixture(t);await f.provider(input());writeFileSync(f.keyFile,'rotated-test-key');await f.provider(input());
 assert.equal(f.sent[1]!.authorization,'Bearer rotated-test-key');
 writeFileSync(f.keyFile,'invalid key with whitespace');await assert.rejects(f.provider(input()),{code:'UPSTREAM_UNAVAILABLE'});assert.equal(f.sent.length,2);
});
