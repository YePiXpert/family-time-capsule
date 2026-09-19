import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Store } from './store.ts';
import { hashPassword } from './passwords.ts';
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
 } else throw new Error('Use password <登录名或成员名> <新密码> or backup');
} finally {store.close();}
