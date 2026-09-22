import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { loadMiMoConfig, readMiMoKey } from '../src/ai-config.ts';
import { mimoProvider } from '../src/provider.ts';
import { cpaTranscriber, wavHeader } from '../src/transcribe.ts';
import { inputSchema } from '../src/contracts.ts';
import { randomUUID } from 'node:crypto';
function fixture(t:TestContext){
 const dir=mkdtempSync(join(tmpdir(),'anan-mimo-config-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const text=join(dir,'text-key'),asr=join(dir,'asr-key');writeFileSync(text,'ordinary-text-test-key');writeFileSync(asr,'ordinary-asr-test-key');
 const env={AI_PROVIDER:'mimo',AI_MODEL:'mimo-v2.6-pro',AI_BASE_URL:'https://api.xiaomimimo.com/v1',AI_KEY_FILE:text,AI_ACCESS:'payg-approved',TRANSCRIBE_PROVIDER:'mimo',TRANSCRIBE_MODEL:'mimo-v2.5-asr',TRANSCRIBE_BASE_URL:'https://api.xiaomimimo.com/v1',TRANSCRIBE_KEY_FILE:asr,TRANSCRIBE_ACCESS:'payg-approved'};
 return {dir,text,asr,env};
}
test('only matching provider/model/address/credential/authorization tuples load, without network',t=>{
 const f=fixture(t);const fetch=t.mock.method(globalThis,'fetch',()=>{throw Error('must not send');});
 assert.equal(loadMiMoConfig('AI',f.env).model,'mimo-v2.6-pro');assert.equal(loadMiMoConfig('TRANSCRIBE',f.env).model,'mimo-v2.5-asr');
 for(const patch of [
  {AI_PROVIDER:'deepseek'},{AI_MODEL:'deepseek-flash'},{AI_MODEL:'mimo-v2.5'},{AI_MODEL:'mimo-v2.6-flash'},{AI_MODEL:'mimo-v2.5-pro'},{AI_MODEL:'mimo-v2.5-asr'},
  {AI_BASE_URL:'https://api.deepseek.com'},{AI_BASE_URL:'https://api.xiaomimimo.com.evil.invalid/v1'},
  {AI_BASE_URL:'https://secret@api.xiaomimimo.com/v1'},{AI_BASE_URL:'https://api.xiaomimimo.com/v1?key=secret'},
  {AI_BASE_URL:'http://api.xiaomimimo.com/v1'},{AI_BASE_URL:'http://cli-proxy-api:8317/v1'},
  {AI_ACCESS:''},{AI_ACCESS:'yes'},{AI_ACCESS:'token-plan-authorized'},
  {AI_BASE_URL:'https://token-plan-cn.xiaomimimo.com/v1'},
  {AI_KEY_FILE:''},{AI_KEY_FILE:'relative-secret'},{AI_KEY_FILE:join(f.dir,'missing')},
 ])assert.throws(()=>loadMiMoConfig('AI',{...f.env,...patch}),/Invalid MiMo configuration/);
 for(const key of ['', 'tp-test-plan-key','contains whitespace']){writeFileSync(f.text,key);assert.throws(()=>loadMiMoConfig('AI',f.env),/Invalid MiMo configuration/);}
 assert.equal(fetch.mock.callCount(),0);
});
test('Token Plan requires explicit owner selection and matched endpoint/key, no payg fallback',t=>{
 const f=fixture(t);writeFileSync(f.text,'tp-test-only-key');
 const env={...f.env,AI_BASE_URL:'https://token-plan-cn.xiaomimimo.com/v1',AI_ACCESS:'token-plan-authorized'};
 const c=loadMiMoConfig('AI',env);assert.equal(c.access,'token-plan-authorized');assert.equal(c.baseUrl,env.AI_BASE_URL);
 assert.throws(()=>loadMiMoConfig('AI',{...env,AI_ACCESS:''}));
 assert.throws(()=>loadMiMoConfig('AI',{...env,AI_BASE_URL:'https://api.xiaomimimo.com/v1'}));
 writeFileSync(f.text,'ordinary-test-key');assert.throws(()=>loadMiMoConfig('AI',env));
});
test('ASR never inherits content credentials or model; injected provider respects independent tuple',async t=>{
 const f=fixture(t);writeFileSync(f.asr,'tp-asr-test-key');
 const env={...f.env,TRANSCRIBE_BASE_URL:'https://token-plan-cn.xiaomimimo.com/v1',TRANSCRIBE_ACCESS:'token-plan-authorized'};
 const content=loadMiMoConfig('AI',env),asr=loadMiMoConfig('TRANSCRIBE',env);
 assert.equal(readMiMoKey(content),'ordinary-text-test-key');
 for(const field of ['TRANSCRIBE_PROVIDER','TRANSCRIBE_BASE_URL','TRANSCRIBE_KEY_FILE','TRANSCRIBE_ACCESS'])assert.throws(()=>loadMiMoConfig('TRANSCRIBE',{...env,[field]:''}));
 assert.throws(()=>loadMiMoConfig('TRANSCRIBE',{...env,TRANSCRIBE_MODEL:'mimo-v2.6-pro'}));
 assert.throws(()=>mimoProvider(asr));
 const fetch=t.mock.method(globalThis,'fetch',async(url:URL,options:RequestInit)=>{
  assert.equal(url.href,'https://token-plan-cn.xiaomimimo.com/v1/chat/completions');
  assert.equal(new Headers(options.headers).get('authorization'),'Bearer tp-asr-test-key');
  const b=JSON.parse(String(options.body));assert.equal(b.model,'mimo-v2.5-asr');assert.equal(b.messages[1].content[0].type,'input_audio');
  return Response.json({choices:[{message:{content:'合成测试'}}]});
 });
 const transcribe=cpaTranscriber(asr.baseUrl,asr.keyFile,asr.model,()=>readMiMoKey(asr));
 assert.equal((await transcribe(Buffer.concat([wavHeader(32000),Buffer.alloc(32000)]))).text,'合成测试');
 writeFileSync(f.asr,'ordinary-mismatched-key');await assert.rejects(transcribe(Buffer.alloc(1)),{code:'UPSTREAM_UNAVAILABLE'});
 assert.equal(fetch.mock.callCount(),1);
});
test('unapproved startup exits before creating database or using inherited legacy CPA configuration',t=>{
 const f=fixture(t),db=join(f.dir,'should-not-exist.sqlite');
 const r=spawnSync(process.execPath,['src/index.ts'],{cwd:new URL('..',import.meta.url),env:{...process.env,...f.env,AI_ACCESS:'',DB_FILE:db,CPA_BASE_URL:'https://api.deepseek.com',CPA_KEY_FILE:f.text},encoding:'utf8'});
 assert.notEqual(r.status,0);assert.equal(existsSync(db),false);assert.ok(!r.stderr.includes('ordinary-text-test-key'));
});

test('authorized Token Plan exhaustion never switches to an ordinary paid endpoint',async t=>{
 const f=fixture(t);writeFileSync(f.text,'tp-test-only-key');
 const config=loadMiMoConfig('AI',{...f.env,AI_BASE_URL:'https://token-plan-cn.xiaomimimo.com/v1',AI_ACCESS:'token-plan-authorized'});
 const urls:string[]=[];
 t.mock.method(globalThis,'fetch',async(url:URL)=>{urls.push(url.href);return new Response('',{status:429});});
 await assert.rejects(mimoProvider(config)(inputSchema.parse({requestId:randomUUID(),writingMode:'question',context:'合成上下文'})),{code:'UPSTREAM_UNAVAILABLE',status:429});
 assert.deepEqual(urls,['https://token-plan-cn.xiaomimimo.com/v1/chat/completions']);
});

test('live probes refuse to run without explicit invocation before reading any credential',()=>{
 for(const script of ['probe-text.ts']){
  const r=spawnSync(process.execPath,['scripts/'+script],{cwd:new URL('..',import.meta.url),encoding:'utf8'});
  assert.notEqual(r.status,0);assert.match(r.stderr,/Real calls disabled/);assert.equal(r.stdout,'');
 }
 const r=spawnSync('python3',['scripts/verify-service.py'],{cwd:new URL('..',import.meta.url),encoding:'utf8'});
 assert.notEqual(r.status,0);assert.match(r.stderr,/Real calls disabled/);assert.equal(r.stdout,'');
});
