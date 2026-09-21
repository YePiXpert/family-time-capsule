import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Store } from './store.ts';
import { cpaProvider } from './provider.ts';
import { cpaTranscriber, ffmpegTranscoder } from './transcribe.ts';
import { createApp } from './app.ts';
import { BackupStore } from './backup-store.ts';
const file=process.env.DB_FILE??'/data/ai.sqlite';
mkdirSync(dirname(file),{recursive:true});
const store=new Store(file);store.recover();
// 监听前不可能有上传在途：临时目录里的全是上次崩溃的残骸，一个不留。
const backups=new BackupStore(process.env.BACKUP_DIR??'/data/backup');backups.sweepTemp(0);
// Build 72：按成员分的对象目录搬进家庭空间，一次性、幂等；搬过就没有成员目录了。
const migrated=backups.migrateMemberSpaces();if(migrated.members||migrated.failed)console.info(`Backup objects migrated into the family space: ${migrated.moved} moved, ${migrated.duplicates} duplicates, ${migrated.members} member dirs checked, ${migrated.failed} failed`);
const baseUrl=process.env.CPA_BASE_URL??'http://10.66.66.2:8317/v1',keyFile=process.env.CPA_KEY_FILE??'/run/secrets/cpa-key',model=process.env.TRANSCRIBE_MODEL??'mimo-v2.5-asr';
const app=createApp(store,cpaProvider(baseUrl,keyFile),process.env.SOURCE_SHA??'dev',backups,{transcoder:ffmpegTranscoder({ffmpegPath:process.env.FFMPEG_PATH}),transcriber:cpaTranscriber(process.env.TRANSCRIBE_BASE_URL??baseUrl,process.env.TRANSCRIBE_KEY_FILE??keyFile,model),model});
await app.listen({host:'0.0.0.0',port:Number(process.env.PORT??3000)});
console.info('Anan AI service listening');
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{void app.close().then(()=>{store.close();process.exit(0);});});
