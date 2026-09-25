import type { Store } from './store.ts';

const usage='Usage: node src/manage.ts ai status | pause | resume | limit global <每日文案次数> | limit <家人称呼> <每日文案次数>';
export function manageAI(store:Store,args:string[]):string {
 const [command,target,value]=args;
 if(command==='status'&&args.length===1) {
  const settings=store.settings(),all=store.usage();
  return [
   `AI：${settings.paused?'已暂停':'已开启'}`,
   `全家每日上限：文案 ${settings.globalWrites} 次；今日文案 ${all.writes} 次，调用 ${all.calls} 次。`,
   ...store.members().map(member=>{
    const today=store.usage(member.id);
    return `「${member.name}」：${member.role==='admin'?'管理者':'家人'}，${member.enabled?'已启用':'已停用'}；每日文案 ${member.write_limit} 次；今日文案 ${today.writes} 次，调用 ${today.calls} 次。`;
   }),
   '每日 UTC 00:00 重置；失败不占文案额度，但计入调用次数（每人 200 次／全家 1000 次）。',
  ].join('\n');
 }
 if((command==='pause'||command==='resume')&&args.length===1) {
  store.setSettings({...store.settings(),paused:command==='pause'});
  return command==='pause'?'已暂停全家 AI。':'已恢复全家 AI。';
 }
 if(command==='limit'&&args.length===3&&target&&value!==undefined&&/^\d+$/.test(value)&&Number.isSafeInteger(Number(value))) {
  const limit=Number(value);
  if(target==='global') {
   store.setSettings({...store.settings(),globalWrites:limit});
   return `全家每日文案上限已设为 ${limit} 次。`;
  }
  const member=store.findExactByName(target);
  store.editMember(member.id,{enabled:!!member.enabled,photoLimit:member.photo_limit,writeLimit:limit});
  return `「${member.name}」每日文案上限已设为 ${limit} 次。`;
 }
 throw new Error(usage);
}
