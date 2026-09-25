import type { Readable } from 'node:stream';
import { z } from 'zod';
import { Problem, type BackupManifest } from '../store.ts';
import { FREE_FLOOR, OBJECT_ID, OBJECT_LIMIT } from '../backup-store.ts';
import { iso, type Ctx } from './context.ts';
/**
 * 远端备份对象库（Build 72 起一家人共用）：对象 id 由手机按内容与钥匙派生，谁传上来都是同一份；
 * 清单按设备各存一份，家人一起写就是各台手机互相读对方的清单。服务端只见密文、对象 id 与字节数。
 * 不走 throttle()（反代后按地址限流是全家共享的）。返回 sweep 给管理接口用。
 */
export function backupRoutes({app,store,backupStore,auth}:Ctx) {
 const objectParams=z.object({id:z.string().regex(OBJECT_ID)});
 const idList=(max:number)=>z.array(z.string().regex(OBJECT_ID)).max(max);
 const deviceParam=z.object({deviceId:z.string().regex(/^(legacy:)?[0-9a-f-]{36}$/)});
 const uploading=new Map<string,number>();
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
 app.put('/api/v1/backup/manifest',{bodyLimit:4*1024*1024},async req=>{
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
 app.post('/api/v1/backup/prune',{bodyLimit:4*1024*1024},async req=>{
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
 return {sweep};
}
