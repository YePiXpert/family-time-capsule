import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Store } from './store.ts';
import { BackupStore } from './backup-store.ts';
import { manageAI } from './manage-ai.ts';
const file=process.env.DB_FILE??'/data/ai.sqlite';mkdirSync(dirname(file),{recursive:true});
const store=new Store(file);
try {
 if(process.argv[2]==='activation') {
  // 空服务开家庭的一次性激活码：24 小时内用一次；再运行一次，上一枚作废。
  const code=store.issueActivationCode();
  console.log(`激活码（24 小时内有效，只能用一次）：${code}\n在管理者的手机上「我的 → 家庭与设备 → 开始一个家庭」输入。`);
 } else if(process.argv[2]==='promote') {
  // 最后一招：所有管理者手机与恢复码都没了，把一位家人升为管理者（他的手机本来就有钥匙）。
  const name=process.argv[3];if(!name)throw new Error('Usage: node src/manage.ts promote <家人称呼>');
  store.promote(name);console.log(`已把「${name}」设为管理者；请在他的手机上重新生成恢复码。`);
 } else if(process.argv[2]==='ai') {
  console.log(manageAI(store,process.argv.slice(3)));
 } else if(process.argv[2]==='backup') {
  const destination=process.argv[3];if(!destination)throw new Error('Provide a backup destination');
  await store.db.backup(destination);console.log('Backup complete');
 } else if(process.argv[2]==='wipe-backup') {
  const name=process.argv[3];if(!name)throw new Error('Usage: node src/manage.ts wipe-backup family | <家人称呼>');
  if(name==='family') {
   // 一家人共用一个对象空间：清空是全家的事，先删全部清单再删对象。
   store.deleteAllManifests();new BackupStore(process.env.BACKUP_DIR??'/data/backup').wipe(store);
   console.log('已清空家庭远端空间的全部清单与对象；手机上的资料不受影响。');
  } else {
   const member=store.findExactByName(name);
   store.deleteMemberManifests(member.id);
   console.log(`已删除成员「${name}」名下的远端清单；对象由其他清单决定去留，手机上的资料不受影响。`);
  }
 } else throw new Error('Use activation, promote <家人称呼>, ai status | pause | resume | limit global <每日文案次数> | limit <家人称呼> <每日文案次数>, backup <目标文件> or wipe-backup family | <家人称呼>');
} finally {store.close();}
