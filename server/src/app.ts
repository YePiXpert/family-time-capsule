import Fastify from 'fastify';
import { z, ZodError } from 'zod';
import { Store, Problem, digest, type Member, type BackupManifest } from './store.ts';
import { inputSchema, parseEditorContext, parseResult, polishBody, POLISH_BODY_LIMIT, transcribeResultSchema } from './contracts.ts';
import { MODEL_ID, MODEL_LABEL, MODEL_IDS, REASONING_POLICY } from './ai-model.ts';
import type { Provider } from './provider.ts';
import { BackupStore, FREE_FLOOR, OBJECT_ID, OBJECT_LIMIT } from './backup-store.ts';
import { createHash, randomUUID } from 'node:crypto';
import { audioTooLong, type Transcoder, type Transcriber } from './transcribe.ts';
import type { Readable } from 'node:stream';
export function createApp(store:Store,provider:Provider,version:string,backupStore:BackupStore,transcribe:{transcoder:Transcoder;transcriber:Transcriber;model?:string}) {
 // 全局关闭 Fastify 日志：请求体、响应体与异常对象都不交给 logger。
 const app=Fastify({logger:false,bodyLimit:15*1024*1024,requestTimeout:120000,connectionTimeout:125000});
 // 备份对象按八进制流透传：bodyLimit 管不到透传流，路由自己按 Content-Length 预检并落盘计数。
 app.addContentTypeParser('application/octet-stream',(_request,payload,done)=>done(null,payload));
 app.addContentTypeParser(/^audio\/(mp4|m4a|x-m4a)/,(_request,payload,done)=>done(null,payload));
 const cache=new Map<string,{expires:number;value:unknown}>();
 const attempts=new Map<string,{count:number;expires:number}>();
 const auth=(header?:string) => store.auth(header?.startsWith('Bearer ')?header.slice(7):'');
 const admin=(header?:string) => {const member=auth(header);if(member.role!=='admin')throw new Problem(403,'ADMIN_ONLY','此操作仅限管理者。');return member;};
 app.setErrorHandler((err,_request,reply)=>{
  if(err instanceof Problem) return reply.code(err.status).send({code:err.code,message:err.message});
  if(err instanceof ZodError) return reply.code(400).send({code:'INVALID_INPUT',message:'输入内容无效，请检查后重试。'});
  const status=(err as {statusCode?:number}).statusCode;
  if(status===413) return reply.code(413).send({code:'TOO_LARGE',message:'照片批次过大，请减少照片后重试。'});
  // Fastify 自己判出的客户端错误（长度对不上、JSON 坏了、内容类型不认识）也按 4xx 回，不伪装成服务故障。
  if(status&&status>=400&&status<500) return reply.code(status).send({code:'INVALID_INPUT',message:status===415?'请求格式不受支持。':'请求内容无效，请重试。'});
  return reply.code(500).send({code:'INTERNAL',message:'服务暂时不可用，请稍后再试。'});
 });
 app.addHook('onSend',async (_request,reply)=>{reply.header('Cache-Control','no-store');reply.header('X-Content-Type-Options','nosniff');});
 app.get('/healthz',async ()=>{store.db.prepare('SELECT 1').get();return {status:'ok',version};});
 app.get('/',async (_request,reply)=>reply.type('text/html; charset=utf-8').send('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>桉桉成长记</title><style>body{font:18px system-ui;max-width:600px;margin:15vh auto;padding:24px;background:#F7F8F5;color:#202923;line-height:1.8}h1{font-size:28px}</style><h1>桉桉成长记</h1><p>留住每一个值得记住的日子。</p><p>请在手机应用中记录。成长记录保存在家人的手机上；家人一起写时，这里只存加密后的内容。AI 只处理家人当次主动提交的文字或声音。</p></html>'));
 app.get('/api/v1/status',async ()=>({initialized:store.initialized(),family:!!store.family()}));
 // ── 家庭与设备（1.1.0）：没有用户名密码。空服务凭部署端激活码开家庭；新手机由管理者当面扫码批准；
 // 所有管理者手机都没了，凭恢复码找回。服务端只存令牌哈希、设备公钥、加密的钥匙包与恢复证明的哈希。
 const throttle=(req:{ip:string},scope:string,perIp:number,globalLimit:number)=>{
  for(const [key,value] of attempts)if(value.expires<Date.now())attempts.delete(key);
  // Per-connection-address plus global throttle per endpoint; do not trust spoofable forwarded headers.
  for(const [key,limit] of [[`${scope}:${req.ip}`,perIp],[`${scope}:global`,globalLimit]] as const) {
   const entry=attempts.get(key)??{count:0,expires:Date.now()+60000};entry.count++;attempts.set(key,entry);
   if(entry.count>limit)throw new Problem(429,'RATE_LIMIT','尝试过多，请稍后再试。');
  }
 };
 const name=z.string().trim().min(1).max(20);
 const deviceName=z.string().trim().min(1).max(80);
 const key32=z.string().regex(/^[A-Za-z0-9_-]{43}$/);
 const hex=(bytes:number)=>z.string().regex(new RegExp(`^[a-f0-9]{${bytes*2}}$`));
 const recovery=z.object({envelope:z.string().min(40).max(200).regex(/^[A-Za-z0-9+/]+=*$/),verifier:hex(32)}).strict();
 const familyInput={familyId:z.string().uuid(),keyId:hex(8),recovery};
 const pairParams=z.object({id:z.string().uuid()});
 app.post('/api/v1/family/activate',async (req,reply)=>{
  throttle(req,'activate',10,30);
  const input=z.object({activationCode:z.string().min(20).max(40),memberId:z.string().uuid(),memberName:name,deviceName,publicKey:key32,...familyInput}).strict().parse(req.body);
  const {activationCode,...rest}=input;
  return reply.code(201).send(store.activate(activationCode,rest));
 });
 app.post('/api/v1/family/upgrade',async req=>{
  const member=admin(req.headers.authorization);
  const input=z.object({publicKey:key32,...familyInput}).strict().parse(req.body);
  const family=store.upgrade(member,input);
  return {familyId:family.familyId,keyId:family.keyId,recoveryVersion:family.recoveryVersion};
 });
 app.get('/api/v1/family',async req=>{
  const member=auth(req.headers.authorization),family=store.family();
  if(!family)throw new Problem(404,'FAMILY_MISSING','这台服务还没有家庭。');
  return {familyId:family.familyId,keyId:family.keyId,recoveryVersion:family.recoveryVersion,me:{memberId:member.id,deviceId:member.deviceId,name:member.name,role:member.role},members:store.members().map(m=>({id:m.id,name:m.name,role:m.role,enabled:!!m.enabled}))};
 });
 app.post('/api/v1/pair/requests',async (req,reply)=>{
  throttle(req,'pair',10,30);
  const input=z.object({publicKey:key32,deviceName,claimHash:hex(32)}).strict().parse(req.body);
  return reply.code(201).send(store.createPair(input));
 });
 app.get('/api/v1/pair/requests/:id',async req=>{
  admin(req.headers.authorization);
  return store.pairForApprover(pairParams.parse(req.params).id);
 });
 app.post('/api/v1/pair/requests/:id/approve',async req=>{
  const approver=admin(req.headers.authorization),{id}=pairParams.parse(req.params);
  const input=z.object({member:z.object({id:z.string().uuid(),name:name.optional(),role:z.enum(['admin','member']).optional()}).strict(),enc:key32,ct:z.string().regex(/^[A-Za-z0-9_-]{24,600}$/)}).strict().parse(req.body);
  return {binding:store.approvePair(approver,id,input)};
 });
 app.post('/api/v1/pair/requests/:id/collect',async (req,reply)=>{
  throttle(req,'collect',90,300);
  const {id}=pairParams.parse(req.params),{claim}=z.object({claim:hex(16)}).strict().parse(req.body);
  const result=store.collectPair(id,claim);
  return reply.code(result.status==='pending'?202:200).send(result);
 });
 app.post('/api/v1/pair/requests/:id/confirm',async req=>{
  const device=auth(req.headers.authorization);
  store.confirmPair(device,pairParams.parse(req.params).id);
  return {ok:true};
 });
 app.post('/api/v1/pair/requests/:id/cancel',async req=>{
  const {id}=pairParams.parse(req.params),body=z.object({claim:hex(16).optional()}).strict().parse(req.body??{});
  if(body.claim===undefined){admin(req.headers.authorization);store.cancelPair(id);}
  else {throttle(req,'collect',90,300);store.cancelPair(id,body.claim);}
  return {ok:true};
 });
 app.post('/api/v1/recovery/claim',async req=>{
  throttle(req,'recovery',5,10);
  const input=z.object({proof:hex(32),memberId:z.string().uuid().optional(),deviceName:deviceName.optional(),publicKey:key32.optional()}).strict().parse(req.body);
  // 第一步只核对恢复证明、列出管理者让选「我是谁」；第二步才登记新手机。
  if(!input.memberId||!input.deviceName||!input.publicKey){store.checkRecovery(input.proof);return {admins:store.admins().map(m=>({id:m.id,name:m.name}))};}
  const {family,...device}=store.recoverAdmin(input.proof,{memberId:input.memberId,deviceName:input.deviceName,publicKey:input.publicKey});
  return {...device,familyId:family.familyId,keyId:family.keyId,recovery:{envelope:family.recoveryEnvelope,version:family.recoveryVersion}};
 });
 app.put('/api/v1/admin/recovery',async req=>{
  admin(req.headers.authorization);
  const input=z.object({keyId:hex(8),version:z.number().int().min(2),envelope:recovery.shape.envelope,verifier:hex(32)}).strict().parse(req.body);
  store.setRecovery(input);return {ok:true};
 });
 // 这台手机退出家庭：自己作废自己的令牌（最后一台管理者手机不行）；清单留给家人合并。
 app.post('/api/v1/me/leave',async req=>{const member=auth(req.headers.authorization);store.revoke(member.deviceId!);return {ok:true};});
 app.get('/api/v1/me',async req=>{const member=auth(req.headers.authorization);return {member,usage:store.usage(member.id),resetTimezone:'UTC'};});
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
 // ── 远端备份对象库（Build 72 起一家人共用）：对象 id 由手机按内容与钥匙派生，谁传上来都是同一份；
 // 清单按设备各存一份，家人一起写就是各台手机互相读对方的清单。服务端只见密文、对象 id 与字节数。
 // 不走 throttle()（反代后按地址限流是全家共享的）。
 const objectParams=z.object({id:z.string().regex(OBJECT_ID)});
 const idList=(max:number)=>z.array(z.string().regex(OBJECT_ID)).max(max);
 const deviceParam=z.object({deviceId:z.string().regex(/^(legacy:)?[0-9a-f-]{36}$/)});
 const uploading=new Map<string,number>();
 const iso=(ms:number)=>new Date(ms).toISOString();
 const manifestView=(m:BackupManifest)=>({deviceId:m.deviceId,memberId:m.memberId,deviceName:m.deviceName,keyId:m.keyId,index:m.index,updatedAt:iso(m.updatedAt)});
 /** 家庭配额剩余：全家共用主人的上限。 */
 const quotaLeft=()=>Math.max(0,store.familyLimitBytes()-backupStore.usage().bytes);
 /** 未知清单让整轮停收；已登记清单与未完成上传的持久占位共同保护家庭对象。 */
 const sweep=(keep:readonly string[]=[])=>{
  const now=Date.now(),claims=store.claimedObjects(now);
  if(store.hasUnknownManifestObjects())return {removed:0,bytes:0};
  return backupStore.prune(new Set([...keep,...store.manifestObjects(),...claims]),now);
 };
 app.get('/api/v1/backup/status',async req=>{
  auth(req.headers.authorization);
  const usage=backupStore.usage(),latest=store.latestManifest();
  return {keyId:latest?.keyId??null,manifestUpdatedAt:latest?iso(latest.updatedAt):null,objects:usage.objects,bytes:usage.bytes,limitBytes:store.familyLimitBytes(),freeBytes:await backupStore.freeBytes(),manifests:store.manifestCount()};
 });
 app.post('/api/v1/backup/objects/have',async req=>{
  const member=auth(req.headers.authorization);
  const {ids}=z.object({ids:idList(5000)}).strict().parse(req.body);
  store.claimObjects(member.deviceId!,ids);
  const present=backupStore.have(ids);
  return {missing:ids.filter(id=>!present.has(id))};
 });
 app.put('/api/v1/backup/objects/:id',async (req,reply)=>{
  const member=auth(req.headers.authorization),{id}=objectParams.parse(req.params);
  if(!String(req.headers['content-type']??'').startsWith('application/octet-stream'))throw new Problem(415,'INVALID_INPUT','请求格式不受支持。');
  const sha256=z.string().regex(OBJECT_ID).parse(req.headers['x-object-sha256']);
  const declared=req.headers['content-length']===undefined?undefined:Number(req.headers['content-length']);
  if(declared!==undefined&&!(Number.isSafeInteger(declared)&&declared>=0))throw new Problem(400,'INVALID_INPUT','请求长度无效。');
  if(declared!==undefined&&declared>OBJECT_LIMIT)throw new Problem(413,'TOO_LARGE','这一份太大，请更新应用后重试。');
  if(await backupStore.freeBytes()<FREE_FLOOR)throw new Problem(507,'SERVER_FULL','服务器空间不足，请联系管理者。');
  // 配额按「比原来多出的字节」算：同 id 重传若变大，一样要有余量（receive 收完再按实际字节复核一次）。
  const left=quotaLeft(),previous=backupStore.stat(id)??0;
  if(declared!==undefined&&declared-previous>left)throw new Problem(413,'QUOTA_FULL','远端备份空间已用完，请联系管理者调整。');
  // 每台设备同时最多两个上传：一台手机把服务端撑满时别的手机不受影响。
  const lane=member.deviceId??member.id,active=uploading.get(lane)??0;
  if(active>=2)throw new Problem(429,'BUSY','正在上传其他内容，请稍后再试。');
  uploading.set(lane,active+1);
  try {
   store.claimObjects(member.deviceId!,[id]);
   const result=await backupStore.receive(id,req.body as Readable,{declared,sha256,limit:OBJECT_LIMIT,quotaLeft,beforeCommit:()=>{auth(req.headers.authorization);}});
   store.claimObjects(member.deviceId!,[id]);
   return reply.code(result.created?201:200).send({id,bytes:result.bytes});
  } finally {
   const remaining=(uploading.get(lane)??1)-1;
   if(remaining<=0)uploading.delete(lane);else uploading.set(lane,remaining);
  }
 });
 app.get('/api/v1/backup/objects/:id',async (req,reply)=>{
  auth(req.headers.authorization);const {id}=objectParams.parse(req.params);
  const found=backupStore.read(id);
  if(!found)throw new Problem(404,'NOT_FOUND','远端没有这一份。');
  return reply.type('application/octet-stream').header('Content-Length',String(found.size)).send(found.stream);
 });
 app.put('/api/v1/backup/manifest',async req=>{
  const member=auth(req.headers.authorization);
  // 索引是手机封好的密文（≤ 64 KiB 明文），服务端只存 keyId 好让换错恢复码在下载前就判出来；
  // objects 是清单引用的对象 id，登记下来让 prune 护住它们（Build 70 的手机不传，视为没登记）。
  // 清单记在这台设备名下：同一成员的两台手机各有一份，成员旧版整份备份迁来的那份随之作废。
  const input=z.object({keyId:z.string().regex(/^[a-f0-9]{16}$/),index:z.string().min(4).max(90000).regex(/^[A-Za-z0-9+/]+=*$/),objects:idList(50000).optional()}).strict().parse(req.body);
  return {updatedAt:iso(store.putManifest(member.deviceId!,member.id,input.keyId,input.index,input.objects??null))};
 });
 app.get('/api/v1/backup/manifest',async req=>{
  // 先给这台设备自己的，没有就给成员名下最新的一份（含旧版迁来的）：Build 71 的手机换机后照样能恢复。
  const member=auth(req.headers.authorization),manifest=store.manifestOf(member.deviceId!)??store.latestManifestOf(member.id);
  if(!manifest)throw new Problem(404,'NOT_FOUND','远端还没有备份。');
  return {deviceId:manifest.deviceId,keyId:manifest.keyId,index:manifest.index,updatedAt:iso(manifest.updatedAt)};
 });
 /** 全家各台设备的清单，新的在前；一起写的手机拿这个去合并。 */
 app.get('/api/v1/backup/manifests',async req=>{const member=auth(req.headers.authorization);return store.activeManifests(member.id).map(manifestView);});
 app.delete('/api/v1/backup/manifests/:deviceId',async req=>{
  const member=auth(req.headers.authorization),{deviceId}=deviceParam.parse(req.params);
  const manifest=store.manifestOf(deviceId);
  if(!manifest)throw new Problem(404,'NOT_FOUND','远端没有这份清单。');
  if(member.role!=='admin'&&manifest.memberId!==member.id)throw new Problem(403,'ADMIN_ONLY','只能删自己设备的清单。');
  store.deleteManifest(deviceId);
  return {ok:true,pruned:sweep()};
 });
 app.post('/api/v1/backup/prune',async req=>{
  auth(req.headers.authorization);
  const {keep}=z.object({keep:idList(50000)}).strict().parse(req.body);
  // 全家清单登记的对象由服务端自己护住；远端已有清单时空 keep 一定是客户端出错，宁可不收拾。
  if(store.manifestCount()>0&&keep.length===0)throw new Problem(400,'INVALID_INPUT','远端已有清单，keep 不能为空。');
  return sweep(keep);
 });
 app.delete('/api/v1/backup',async req=>{
  // Build 71 的「删除远端备份」：只删这位成员名下的清单，对象是全家的，无主的才随手收走。
  const member=auth(req.headers.authorization);
  store.deleteMemberManifests(member.id);
  return {ok:true,pruned:sweep()};
 });
 app.get('/api/v1/admin/overview',async req=>{
  admin(req.headers.authorization);
  // 对象空间是全家一份，成员行上只挂各自设备的清单时间；配额取主人的。
  const manifests=store.manifests();
  return {members:store.members().map(m=>({...m,usage:store.usage(m.id),manifests:manifests.filter(x=>x.memberId===m.id).map(x=>({deviceId:x.deviceId,deviceName:x.deviceName,updatedAt:iso(x.updatedAt)}))})),devices:store.devices(),usage:store.usage(),recent:store.recentUsage(),settings:store.settings(),availableModels:MODEL_IDS,backup:{...backupStore.usage(),limitBytes:store.familyLimitBytes(),manifests:manifests.length},backupFreeBytes:await backupStore.freeBytes()};
 });
 app.put('/api/v1/admin/members/:id/profile',async req=>{
  admin(req.headers.authorization);const {id}=z.object({id:z.string().uuid()}).parse(req.params);
  store.setProfile(id,z.object({name,role:z.enum(['admin','member'])}).strict().parse(req.body));return {ok:true};
 });
 app.patch('/api/v1/admin/members/:id',async req=>{
  admin(req.headers.authorization);const {id}=z.object({id:z.string().uuid()}).parse(req.params);
  const input=z.object({enabled:z.boolean(),photoLimit:z.number().int().min(0).max(10000),writeLimit:z.number().int().min(0).max(10000),backupLimitBytes:z.number().int().min(0).max(10*1024**4).optional()}).strict().parse(req.body);
  store.editMember(id,input);return {ok:true};
 });
 app.delete('/api/v1/admin/members/:id/backup',async req=>{
  admin(req.headers.authorization);const {id}=z.object({id:z.string().uuid()}).parse(req.params);
  if(!store.hasMember(id))throw new Problem(404,'NOT_FOUND','成员不存在。');
  store.deleteMemberManifests(id);return {ok:true,pruned:sweep()};
 });
 app.delete('/api/v1/admin/backup',async req=>{
  // 主人清空全家远端：先删全部清单再删对象，中途崩溃只会留下没人指着的对象，而不是指着空库的清单。
  admin(req.headers.authorization);
  store.deleteAllManifests();backupStore.wipe(store);return {ok:true};
 });
 app.delete('/api/v1/admin/devices/:id',async req=>{
  const member=admin(req.headers.authorization),{id}=z.object({id:z.string().uuid()}).parse(req.params);
  if(id===member.deviceId)throw new Problem(400,'CURRENT_DEVICE','不能停用正在用的这台手机。');
  store.revoke(id);return {ok:true};
 });
 app.put('/api/v1/admin/settings',async req=>{
  admin(req.headers.authorization);
  const input=z.object({paused:z.boolean(),defaultModel:z.enum(MODEL_IDS).optional(),enabledModels:z.array(z.enum(MODEL_IDS)).max(4).optional(),globalPhotos:z.number().int().min(0).max(50000),globalWrites:z.number().int().min(0).max(10000)}).strict().parse(req.body);
  store.setSettings({...input,defaultModel:MODEL_ID,enabledModels:[MODEL_ID]});return {ok:true};
 });
 return app;
}
