import { BlockList, isIP } from 'node:net';
import Fastify from 'fastify';
import { ZodError } from 'zod';
import { Store, Problem } from './store.ts';
import type { Provider } from './provider.ts';
import type { BackupStore } from './backup-store.ts';
import type { Transcoder, Transcriber } from './transcribe.ts';
import { open, type Ctx } from './routes/context.ts';
import { familyRoutes } from './routes/family.ts';
import { aiRoutes } from './routes/ai.ts';
import { backupRoutes } from './routes/backup.ts';
import { adminRoutes } from './routes/admin.ts';
/** TRUST_PROXY 只收地址、网段或 loopback/linklocal/uniquelocal；写错（如 true、跳数）就启动失败，不悄悄信任所有人。 */
export function parseTrustProxy(value?:string):string[]|false {
 const entries=(value??'').split(',').map(entry=>entry.trim()).filter(Boolean);
 for(const entry of entries) {
  const [address,prefix,...rest]=entry.split('/');
  const named=['loopback','linklocal','uniquelocal'].includes(entry);
  const version=isIP(address??'');
  if(!named&&(!version||rest.length||(prefix!==undefined&&!(/^\d{1,3}$/.test(prefix)&&Number(prefix)<=(version===4?32:128)))))throw new Error('TRUST_PROXY 只能是逗号分隔的反代地址或网段。');
 }
 return entries.length?entries:false;
}
/** 本机回环、私有网段与链路本地：反代常见的来源（APP_BIND 在私有网段）。 */
const proxyNets=new BlockList();
for(const [net,prefix,type] of [['127.0.0.0',8,'ipv4'],['10.0.0.0',8,'ipv4'],['172.16.0.0',12,'ipv4'],['192.168.0.0',16,'ipv4'],['169.254.0.0',16,'ipv4'],['::1',128,'ipv6'],['fc00::',7,'ipv6'],['fe80::',10,'ipv6']] as const)proxyNets.addSubnet(net,prefix,type);
export function isProxyAddress(ip:string):boolean {
 const mapped=ip.startsWith('::ffff:')?ip.slice(7):ip;
 const version=isIP(mapped);
 return version===4?proxyNets.check(mapped,'ipv4'):version===6?proxyNets.check(mapped,'ipv6'):false;
}
/**
 * trustProxy：可信反代的地址或网段（逗号分隔，Fastify trustProxy 的字符串写法），默认不认转发头。
 * 只有来自这些地址的连接，才用它们写的 X-Forwarded-For 当来源地址；按地址的限流与配对名额靠它才分得开家人和别人。
 */
export function createApp(store:Store,provider:Provider,version:string,backupStore:BackupStore,transcribe:{transcoder:Transcoder;transcriber:Transcriber;model?:string},opts:{trustProxy?:string}={}) {
 const trustProxy=parseTrustProxy(opts.trustProxy);
 // 全局关闭 Fastify 日志：请求体、响应体与异常对象都不交给 logger。
 const app=Fastify({logger:false,bodyLimit:1024*1024,requestTimeout:120000,connectionTimeout:125000,trustProxy});
 // 备份对象按八进制流透传：bodyLimit 管不到透传流，路由自己按 Content-Length 预检并落盘计数。
 app.addContentTypeParser('application/octet-stream',(_request,payload,done)=>done(null,payload));
 app.addContentTypeParser(/^audio\/(mp4|m4a|x-m4a)/,(_request,payload,done)=>done(null,payload));
 const attempts=new Map<string,{count:number;expires:number}>();
 const auth=(header?:string) => store.auth(header?.startsWith('Bearer ')?header.slice(7):'');
 const admin=(header?:string) => {const member=auth(header);if(member.role!=='admin')throw new Problem(403,'ADMIN_ONLY','此操作仅限管理者。');return member;};
 app.setErrorHandler((err,_request,reply)=>{
  if(err instanceof Problem) return reply.code(err.status).send({code:err.code,message:err.message});
  if(err instanceof ZodError) return reply.code(400).send({code:'INVALID_INPUT',message:'输入内容无效，请检查后重试。'});
  const status=(err as {statusCode?:number}).statusCode;
  if(status===413) return reply.code(413).send({code:'TOO_LARGE',message:'请求内容太大，请更新应用后重试。'});
  // Fastify 自己判出的客户端错误（长度对不上、JSON 坏了、内容类型不认识）也按 4xx 回，不伪装成服务故障。
  if(status&&status>=400&&status<500) return reply.code(status).send({code:'INVALID_INPUT',message:status===415?'请求格式不受支持。':'请求内容无效，请重试。'});
  return reply.code(500).send({code:'INTERNAL',message:'服务暂时不可用，请稍后再试。'});
 });
 // 关停时正在处理的请求答完就断开 keep-alive：否则 close() 要等 72 秒空闲超时，docker stop 只给 10 秒。
 let closing=false;app.addHook('preClose',async()=>{closing=true;});
 app.addHook('onSend',async (_request,reply)=>{reply.header('Cache-Control','no-store');reply.header('X-Content-Type-Options','nosniff');if(closing)reply.header('Connection','close');});
 // 设备接口先鉴权再解析请求体：匿名请求不能让服务把几 MiB 的 JSON 解析进堆。
 app.addHook('onRequest',async req=>{if(req.routeOptions.url!==undefined&&!req.routeOptions.config.anonymous)auth(req.headers.authorization);});
 app.get('/healthz',open,async ()=>{store.db.prepare('SELECT 1').get();return {status:'ok',version};});
 app.get('/',open,async (_request,reply)=>reply.type('text/html; charset=utf-8').send('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>桉桉成长记</title><style>body{font:18px system-ui;max-width:600px;margin:15vh auto;padding:24px;background:#F7F8F5;color:#202923;line-height:1.8}h1{font-size:28px}</style><h1>桉桉成长记</h1><p>留住每一个值得记住的日子。</p><p>请在手机应用中记录。成长记录保存在家人的手机上；家人一起写时，这里只存加密后的内容。AI 只处理家人当次主动提交的文字或声音。</p></html>'));
 app.get('/api/v1/status',open,async ()=>({initialized:store.initialized(),family:!!store.family()}));
 const throttle=(req:{ip:string},scope:string,perIp:number,globalLimit:number)=>{
  for(const [key,value] of attempts)if(value.expires<Date.now())attempts.delete(key);
  // 按来源地址加全局两级限流。来源地址默认是连接地址；只有 TRUST_PROXY 列出的反代写的 X-Forwarded-For 才认。
  for(const [key,limit] of [[`${scope}:${req.ip}`,perIp],[`${scope}:global`,globalLimit]] as const) {
   const entry=attempts.get(key)??{count:0,expires:Date.now()+60000};entry.count++;attempts.set(key,entry);
   if(entry.count>limit)throw new Problem(429,'RATE_LIMIT','尝试过多，请稍后再试。');
  }
 };
 // 配对名额按来源地址分：没设 TRUST_PROXY 时，本机回环与私有网段的连接就是反代本身，所有人共用它的地址，
 // 按它分就等于全服务只剩 3 个名额——这时不按地址分，只算全服务上限。
 const pairSource=(req:{ip:string})=>trustProxy||!isProxyAddress(req.ip)?req.ip:undefined;
 const ctx:Ctx={app,store,backupStore,auth,admin,throttle,pairSource};
 familyRoutes(ctx);
 aiRoutes(ctx,provider,transcribe);
 const {sweep}=backupRoutes(ctx);
 adminRoutes(ctx,sweep);
 return app;
}
