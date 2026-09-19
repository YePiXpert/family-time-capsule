import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Store } from './store.ts';
const file=process.env.DB_FILE??'/data/ai.sqlite';mkdirSync(dirname(file),{recursive:true});
const store=new Store(file);
try {
 if(process.argv[2]==='owner') {
  const name=process.argv[3];if(!name)throw new Error('Usage: node src/manage.ts owner <成员名>');
  store.promote(name);console.log(`已把成员「${name}」升为主人。`);
 } else if(process.argv[2]==='backup') {
  const destination=process.argv[3];if(!destination)throw new Error('Provide a backup destination');
  await store.db.backup(destination);console.log('Backup complete');
 } else throw new Error('Use owner <成员名> or backup');
} finally {store.close();}
