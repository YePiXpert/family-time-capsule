import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { loadAIConfig, readAIKey } from '../src/ai-config.ts';
import { textProvider } from '../src/provider.ts';
import { cpaTranscriber, wavHeader } from '../src/transcribe.ts';
import { inputSchema } from '../src/contracts.ts';
import { randomUUID } from 'node:crypto';
function fixture(t:TestContext){
 const dir=mkdtempSync(join(tmpdir(),'anan-ai-config-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const key=join(dir,'upstream-key');writeFileSync(key,'test-only-key');
 const env={AI_MODEL:'gpt-6-astra',TRANSCRIBE_MODEL:'mimo-v2.5-asr',UPSTREAM_BASE_URL:'https://upstream.example.invalid/v1',UPSTREAM_KEY_FILE:key};
 return {dir,key,env};
}
test('fixed text and ASR models require an explicit HTTPS upstream and readable secret, without network',t=>{
 const f=fixture(t);const fetch=t.mock.method(globalThis,'fetch',()=>{throw Error('must not send');});
 assert.equal(loadAIConfig('AI',f.env).model,'gpt-6-astra');assert.equal(loadAIConfig('TRANSCRIBE',f.env).model,'mimo-v2.5-asr');
 for(const patch of [
  {AI_MODEL:'deepseek-flash'},{AI_MODEL:'mimo-v2.6-pro'},{AI_MODEL:'gpt-6-luna'},{AI_MODEL:'mimo-v2.5-asr'},
  {UPSTREAM_BASE_URL:''},{UPSTREAM_BASE_URL:'not a URL'},{UPSTREAM_BASE_URL:'http://upstream.example.invalid/v1'},
  {UPSTREAM_BASE_URL:'https://user:password@upstream.example.invalid/v1'},
  {UPSTREAM_BASE_URL:'https://upstream.example.invalid/v1?key=test'},
  {UPSTREAM_BASE_URL:'https://upstream.example.invalid/v1#fragment'},
  {UPSTREAM_KEY_FILE:''},{UPSTREAM_KEY_FILE:'relative-secret'},{UPSTREAM_KEY_FILE:join(f.dir,'missing')},
 ])assert.throws(()=>loadAIConfig('AI',{...f.env,...patch}),/Invalid AI configuration/);
 for(const key of ['', 'contains whitespace']){writeFileSync(f.key,key);assert.throws(()=>loadAIConfig('AI',f.env),/Invalid AI configuration/);}
 assert.equal(fetch.mock.callCount(),0);
});
test('text and dedicated ASR explicitly share the new upstream and credential; no model crossover',async t=>{
 const f=fixture(t),content=loadAIConfig('AI',f.env),asr=loadAIConfig('TRANSCRIBE',f.env);
 assert.equal(readAIKey(content),'test-only-key');assert.equal(content.baseUrl,asr.baseUrl);assert.equal(content.keyFile,asr.keyFile);
 assert.throws(()=>loadAIConfig('TRANSCRIBE',{...f.env,TRANSCRIBE_MODEL:'gpt-6-astra'}));
 assert.throws(()=>textProvider(asr));
 const fetch=t.mock.method(globalThis,'fetch',async(url:URL,options:RequestInit)=>{
  assert.equal(url.href,'https://upstream.example.invalid/v1/chat/completions');
  assert.equal(new Headers(options.headers).get('authorization'),'Bearer test-only-key');
  const b=JSON.parse(String(options.body));assert.equal(b.model,'mimo-v2.5-asr');assert.equal(b.messages[1].content[0].type,'input_audio');
  return Response.json({choices:[{message:{content:'合成测试'}}]});
 });
 const transcribe=cpaTranscriber(asr.baseUrl,asr.keyFile,asr.model,()=>readAIKey(asr));
 assert.equal((await transcribe(Buffer.concat([wavHeader(32000),Buffer.alloc(32000)]))).text,'合成测试');
 writeFileSync(f.key,'');await assert.rejects(transcribe(Buffer.alloc(1)),{code:'UPSTREAM_UNAVAILABLE'});
 assert.equal(fetch.mock.callCount(),1);
});
test('missing upstream exits before opening the database; legacy vendor configuration is not a fallback',t=>{
 const f=fixture(t),db=join(f.dir,'should-not-exist.sqlite');
 const r=spawnSync(process.execPath,['src/index.ts'],{cwd:new URL('..',import.meta.url),env:{...process.env,...f.env,UPSTREAM_BASE_URL:'',DB_FILE:db,CPA_BASE_URL:'https://legacy.example.invalid/v1',CPA_KEY_FILE:f.key,AI_BASE_URL:'https://legacy.example.invalid/v1',AI_KEY_FILE:f.key,AI_PROVIDER:'mimo',AI_ACCESS:'token-plan-authorized'},encoding:'utf8'});
 assert.notEqual(r.status,0);assert.equal(existsSync(db),false);assert.ok(!r.stderr.includes('test-only-key'));assert.ok(!r.stderr.includes('legacy.example.invalid'));
});
test('upstream exhaustion never retries or switches provider',async t=>{
 const f=fixture(t),config=loadAIConfig('AI',f.env),urls:string[]=[];
 t.mock.method(globalThis,'fetch',async(url:URL)=>{urls.push(url.href);return new Response('',{status:429});});
 await assert.rejects(textProvider(config)(inputSchema.parse({requestId:randomUUID(),writingMode:'question',context:'合成上下文'})),{code:'UPSTREAM_UNAVAILABLE',status:429});
 assert.deepEqual(urls,['https://upstream.example.invalid/v1/chat/completions']);
});
test('live probes refuse to run without explicit invocation before reading any credential',()=>{
 const r=spawnSync(process.execPath,['scripts/probe-text.ts'],{cwd:new URL('..',import.meta.url),encoding:'utf8'});
 assert.notEqual(r.status,0);assert.match(r.stderr,/Real calls disabled/);assert.equal(r.stdout,'');
 const verify=spawnSync('python3',['scripts/verify-service.py'],{cwd:new URL('..',import.meta.url),encoding:'utf8'});
 assert.notEqual(verify.status,0);assert.match(verify.stderr,/Real calls disabled/);assert.equal(verify.stdout,'');
});
