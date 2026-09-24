import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createApp } from '../src/app.ts';
import { Store, Problem } from '../src/store.ts';
import { BackupStore } from '../src/backup-store.ts';
import { seedFamily } from './helpers.ts';
import { cpaTranscriber, ffmpegTranscoder, wavHeader, type Transcoder, type Transcriber } from '../src/transcribe.ts';

const input=Buffer.from('测试 m4a 原体'),wav=Buffer.concat([wavHeader(32000),Buffer.alloc(32000)]);
const problem=(code:string,status?:number)=>(error:unknown)=>error instanceof Problem&&error.code===code&&(status===undefined||error.status===status);
function fixture(t:TestContext) {
 const dir=mkdtempSync(join(tmpdir(),'anan-transcribe-test-')),store=new Store(':memory:');
 const owner=seedFamily(store,'主人','手机'),second=store.attach(owner.member.id,'第二台'),third=store.attach(owner.member.id,'第三台');
 let transcode:Transcoder=async()=>({wav,seconds:12}),transcribe:Transcriber=async()=>({text:' 你好呀 ',tokens:9});
 const decoded:Buffer[]=[],sent:Buffer[]=[];
 const app=createApp(store,async()=>{throw new Error('本测试不调用文本模型');},'test',new BackupStore(join(dir,'backup')),{
  transcoder:async(body,opts)=>{decoded.push(body);assert.equal(opts.maxSeconds,180);return transcode(body,opts);},
  transcriber:async(body,signal)=>{sent.push(body);return transcribe(body,signal);},model:'test-asr',
 });
 t.after(async()=>{await app.close();store.close();rmSync(dir,{recursive:true,force:true});});
 const headers=(token=owner.token,extra:Record<string,string>={})=>({authorization:`Bearer ${token}`,'content-type':'audio/mp4','content-length':String(input.length),'x-audio-seconds':'12',...extra});
 const post=(extra:Record<string,string>={},token=owner.token)=>app.inject({method:'POST',url:'/api/v1/ai/transcribe',headers:headers(token,extra),payload:input});
 const usage=()=>store.usage(owner.member.id);
 const rows=()=>store.db.prepare('SELECT * FROM requests').all() as {status:string;error_code:string;model:string;fingerprint:string}[];
 return {app,store,owner,second,third,headers,post,usage,rows,decoded,sent,setTranscoder:(fn:Transcoder)=>{transcode=fn;},setTranscriber:(fn:Transcriber)=>{transcribe=fn;}};
}
test('转写成功只回文字，送给上游的只有 wav，记一次写作和音频指纹',async t=>{
 const f=fixture(t),response=await f.post();
 assert.equal(response.statusCode,200);assert.deepEqual(response.json(),{text:'你好呀'});
 assert.deepEqual(f.decoded,[input]);assert.deepEqual(f.sent,[wav]);assert.notDeepEqual(f.sent[0],input);
 assert.equal(f.sent[0]!.toString('ascii',0,4),'RIFF');assert.equal(f.sent[0]!.toString('ascii',8,12),'WAVE');
 assert.equal(f.usage().writes,1);assert.equal(f.usage().photos,0);assert.equal(f.usage().tokens,9);
 assert.equal(f.rows()[0]!.model,'test-asr');assert.equal(f.rows()[0]!.fingerprint,createHash('sha256').update(input).digest('hex'));
 assert.ok(!JSON.stringify(f.rows()).includes('你好呀'));assert.equal(response.headers['cache-control'],'no-store');
});
test('鉴权、格式、声明长度、时长和请求 ID 在读体前校验',async t=>{
 const f=fixture(t);
 const cases:[Record<string,string>,number,string][]=[
  [{authorization:''},401,'AUTH_REQUIRED'],[{'content-type':'application/json'},415,'INVALID_INPUT'],
  [{'content-type':'text/plain'},415,'INVALID_INPUT'],[{'content-length':'abc'},400,'INVALID_INPUT'],
  [{'content-length':'-1'},400,'INVALID_INPUT'],[{'content-length':String(5*1024*1024+1)},413,'AUDIO_TOO_LONG'],
  [{'x-audio-seconds':'181'},413,'AUDIO_TOO_LONG'],[{'x-audio-seconds':'abc'},400,'INVALID_INPUT'],
  [{'x-audio-seconds':'-1'},400,'INVALID_INPUT'],[{'x-audio-seconds':'1.5'},400,'INVALID_INPUT'],[{'x-request-id':'bad'},400,'INVALID_INPUT'],
 ];
 for(const [headers,status,code] of cases){const r=await f.post(headers);assert.equal(r.statusCode,status,JSON.stringify(headers));assert.equal(r.json().code,code);}
 const headers:Record<string,string>=f.headers();delete headers['content-length'];
 const missing=await f.app.inject({method:'POST',url:'/api/v1/ai/transcribe',headers,payload:Readable.from([input])});
 assert.equal(missing.statusCode,400);assert.equal(missing.json().code,'INVALID_INPUT');
 assert.equal(f.decoded.length,0);assert.equal(f.sent.length,0);assert.equal(f.rows().length,0);
});
test('空体、长度不符与实际超限都拒收，m4a 类型及参数可接收',async t=>{
 const f=fixture(t);
 for(const [body,length,status,code] of [[Buffer.alloc(0),0,400,'INVALID_INPUT'],[input,input.length+1,400,'INVALID_INPUT'],[Buffer.alloc(5*1024*1024+1),1,413,'AUDIO_TOO_LONG']] as const){
  const r=await f.app.inject({method:'POST',url:'/api/v1/ai/transcribe',headers:f.headers(f.owner.token,{'content-length':String(length)}),payload:body});
  assert.equal(r.statusCode,status);assert.equal(r.json().code,code);
 }
 assert.equal(f.decoded.length,0);
 for(const type of ['audio/m4a','audio/x-m4a','audio/mp4; codecs=mp4a.40.2'])assert.equal((await f.post({'content-type':type})).statusCode,200);
});
test('转码后的真实时长超限不调用上游，失败不计额度',async t=>{
 const f=fixture(t);f.setTranscoder(async()=>({wav,seconds:200}));
 const r=await f.post();assert.equal(r.statusCode,413);assert.equal(r.json().code,'AUDIO_TOO_LONG');
 assert.equal(f.sent.length,0);assert.equal(f.usage().writes,0);assert.equal(f.rows()[0]!.status,'failed');
});
test('转码错误、超时与缺失 ffmpeg 不计额度并归还并发名额',async t=>{
 const f=fixture(t);
 for(const [error,status,code] of [[new Error('坏输入'),400,'INVALID_AUDIO'],[new Problem(400,'INVALID_AUDIO','超时'),400,'INVALID_AUDIO'],[Object.assign(new Error('未安装'),{code:'ENOENT'}),503,'UPSTREAM_UNAVAILABLE'],[new Problem(413,'AUDIO_TOO_LONG','太长'),413,'AUDIO_TOO_LONG']] as const){
  f.setTranscoder(async()=>{throw error;});const r=await f.post();assert.equal(r.statusCode,status);assert.equal(r.json().code,code);
 }
 assert.equal(f.sent.length,0);assert.equal(f.usage().writes,0);assert.ok(f.rows().every(r=>r.status==='failed'));
 f.setTranscoder(async()=>({wav,seconds:1}));assert.equal((await f.post()).statusCode,200);
});
test('上游失败或无效结果不计额度，空串成功且计额度',async t=>{
 const f=fixture(t);
 for(const error of [new Error('网络中断'),new DOMException('超时','TimeoutError')]){
  f.setTranscriber(async()=>{throw error;});const r=await f.post();assert.equal(r.statusCode,502);assert.equal(r.json().code,'UPSTREAM_UNAVAILABLE');
 }
 for(const text of ['字'.repeat(5001),null]){
  f.setTranscriber(async()=>({text:text as string,tokens:null}));const r=await f.post();assert.equal(r.statusCode,502);assert.equal(r.json().code,'INVALID_RESULT');
 }
 assert.equal(f.usage().writes,0);assert.ok(f.rows().every(r=>r.status==='failed'));
 f.setTranscriber(async()=>({text:' \n ',tokens:null}));const empty=await f.post();assert.equal(empty.statusCode,200);assert.deepEqual(empty.json(),{text:''});assert.equal(f.usage().writes,1);
 f.setTranscriber(async()=>({text:' '+ '字'.repeat(5000)+' ',tokens:null}));assert.equal((await f.post()).statusCode,200);
});
test('写作额度用尽在两个假件之前拒绝；暂停规则也沿用',async t=>{
 const f=fixture(t);f.store.editMember(f.owner.member.id,{enabled:true,photoLimit:0,writeLimit:1});
 assert.equal((await f.post()).statusCode,200);
 const second=await f.post();assert.equal(second.statusCode,429);assert.equal(second.json().code,'QUOTA_EXCEEDED');assert.equal(f.decoded.length,1);assert.equal(f.sent.length,1);
 f.store.setSettings({...f.store.settings(),paused:true});const paused=await f.post();assert.equal(paused.statusCode,503);assert.equal(paused.json().code,'AI_PAUSED');
});
test('上传途中停用手机，在预留额度和转码前拒绝',async t=>{
 const f=fixture(t);
 const payload=Readable.from((async function*(){
  yield input.subarray(0,1);
  f.store.revoke(f.owner.member.deviceId!);
  yield input.subarray(1);
 })());
 const response=await f.app.inject({method:'POST',url:'/api/v1/ai/transcribe',headers:f.headers(),payload});
 assert.equal(response.statusCode,401);assert.equal(response.json().code,'AUTH_REQUIRED');
 assert.equal(f.decoded.length,0);assert.equal(f.sent.length,0);assert.equal(f.rows().length,0);
 assert.equal((await f.post({},f.second.token)).statusCode,200);
});
test('上传途中调低额度，预留时使用最新的成员上限',async t=>{
 const f=fixture(t);
 const payload=Readable.from((async function*(){
  yield input.subarray(0,1);
  f.store.editMember(f.owner.member.id,{enabled:true,photoLimit:0,writeLimit:0});
  yield input.subarray(1);
 })());
 const response=await f.app.inject({method:'POST',url:'/api/v1/ai/transcribe',headers:f.headers(),payload});
 assert.equal(response.statusCode,429);assert.equal(response.json().code,'QUOTA_EXCEEDED');
 assert.equal(f.decoded.length,0);assert.equal(f.sent.length,0);assert.equal(f.rows().length,0);
});
test('转码途中停用手机，不调用上游也不扣文案额度',async t=>{
 const f=fixture(t);
 f.setTranscoder(async()=>{f.store.revoke(f.owner.member.deviceId!);return {wav,seconds:1};});
 const response=await f.post();
 assert.equal(response.statusCode,401);assert.equal(response.json().code,'AUTH_REQUIRED');
 assert.equal(f.decoded.length,1);assert.equal(f.sent.length,0);
 assert.equal(f.usage().writes,0);assert.equal(f.rows()[0]!.status,'failed');
 assert.equal(f.rows()[0]!.error_code,'AUTH_REQUIRED');
 assert.equal((await f.post({},f.second.token)).statusCode,200);
});
test('同设备最多一个，全服务最多两个，结束后归还名额',async t=>{
 const f=fixture(t);let release!:()=>void,started!:()=>void;
 const gate=new Promise<void>(resolve=>{release=resolve;}),both=new Promise<void>(resolve=>{started=resolve;});let count=0;
 f.setTranscriber(async()=>{if(++count===2)started();await gate;return {text:'好了',tokens:null};});
 const id=randomUUID(),a=f.post({'x-request-id':id}),b=f.post({},f.second.token);await both;
 try {
  const replay=await f.post({'x-request-id':id});assert.equal(replay.statusCode,409);assert.equal(replay.json().code,'REQUEST_PENDING');
  const same=await f.post();assert.equal(same.statusCode,429);assert.equal(same.json().code,'BUSY');
  const third=await f.post({},f.third.token);assert.equal(third.statusCode,429);assert.equal(third.json().code,'BUSY');
 } finally {release();}
 assert.equal((await a).statusCode,200);assert.equal((await b).statusCode,200);assert.equal((await f.post()).statusCode,200);
});
test('请求 ID 不缓存结果，已完成或失败返回过期，处理中返回等待',async t=>{
 const f=fixture(t),id=randomUUID();assert.equal((await f.post({'x-request-id':id})).statusCode,200);
 const replay=await f.post({'x-request-id':id});assert.equal(replay.statusCode,409);assert.equal(replay.json().code,'RESULT_EXPIRED');assert.equal(f.sent.length,1);
 const pending=randomUUID();f.store.reserve(f.owner.member,pending,createHash('sha256').update(input).digest('hex'),0,1,'test-asr','transcribe');
 const waiting=await f.post({'x-request-id':pending});assert.equal(waiting.statusCode,409);assert.equal(waiting.json().code,'REQUEST_PENDING');
 f.store.finish(f.owner.member.id,pending,null,'UPSTREAM_UNAVAILABLE');const failed=await f.post({'x-request-id':pending});assert.equal(failed.statusCode,409);assert.equal(failed.json().code,'RESULT_EXPIRED');assert.equal(f.sent.length,1);
});
test('wavHeader 的每个字段符合 PCM RIFF/WAVE',()=>{
 for(const [pcm,rate,channels,bits] of [[32000,16000,1,16],[123456,48000,2,24]] as const){
  const h=wavHeader(pcm,rate,channels,bits);assert.equal(h.length,44);assert.equal(h.toString('ascii',0,4),'RIFF');assert.equal(h.readUInt32LE(4),36+pcm);assert.equal(h.toString('ascii',8,12),'WAVE');assert.equal(h.toString('ascii',12,16),'fmt ');assert.equal(h.readUInt32LE(16),16);assert.equal(h.readUInt16LE(20),1);assert.equal(h.readUInt16LE(22),channels);assert.equal(h.readUInt32LE(24),rate);assert.equal(h.readUInt32LE(28),rate*channels*bits/8);assert.equal(h.readUInt16LE(32),channels*bits/8);assert.equal(h.readUInt16LE(34),bits);assert.equal(h.toString('ascii',36,40),'data');assert.equal(h.readUInt32LE(40),pcm);
 }
 assert.deepEqual(wavHeader(32000),wavHeader(32000,16000,1,16));
});
function ffmpegAvailable(t:TestContext) {
 const result=spawnSync('ffmpeg',['-version'],{encoding:'utf8'});
 if(result.error){t.skip(`无法运行 ffmpeg：${(result.error as NodeJS.ErrnoException).code??result.error.message}`);return false;}
 assert.equal(result.status,0,result.stderr);return true;
}
function audioDir(t:TestContext) {
 const dir=mkdtempSync(join(tmpdir(),'anan-ffmpeg-test-')),temp=join(dir,'tmp');mkdirSync(temp);
 t.after(()=>{try{assert.deepEqual(readdirSync(temp),[]);}finally{rmSync(dir,{recursive:true,force:true});}});
 return {dir,temp};
}
function makeAudio(dir:string,seconds:number) {
 const file=join(dir,'tone.m4a');
 // 立体声噪声让编码器用足 128k，80 秒文件超过 1 MiB，moov 保留在尾部。
 const result=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i',`anoisesrc=duration=${seconds}:seed=1`,'-ac','2','-c:a','aac','-b:a','128k',file],{encoding:'utf8'});
 assert.equal(result.status,0,result.error?.message??result.stderr);return readFileSync(file);
}
test('真实 ffmpeg 能 seek 读取大于 1 MiB 且 moov 在末尾的 m4a，输出正确 wav 并清理',async t=>{
 if(!ffmpegAvailable(t))return;const {dir,temp}=audioDir(t),audio=makeAudio(dir,80);
 assert.ok(audio.length>=1024*1024);assert.ok(audio.indexOf('moov')>audio.indexOf('mdat'));
 const result=await ffmpegTranscoder({tmpDir:temp})(audio,{maxSeconds:180});assert.ok(Math.abs(result.seconds-80)<1);
 assert.equal(result.wav.toString('ascii',0,4),'RIFF');assert.equal(result.wav.toString('ascii',8,12),'WAVE');assert.equal(result.wav.readUInt32LE(40),result.wav.length-44);assert.deepEqual(readdirSync(temp),[]);
});
test('真实 ffmpeg 坏输入与截断超长都清理临时文件',async t=>{
 if(!ffmpegAvailable(t))return;const {dir,temp}=audioDir(t),transcoder=ffmpegTranscoder({tmpDir:temp});
 await assert.rejects(transcoder(randomBytes(4096),{maxSeconds:180}),problem('INVALID_AUDIO',400));assert.deepEqual(readdirSync(temp),[]);
 await assert.rejects(transcoder(makeAudio(dir,3),{maxSeconds:1}),problem('AUDIO_TOO_LONG',413));assert.deepEqual(readdirSync(temp),[]);
});
test('真实 ffmpeg 超时 kill 后清理；取消和 ENOENT 也不留文件',async t=>{
 if(!ffmpegAvailable(t))return;const {dir,temp}=audioDir(t),audio=makeAudio(dir,5);
 await assert.rejects(ffmpegTranscoder({tmpDir:temp,timeoutMs:0})(audio,{maxSeconds:180}),problem('INVALID_AUDIO',400));assert.deepEqual(readdirSync(temp),[]);
 await assert.rejects(ffmpegTranscoder({tmpDir:temp})(audio,{maxSeconds:180,signal:AbortSignal.abort()}));assert.deepEqual(readdirSync(temp),[]);
 await assert.rejects(ffmpegTranscoder({tmpDir:temp,ffmpegPath:join(dir,'missing')})(audio,{maxSeconds:180}),(e:unknown)=>(e as NodeJS.ErrnoException).code==='ENOENT');
});
test('CPA 网关只接收一项 wav 音频、system 提示和指定模型，校验错误及空结果',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'anan-asr-gateway-')),key=join(dir,'key');writeFileSync(key,'test-key\n');t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const received:{url:string|undefined;authorization:string|undefined;body:any}[]=[];let status=200,reply:unknown={choices:[{message:{content:' 你好呀 '}}],usage:{total_tokens:9}};
 const server=createServer(async(req,res)=>{const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(chunk);received.push({url:req.url,authorization:req.headers.authorization,body:JSON.parse(Buffer.concat(chunks).toString())});res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(reply));});
 try {await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});}
 catch(error){if(['EPERM','EACCES'].includes((error as NodeJS.ErrnoException).code??'')){t.skip(`沙箱不允许监听假网关：${(error as Error).message}`);return;}throw error;}
 t.after(()=>new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve())));
 const transcriber=cpaTranscriber(`http://127.0.0.1:${(server.address() as {port:number}).port}`,key);
 assert.deepEqual(await transcriber(wav),{text:'你好呀',tokens:9});
 const sent=received[0]!;assert.equal(sent.url,'/chat/completions');assert.equal(sent.authorization,'Bearer test-key');assert.equal(sent.body.model,'mimo-v2.5-asr');
 assert.deepEqual(sent.body.messages,[{role:'system',content:'中文口语，保留昵称与口头语，标点按停顿。'},{role:'user',content:[{type:'input_audio',input_audio:{data:wav.toString('base64'),format:'wav'}}]}]);
 assert.equal(Buffer.from(sent.body.messages[1].content[0].input_audio.data,'base64').toString('ascii',0,4),'RIFF');
 status=500;await assert.rejects(transcriber(wav),problem('UPSTREAM_UNAVAILABLE',502));
 status=429;await assert.rejects(transcriber(wav),problem('UPSTREAM_UNAVAILABLE',502));
 status=200;reply={choices:[{message:{}}]};await assert.rejects(transcriber(wav),problem('INVALID_RESULT',502));
 reply={choices:[{message:{content:'字'.repeat(5001)}}]};await assert.rejects(transcriber(wav),problem('INVALID_RESULT',502));
 reply={choices:[{message:{content:''}}]};assert.deepEqual(await transcriber(wav),{text:'',tokens:null});
 await assert.rejects(transcriber(wav,AbortSignal.abort()),problem('UPSTREAM_UNAVAILABLE',502));
});

