import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { expect, it } from 'vitest';
import { openDatabaseConnection } from '@/db';
const migrations=path.join(process.cwd(),'db/migrations');
const journal=JSON.parse(readFileSync(path.join(migrations,'meta/_journal.json'),'utf8'));
function seed11(file:string){
  const sqlite=new Database(file);sqlite.pragma('foreign_keys=ON');sqlite.exec('CREATE TABLE __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)');
  for(const entry of journal.entries.filter((e:{idx:number})=>e.idx<=35)){
    const source=readFileSync(path.join(migrations,`${entry.tag}.sql`),'utf8');for(const statement of source.split('--> statement-breakpoint'))if(statement.trim())sqlite.exec(statement);
    sqlite.prepare('INSERT INTO __drizzle_migrations(hash,created_at) VALUES (?,?)').run(createHash('sha256').update(source).digest('hex'),entry.when);
  }
  sqlite.prepare('INSERT INTO family(id,name,timezone,created_at,updated_at) VALUES (?,?,?,?,?)').run('family','虚构 1.1 家庭','America/New_York',1000,1000);
  sqlite.prepare('INSERT INTO person(id,family_id,display_name,is_child,birth_date,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run('child','family','小雨',1,'2024-02-29',1000,1000);
  sqlite.prepare('INSERT INTO memory_event(id,family_id,child_person_id,title,occurred_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run('event','family','child','虚构旧记忆',1788000000,1000,1000);
  sqlite.close();
}
it('upgrades an isolated real 1.1 SQLite file in place, preserves old rows and creates a pre-migration snapshot',()=>{
  const root=mkdtempSync(path.join(tmpdir(),'ftc-upgrade12-'));const file=path.join(root,'capsule.sqlite'),snapshots=path.join(root,'snapshots');
  try{seed11(file);const old=new Database(file);const before=old.prepare('select * from memory_event').all();old.close();const connection=openDatabaseConnection({databasePath:file,migrationsFolder:migrations,snapshotDirectory:snapshots});
    expect(connection.sqlite.prepare('select * from memory_event').all()).toEqual(before);expect(connection.sqlite.prepare('select count(*) as n from collection').get()).toEqual({n:0});expect(connection.sqlite.pragma('foreign_key_check')).toEqual([]);connection.sqlite.close();
    const files=readdirSync(snapshots);expect(files.length).toBe(1);const snapshot=new Database(path.join(snapshots,files[0]!));expect(snapshot.prepare('select * from memory_event').all()).toEqual(before);expect(snapshot.prepare("select name from sqlite_schema where name='collection'").all()).toEqual([]);snapshot.close();
  }finally{rmSync(root,{recursive:true,force:true});}
});
it('rolls back a failing 1.2 migration and releases the old volume for recovery',()=>{
  const root=mkdtempSync(path.join(tmpdir(),'ftc-upgrade12-fail-'));const file=path.join(root,'capsule.sqlite'),broken=path.join(root,'migrations'),snapshots=path.join(root,'snapshots');
  try{seed11(file);mkdirSync(path.join(broken,'meta'),{recursive:true});for(const entry of journal.entries)copyFileSync(path.join(migrations,`${entry.tag}.sql`),path.join(broken,`${entry.tag}.sql`));copyFileSync(path.join(migrations,'meta/_journal.json'),path.join(broken,'meta/_journal.json'));
    const last=journal.entries.find((e:{idx:number})=>e.idx===36);const sqlPath=path.join(broken,`${last.tag}.sql`);writeFileSync(sqlPath,readFileSync(sqlPath,'utf8')+'\n--> statement-breakpoint\nINSERT INTO nonexistent_table VALUES(1);');
    expect(()=>openDatabaseConnection({databasePath:file,migrationsFolder:broken,snapshotDirectory:snapshots})).toThrow('migration failed');const sqlite=new Database(file);expect(sqlite.prepare("select name from sqlite_schema where name='collection'").all()).toEqual([]);expect(sqlite.prepare('select title from memory_event').get()).toEqual({title:'虚构旧记忆'});sqlite.prepare('update memory_event set title=? where id=?').run('故障后仍可写入','event');sqlite.close();expect(readdirSync(snapshots)).toHaveLength(1);
  }finally{rmSync(root,{recursive:true,force:true});}
});
