import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Store } from './store.ts';
import { hashPassword } from './passwords.ts';
import { BackupStore } from './backup-store.ts';
const file=process.env.DB_FILE??'/data/ai.sqlite';mkdirSync(dirname(file),{recursive:true});
const store=new Store(file);
try {
 if(process.argv[2]==='password') {
  const [name,password]=process.argv.slice(3);if(!name||!password)throw new Error('Usage: node src/manage.ts password <登录名或成员名> <新密码>');
  const member=store.findByUsernameOrName(name);store.setPassword(member.id,await hashPassword(password));
  console.log(`已更新成员「${name}」的密码，可用它登录。`);
 } else if(process.argv[2]==='backup') {
  const destination=process.argv[3];if(!destination)throw new Error('Provide a backup destination');
  await store.db.backup(destination);console.log('Backup complete');
 } else if(process.argv[2]==='wipe-backup') {
  const name=process.argv[3];if(!name)throw new Error('Usage: node src/manage.ts wipe-backup family | <登录名或成员名>');
  if(name==='family') {
   // 一家人共用一个对象空间：清空是全家的事，先删全部清单再删对象。
   store.deleteAllManifests();new BackupStore(process.env.BACKUP_DIR??'/data/backup').wipe(store);
   console.log('已清空家庭远端空间的全部清单与对象；手机上的资料不受影响。');
  } else {
   const member=store.findByUsernameOrName(name);
   store.deleteMemberManifests(member.id);
   console.log(`已删除成员「${name}」名下的远端清单；对象由其他清单决定去留，手机上的资料不受影响。`);
  }
 } else throw new Error('Use password <登录名或成员名> <新密码>, backup <目标文件> or wipe-backup family | <登录名或成员名>');
} finally {store.close();}