test('无需监听的 CPA 契约验证：请求形状、密钥重读、返回校验与超时信号',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'anan-asr-fetch-')),key=join(dir,'key');writeFileSync(key,'first-key\n');t.after(()=>rmSync(dir,{recursive:true,force:true}));
 let response:()=>Response=()=>Response.json({choices:[{message:{content:' 你好呀 '}}],usage:{total_tokens:9}}),authorization='Bearer first-key';
 t.mock.method(globalThis,'fetch',async(url:URL,init:RequestInit)=>{
  assert.equal(url.href,'http://gateway.invalid/v1/chat/completions');assert.equal(init.method,'POST');
  assert.deepEqual(init.headers,{'Content-Type':'application/json',Authorization:authorization});
  assert.ok(init.signal instanceof AbortSignal);
  assert.deepEqual(JSON.parse(init.body as string),{model:'custom-asr',messages:[{role:'system',content:'中文口语，保留昵称与口头语，标点按停顿。'},{role:'user',content:[{type:'input_audio',input_audio:{data:wav.toString('base64'),format:'wav'}}]}]});
  init.signal!.throwIfAborted();return response();
 });
 const transcriber=cpaTranscriber('http://gateway.invalid/v1/',key,'custom-asr');
 assert.deepEqual(await transcriber(wav),{text:'你好呀',tokens:9});
 writeFileSync(key,'second-key');authorization='Bearer second-key';assert.deepEqual(await transcriber(wav),{text:'你好呀',tokens:9});
 for(const status of [429,500]){response=()=>new Response('',{status});await assert.rejects(transcriber(wav),problem('UPSTREAM_UNAVAILABLE',502));}
 for(const body of [{choices:[{message:{}}]},{choices:[{message:{content:7}}]},{choices:[{message:{content:'字'.repeat(5001)}}]}]){
  response=()=>Response.json(body);await assert.rejects(transcriber(wav),problem('INVALID_RESULT',502));
 }
 response=()=>new Response('不是 JSON');await assert.rejects(transcriber(wav),problem('INVALID_RESULT',502));
 response=()=>new Response('x'.repeat(100001));await assert.rejects(transcriber(wav),problem('INVALID_RESULT',502));
 response=()=>{throw new Error('网络中断');};await assert.rejects(transcriber(wav),problem('UPSTREAM_UNAVAILABLE',502));
 response=()=>Response.json({choices:[{message:{content:''}}],usage:{total_tokens:-1}});assert.deepEqual(await transcriber(wav),{text:'',tokens:null});
 await assert.rejects(transcriber(wav,AbortSignal.abort()),problem('UPSTREAM_UNAVAILABLE',502));
});

