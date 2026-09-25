import { createHash, randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { z } from 'zod';
import { Problem, digest } from '../store.ts';
import { inputSchema, parseEditorContext, parseResult, polishBody, POLISH_BODY_LIMIT, transcribeResultSchema } from '../contracts.ts';
import { MODEL_ID, MODEL_LABEL, REASONING_POLICY } from '../ai-model.ts';
import type { Provider } from '../provider.ts';
import { audioTooLong, type Transcoder, type Transcriber } from '../transcribe.ts';
import type { Ctx } from './context.ts';
export function aiRoutes({app,store,auth}:Ctx,provider:Provider,transcribe:{transcoder:Transcoder;transcriber:Transcriber;model?:string}) {
 const cache=new Map<string,{expires:number;value:unknown}>();
 app.get('/api/v1/ai/config',async req=>{auth(req.headers.authorization);const config=store.settings();return {...config,reasoningEffort:'medium',reasoningPolicy:REASONING_POLICY,models:[{id:MODEL_ID,label:MODEL_LABEL}]};});
 app.post('/api/v1/ai/write',async req=>{
  const member=auth(req.headers.authorization);
  // 在 schema 的硬上限之前给超长 editor 清单返回该模式的提示。
  const raw=req.body as {writingMode?:unknown;context?:unknown;photos?:unknown}|null;
  if(typeof raw?.context==='string'&&raw.context.length>(raw.writingMode==='editor'?60000:4000))throw new Problem(400,'INVALID_INPUT',raw.writingMode==='editor'?'这一年的记录太多，请分月送。':'内容太长');
  if(Array.isArray(raw?.photos)&&raw.photos.length)throw new Problem(400,'INVALID_INPUT','AI 不再接收照片，请只发送文字。');
  const input=inputSchema.parse(req.body);
  if(input.writingMode==='ask'&&!input.context.trim())throw new Problem(400,'INVALID_INPUT','请先写几句再让 AI 追问。');
  if(input.writingMode==='question'&&!input.context.trim())throw new Problem(400,'INVALID_INPUT','请提供最近的记录标题。');
  if(input.writingMode==='editor'&&!input.context.trim())throw new Problem(400,'INVALID_INPUT','请先送这一年的记录清单。');
  if(input.writingMode==='editor')parseEditorContext(input.context);
  const polish=input.writingMode==='polish';
  const recap=input.writingMode==='recap';
  if(polish&&!input.context.trim())throw new Problem(400,'INVALID_INPUT','请先写下正文再润色。');
  if(recap&&!input.context.trim())throw new Problem(400,'INVALID_INPUT','请先补全这一年的记录清单再起草寄语。');
  if(polish&&polishBody(input.context).length>POLISH_BODY_LIMIT)throw new Problem(400,'POLISH_TOO_LONG',`单次润色的正文超过 ${POLISH_BODY_LIMIT} 字上限，请精简后再试。`);
  const cacheKey=member.id+':'+input.requestId;
  for(const [key,value]of cache)if(value.expires<Date.now())cache.delete(key);
  const status=store.reserve(member,input.requestId,digest('write'+JSON.stringify(input)),0,1,input.model);
  if(status!=='new') {
   if(status==='completed'&&cache.has(cacheKey))return cache.get(cacheKey)!.value;
   throw new Problem(409,status==='processing'?'REQUEST_PENDING':'RESULT_EXPIRED',status==='processing'?'这次请求仍在处理中，请稍后重试。':'这次请求已结束，结果无法恢复；可重新生成，原草稿不变。');
  }
  try {
   const output=await provider(input);
   const result=parseResult(output.result,input);
   store.finish(member.id,input.requestId,output.tokens);
   const value={requestId:input.requestId,model:input.model,...result};
   cache.set(cacheKey,{expires:Date.now()+600000,value});
   if(cache.size>200)cache.delete(cache.keys().next().value!);
   // Access may have been revoked while the provider was processing.
   auth(req.headers.authorization);
   return value;
  } catch(e) {
   store.finish(member.id,input.requestId,null,e instanceof Problem?e.code:'INVALID_RESULT');
   if(e instanceof Problem)throw e;
   throw new Problem(502,'INVALID_RESULT','AI 返回内容无效，草稿仍保留。');
  }
 });
 // 转写只保留请求指纹和额度；声音、文字不进日志或结果缓存。
 const transcribing=new Map<string,string>(),audioLimit=5*1024*1024;
 app.post('/api/v1/ai/transcribe',{onRequest:async req=>{
  auth(req.headers.authorization);
  if(!/^audio\/(mp4|m4a|x-m4a)/.test(String(req.headers['content-type']??'')))throw new Problem(415,'INVALID_INPUT','请求格式不受支持。');
  const length=req.headers['content-length'],seconds=req.headers['x-audio-seconds'];
  if(typeof length!=='string'||!/^\d+$/.test(length)||!Number.isSafeInteger(Number(length)))throw new Problem(400,'INVALID_INPUT','请求长度无效。');
  if(Number(length)>audioLimit)throw audioTooLong();
  if(seconds!==undefined){
   if(typeof seconds!=='string'||!/^\d+$/.test(seconds)||!Number.isSafeInteger(Number(seconds)))throw new Problem(400,'INVALID_INPUT','录音时长无效。');
   if(Number(seconds)>180)throw audioTooLong();
  }
  if(req.headers['x-request-id']!==undefined)z.string().uuid().parse(req.headers['x-request-id']);
 }},async req=>{
  const member=auth(req.headers.authorization),lane=member.deviceId??member.id;
  const requestId=(req.headers['x-request-id'] as string|undefined)??randomUUID(),model=transcribe.model??'mimo-v2.5-asr';
  const activeId=member.id+':'+requestId;
  if([...transcribing.values()].includes(activeId))throw new Problem(409,'REQUEST_PENDING','这次请求仍在处理中，请稍后重试。');
  if(transcribing.size>=2||transcribing.has(lane))throw new Problem(429,'BUSY','正在转写其他录音，请稍后再试。');
  transcribing.set(lane,activeId);
  let reserved=false;
  try {
   const chunks:Buffer[]=[];let bytes=0;
   for await(const chunk of req.body as Readable){bytes+=chunk.length;if(bytes>audioLimit)throw audioTooLong();chunks.push(chunk);}
   if(!bytes||bytes!==Number(req.headers['content-length']))throw new Problem(400,'INVALID_INPUT','录音内容为空或不完整。');
   const input=Buffer.concat(chunks,bytes),fingerprint=createHash('sha256').update(input).digest('hex');
   // 上传期间设备可能已被停用，额度也可能被管理者修改；入账前重新读取权限。
   const status=store.reserve(auth(req.headers.authorization),requestId,fingerprint,0,1,model,'transcribe');
   if(status!=='new')throw new Problem(409,status==='processing'?'REQUEST_PENDING':'RESULT_EXPIRED',status==='processing'?'这次请求仍在处理中，请稍后重试。':'这次请求已结束，结果无法恢复；请重新转写。');
   reserved=true;
   let audio:{wav:Buffer;seconds:number};
   try {audio=await transcribe.transcoder(input,{maxSeconds:180});}
   catch(error){
    if((error as NodeJS.ErrnoException)?.code==='ENOENT'){console.error('转写不可用：未找到 ffmpeg。');throw new Problem(503,'UPSTREAM_UNAVAILABLE','转文字暂时不可用，请联系管理者。');}
    if(error instanceof Problem&&error.code==='AUDIO_TOO_LONG')throw error;
    throw new Problem(400,'INVALID_AUDIO','这段录音读不出来，换一段试试。');
   }
   if(audio.seconds>180)throw audioTooLong();
   // 转码会等待子进程；停用后的手机不能在这里再发起付费的上游调用。
   auth(req.headers.authorization);
   let output:{text:string;tokens:number|null};
   try {output=await transcribe.transcriber(audio.wav);}
   catch(error){if(error instanceof Problem&&error.code==='INVALID_RESULT')throw error;throw new Problem(502,'UPSTREAM_UNAVAILABLE','转文字暂时不可用，请稍后重试。');}
   const parsed=transcribeResultSchema.safeParse({text:output?.text});
   if(!parsed.success)throw new Problem(502,'INVALID_RESULT','转文字返回内容无效，请重试。');
   store.finish(member.id,requestId,output.tokens??null);
   auth(req.headers.authorization);
   return parsed.data;
  } catch(error){
   if(reserved)store.finish(member.id,requestId,null,error instanceof Problem?error.code:'INVALID_AUDIO');
   throw error;
  } finally {transcribing.delete(lane);}
 });
}
