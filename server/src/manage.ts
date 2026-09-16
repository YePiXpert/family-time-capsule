import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Store } from './store.ts';
const file=process.env.DB_FILE??'/data/ai.sqlite';mkdirSync(dirname(file),{recursive:true});
const store=new Store(file);
try {
 if(process.argv[2]==='owner')console.log(JSON.stringify(store.ownerInvite()));
 else if(process.argv[2]==='backup') {
  const destination=process.argv[3];if(!destination)throw new Error('Provide a backup destination');
  await store.db.backup(destination);console.log('Backup complete');
 } else throw new Error('Use owner or backup');
} finally {store.close();}