test('模拟子进程验证临时文件权限、参数、WAV 封装和所有退出路径清理',async t=>{
 const cp=(await import('node:child_process')).default,{syncBuiltinESMExports}=await import('node:module');
 const {EventEmitter}=await import('node:events'),{PassThrough}=await import('node:stream'),{statSync}=await import('node:fs');
 const {temp}=audioDir(t);let mode='success',killCount=0,controller:AbortController|undefined;
 const mock=t.mock.method(cp,'spawn',(_command:string,args:string[])=>{
  const file=args[args.indexOf('-i')+1]!;
  assert.equal(statSync(file).mode&0o777,0o600);assert.deepEqual(readFileSync(file),input);
  assert.deepEqual(args,['-hide_banner','-loglevel','error','-nostdin','-i',file,'-vn','-ac','1','-ar','16000','-t','181','-f','s16le','pipe:1']);
  const child=Object.assign(new EventEmitter(),{stdout:new PassThrough(),stderr:new PassThrough(),kill:(signal:string)=>{
   assert.equal(signal,'SIGKILL');killCount++;queueMicrotask(()=>child.emit('close',null));return true;
  }});
  queueMicrotask(()=>{
   if(mode==='timeout')return;
   if(mode==='abort'){controller!.abort();return;}
   if(mode==='missing'){child.emit('error',Object.assign(new Error('缺少 ffmpeg'),{code:'ENOENT'}));child.emit('close',-2);return;}
   if(mode==='overflow'){child.stdout.emit('data',Buffer.alloc(181*32000+1));return;}
   if(mode==='bad'){child.stderr.emit('data',Buffer.alloc(1000,120));child.emit('close',1);return;}
   if(mode==='success')child.stdout.emit('data',Buffer.alloc(32000));
   child.emit('close',0);
  });
  return child;
 });
 syncBuiltinESMExports();
 try {
  const transcoder=ffmpegTranscoder({tmpDir:temp,timeoutMs:10});
  const result=await transcoder(input,{maxSeconds:180});assert.equal(result.seconds,1);assert.deepEqual(result.wav,wav);assert.deepEqual(readdirSync(temp),[]);
  for(mode of ['bad','empty','timeout','abort','missing','overflow']){
   controller=new AbortController();
   await assert.rejects(transcoder(input,{maxSeconds:180,signal:controller.signal}),(error:unknown)=>{
    if(mode==='missing')return (error as NodeJS.ErrnoException).code==='ENOENT';
    if(mode==='bad')assert.equal(Buffer.byteLength(String((error as Error).cause)),200);
    return problem(mode==='overflow'?'AUDIO_TOO_LONG':'INVALID_AUDIO')(error);
   });
   assert.deepEqual(readdirSync(temp),[],mode);
  }
  assert.equal(killCount,3);
 } finally {mock.mock.restore();syncBuiltinESMExports();}
});
