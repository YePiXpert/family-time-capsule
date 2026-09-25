import { z } from 'zod';
import { Problem } from '../store.ts';
import { name, open, type Ctx } from './context.ts';
/**
 * 家庭与设备（1.1.0）：没有用户名密码。空服务凭部署端激活码开家庭；新手机由管理者当面扫码批准；
 * 所有管理者手机都没了，凭恢复码找回。服务端只存令牌哈希、设备公钥、加密的钥匙包与恢复证明的哈希。
 */
export function familyRoutes({app,store,auth,admin,throttle}:Ctx) {
 const deviceName=z.string().trim().min(1).max(80);
 const key32=z.string().regex(/^[A-Za-z0-9_-]{43}$/);
 const hex=(bytes:number)=>z.string().regex(new RegExp(`^[a-f0-9]{${bytes*2}}$`));
 const recovery=z.object({envelope:z.string().min(40).max(200).regex(/^[A-Za-z0-9+/]+=*$/),verifier:hex(32)}).strict();
 const familyInput={familyId:z.string().uuid(),keyId:hex(8),recovery};
 const pairParams=z.object({id:z.string().uuid()});
 app.post('/api/v1/family/activate',open,async (req,reply)=>{
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
 app.post('/api/v1/pair/requests',open,async (req,reply)=>{
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
 app.post('/api/v1/pair/requests/:id/collect',open,async (req,reply)=>{
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
 app.post('/api/v1/pair/requests/:id/cancel',open,async req=>{
  const {id}=pairParams.parse(req.params),body=z.object({claim:hex(16).optional()}).strict().parse(req.body??{});
  if(body.claim===undefined){admin(req.headers.authorization);store.cancelPair(id);}
  else {throttle(req,'collect',90,300);store.cancelPair(id,body.claim);}
  return {ok:true};
 });
 app.post('/api/v1/recovery/claim',open,async req=>{
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
}
