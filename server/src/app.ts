import Fastify from 'fastify';
import { z, ZodError } from 'zod';
import { Store, Problem, digest, type Member } from './store.ts';
import { inputSchema, parseResult, polishBody, POLISH_BODY_LIMIT } from './contracts.ts';
import { MODEL_ID, MODEL_LABEL, MODEL_IDS, LEGACY_MODEL_IDS } from './ai-model.ts';
import type { Provider } from './provider.ts';
export function createApp(store:Store,provider:Provider,version='dev') {
 const app=Fastify({logger:false,bodyLimit:15*1024*1024,requestTimeout:120000,connectionTimeout:125000});
 const cache=new Map<string,{expires:number;value:unknown}>();
 const attempts=new Map<string,{count:number;expires:number}>();
 const auth=(header?:string) => store.auth(header?.startsWith('Bearer ')?header.slice(7):'');
 const owner=(header?:string) => {const member=auth(header);if(member.role!=='owner')throw new Problem(403,'OWNER_ONLY','此操作仅限主人。');return member;};
 app.setErrorHandler((err,_request,reply)=>{
  if(err instanceof Problem) return reply.code(err.status).send({code:err.code,message:err.message});
  if(err instanceof ZodError) return reply.code(400).send({code:'INVALID_INPUT',message:'输入内容无效，请检查后重试。'});
  if((err as {statusCode?:number}).statusCode===413) return reply.code(413).send({code:'TOO_LARGE',message:'照片批次过大，请减少照片后重试。'});
  return reply.code(500).send({code:'INTERNAL',message:'服务暂时不可用，请稍后再试。'});
 });
 app.addHook('onSend',async (_request,reply)=>{reply.header('Cache-Control','no-store');reply.header('X-Content-Type-Options','nosniff');});
 app.get('/healthz',async ()=>{store.db.prepare('SELECT 1').get();return {status:'ok',version};});
 app.get('/',async (_request,reply)=>reply.type('text/html; charset=utf-8').send('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>桉桉成长记</title><style>body{font:18px system-ui;max-width:600px;margin:15vh auto;padding:24px;background:#F7F8F5;color:#202923;line-height:1.8}h1{font-size:28px}</style><h1>桉桉成长记</h1><p>留住每一个值得记住的日子。</p><p>请在手机应用中记录、整理照片和使用 AI。照片与成长记录保存在你的手机，家人在应用中直接加入即可使用 AI。</p></html>'));
 app.post('/api/v1/enroll',async (req,reply)=>{
  for(const [key,value] of attempts)if(value.expires<Date.now())attempts.delete(key);
  // Per-connection-address plus global throttle; do not trust spoofable forwarded headers.
  for(const key of [req.ip,'global']) {
   const entry=attempts.get(key)??{count:0,expires:Date.now()+60000};entry.count++;attempts.set(key,entry);
   if(entry.count>(key==='global'?60:20))throw new Problem(429,'RATE_LIMIT','尝试过多，请稍后再试。');
  }
  const input=z.object({name:z.string().trim().min(1).max(80),deviceName:z.string().trim().min(1).max(80)}).strict().parse(req.body);
  return reply.code(201).send(store.enroll(input.name,input.deviceName));
 });
 app.get('/api/v1/me',async req=>{const member=auth(req.headers.authorization);return {member,usage:store.usage(member.id),resetTimezone:'UTC'};});
 app.get('/api/v1/ai/config',async req=>{auth(req.headers.authorization);const config=store.settings();return {...config,reasoningEffort:'high',models:[{id:MODEL_ID,label:MODEL_LABEL}]};});
 for(const kind of ['group','write'] as const)app.post(`/api/v1/ai/${kind}`,async req=>{
  const member=auth(req.headers.authorization), input=inputSchema.parse(req.body);
  const polish=kind==='write'&&input.writingMode==='polish';
  const recap=kind==='write'&&input.writingMode==='recap';
  if(polish&&(!input.context.trim()||input.photos.length||input.mode!=='photos'))throw new Problem(400,'INVALID_INPUT','请先写下正文再润色。');
  if(recap&&(!input.context.trim()||input.photos.length||input.mode!=='photos'))throw new Problem(400,'INVALID_INPUT','请先补全这一年的记录清单再起草寄语。');
  if(polish&&polishBody(input.context).length>POLISH_BODY_LIMIT)throw new Problem(400,'POLISH_TOO_LONG',`单次润色的正文超过 ${POLISH_BODY_LIMIT} 字上限，请精简后再试。`);
  if((input.mode==='photos'&&!input.photos.length&&!polish&&!recap)||(input.mode==='merge'&&(kind!=='group'||input.photos.length||!input.groups?.length)))throw new Problem(400,'INVALID_INPUT','请先选择照片。');
  const ids=input.mode==='photos'?input.photos.map(p=>p.id):input.groups!.flatMap(g=>g.photoIds);
  if(new Set(ids).size!==ids.length||ids.length>100)throw new Problem(400,'INVALID_INPUT','照片列表重复或超出限制。');
  for(const photo of input.photos) {
   const bytes=Buffer.from(photo.image.split(',')[1]!,'base64');
   if(bytes.length>512*1024||bytes.length<4||bytes[0]!==255||bytes[1]!==216)throw new Problem(400,'INVALID_IMAGE','请发送有效的 JPEG 缩略图。');
  }
  const cacheKey=member.id+':'+input.requestId;
  for(const [key,value]of cache)if(value.expires<Date.now())cache.delete(key);
  const status=store.reserve(member,input.requestId,digest(kind+JSON.stringify(input)),input.photos.length,kind==='write'?1:0,input.model);
  if(status!=='new') {
   if(status==='completed'&&cache.has(cacheKey))return cache.get(cacheKey)!.value;
   throw new Problem(409,status==='processing'?'REQUEST_PENDING':'RESULT_EXPIRED',status==='processing'?'这次请求仍在处理中，请稍后重试。':'这次请求已结束，结果无法恢复；可重新生成，原草稿不变。');
  }
  try {
   const output=await provider(kind,input);
   const result=parseResult(output.result,kind,input);
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
 app.get('/api/v1/admin/overview',async req=>{owner(req.headers.authorization);return {members:store.members().map(m=>({...m,usage:store.usage(m.id)})),devices:store.devices(),usage:store.usage(),recent:store.recentUsage(),settings:store.settings(),availableModels:MODEL_IDS};});
 app.patch('/api/v1/admin/members/:id',async req=>{
  owner(req.headers.authorization);const {id}=z.object({id:z.string().uuid()}).parse(req.params);
  const input=z.object({enabled:z.boolean(),photoLimit:z.number().int().min(0).max(10000),writeLimit:z.number().int().min(0).max(10000)}).strict().parse(req.body);
  store.editMember(id,input);return {ok:true};
 });
 app.delete('/api/v1/admin/devices/:id',async req=>{
  const member=owner(req.headers.authorization),{id}=z.object({id:z.string().uuid()}).parse(req.params);
  if(id===member.deviceId)throw new Problem(400,'CURRENT_DEVICE','不能撤销当前主人设备。');
  store.revoke(id);return {ok:true};
 });
 app.put('/api/v1/admin/settings',async req=>{
  owner(req.headers.authorization);
  const input=z.object({paused:z.boolean(),defaultModel:z.enum(LEGACY_MODEL_IDS).optional(),enabledModels:z.array(z.enum(LEGACY_MODEL_IDS)).max(4).optional(),globalPhotos:z.number().int().min(0).max(50000),globalWrites:z.number().int().min(0).max(10000)}).strict().parse(req.body);
  store.setSettings({...input,defaultModel:MODEL_ID,enabledModels:[MODEL_ID]});return {ok:true};
 });
 return app;
}
