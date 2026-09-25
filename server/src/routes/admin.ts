import { z } from 'zod';
import { Problem } from '../store.ts';
import { MODEL_ID, MODEL_IDS } from '../ai-model.ts';
import { iso, name, type Ctx } from './context.ts';
/** 管理者：成员、设备、额度、全家远端。sweep 来自 backupRoutes。 */
export function adminRoutes({app,store,backupStore,admin}:Ctx,sweep:(keep?:readonly string[])=>{removed:number;bytes:number}) {
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
}
