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
  const name=process.argv[3];if(!name)throw new Error('Usage: node src/manage.ts wipe-backup <登录名或成员名>');
  const member=store.findByUsernameOrName(name);
  new BackupStore(process.env.BACKUP_DIR??'/data/backup').wipe(member.id);store.deleteManifest(member.id);
  console.log(`已删除成员「${name}」的远端备份对象与索引；手机上的资料不受影响。`);
 } else throw new Error('Use password <登录名或成员名> <新密码>, backup <目标文件> or wipe-backup <登录名或成员名>');
} finally {store.close();}
