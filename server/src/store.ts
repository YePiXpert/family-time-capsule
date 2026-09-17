import Database from 'better-sqlite3';
import { MODEL_ID } from './ai-model.ts';
import { createHash, randomBytes, randomUUID } from 'node:crypto';

export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export class Problem extends Error {
  status: number; code: string;
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; }
}
export type Member = { id: string; name: string; role: 'owner'|'member'; enabled: number; photo_limit: number; write_limit: number; deviceId?: string };
export type Settings = { paused: boolean; defaultModel: string; enabledModels: string[]; globalPhotos: number; globalWrites: number };
export const initialSettings: Settings = { paused: false, defaultModel: MODEL_ID, enabledModels: [MODEL_ID], globalPhotos: 500, globalWrites: 100 };
export class Store {
  db: Database.Database;
  constructor(file: string) {
    this.db = new Database(file);
    this.db.pragma('journal_mode = WAL'); this.db.pragma('foreign_keys = ON'); this.db.pragma('busy_timeout = 5000');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS members(id TEXT PRIMARY KEY,name TEXT NOT NULL,role TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,photo_limit INTEGER NOT NULL DEFAULT 100,write_limit INTEGER NOT NULL DEFAULT 20);
      CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY,member_id TEXT NOT NULL REFERENCES members(id),name TEXT NOT NULL,token_hash TEXT UNIQUE NOT NULL,revoked INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS invites(hash TEXT PRIMARY KEY,member_id TEXT NOT NULL REFERENCES members(id),expires_at INTEGER NOT NULL,used INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY CHECK(id=1),value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS requests(member_id TEXT NOT NULL,id TEXT NOT NULL,fingerprint TEXT NOT NULL,day TEXT NOT NULL,photos INTEGER NOT NULL,writes INTEGER NOT NULL,model TEXT NOT NULL,status TEXT NOT NULL,created_at INTEGER NOT NULL,tokens INTEGER,error_code TEXT,PRIMARY KEY(member_id,id));
      CREATE INDEX IF NOT EXISTS requests_day ON requests(day,member_id);
    `);
    this.db.prepare('INSERT OR IGNORE INTO settings VALUES(1,?)').run(JSON.stringify(initialSettings));
    this.setSettings(this.settings());
  }
  recover() { this.db.prepare("UPDATE requests SET status='failed',error_code='SERVER_RESTARTED' WHERE status='processing'").run(); }
  settings(): Settings { return { ...JSON.parse((this.db.prepare('SELECT value FROM settings WHERE id=1').get() as { value: string }).value), defaultModel: MODEL_ID, enabledModels: [MODEL_ID] }; }
  setSettings(value: Settings) { this.db.prepare('UPDATE settings SET value=? WHERE id=1').run(JSON.stringify({ ...value, defaultModel: MODEL_ID, enabledModels: [MODEL_ID] })); }
  invite(name: string, memberId?: string, owner = false) {
    return this.db.transaction(() => {
      const id = memberId ?? randomUUID();
      if (memberId) {
        const member = this.db.prepare('SELECT * FROM members WHERE id=? AND enabled=1').get(id) as Member | undefined;
        if (!member || (member.role === 'owner' && !owner)) throw new Problem(400,'MEMBER_INVALID','请选择有效的普通成员。');
      } else this.db.prepare('INSERT INTO members(id,name,role) VALUES(?,?,?)').run(id,name,owner?'owner':'member');
      const code = randomBytes(18).toString('base64url');
      this.db.prepare('INSERT INTO invites VALUES(?,?,?,0)').run(digest(code),id,Date.now()+86400000);
      return { code, memberId: id, expiresAt: new Date(Date.now()+86400000).toISOString() };
    })();
  }
  ownerInvite() {
    const owner = this.db.prepare("SELECT * FROM members WHERE role='owner' LIMIT 1").get() as Member | undefined;
    return this.invite('主人',owner?.id,true);
  }
  enroll(code: string, name: string) {
    return this.db.transaction(() => {
      const row = this.db.prepare('SELECT * FROM invites WHERE hash=? AND used=0 AND expires_at>?').get(digest(code),Date.now()) as {member_id:string}|undefined;
      const member = row && this.db.prepare('SELECT * FROM members WHERE id=? AND enabled=1').get(row.member_id) as Member | undefined;
      if (!member) throw new Problem(401,'INVITE_INVALID','邀请码无效、已使用或已过期。');
      const token = randomBytes(32).toString('base64url'); const deviceId=randomUUID();
      this.db.prepare('INSERT INTO devices VALUES(?,?,?,?,0,?)').run(deviceId,member.id,name,digest(token),Date.now());
      this.db.prepare('UPDATE invites SET used=1 WHERE hash=?').run(digest(code));
      return { token, member: { ...member, deviceId } };
    })();
  }
  auth(token: string): Member {
    const row = this.db.prepare('SELECT m.*,d.id AS deviceId FROM devices d JOIN members m ON m.id=d.member_id WHERE d.token_hash=? AND d.revoked=0 AND m.enabled=1').get(digest(token)) as Member|undefined;
    if (!row) throw new Problem(401,'AUTH_REQUIRED','请先加入邀请，或联系主人重新开通此设备。');
    return row;
  }
  usage(memberId?: string) {
    // Failed requests (upstream garbage, timeout) are not the member's fault and must not burn the day's quota.
    return this.db.prepare(`SELECT COALESCE(SUM(photos),0) photos,COALESCE(SUM(writes),0) writes,COUNT(*) calls,COALESCE(SUM(tokens),0) tokens FROM requests WHERE day=? AND status!='failed' ${memberId?'AND member_id=?':''}`).get(...[new Date().toISOString().slice(0,10),...(memberId?[memberId]:[])]) as { photos:number; writes:number; calls:number; tokens:number };
  }
  reserve(member: Member,id: string,fingerprint: string,photos:number,writes:number,model:string) {
    return this.db.transaction(() => {
      const prev = this.db.prepare('SELECT fingerprint,status FROM requests WHERE member_id=? AND id=?').get(member.id,id) as {fingerprint:string;status:string}|undefined;
      if (prev) {
        if (prev.fingerprint!==fingerprint) throw new Problem(409,'REQUEST_CHANGED','同一请求不能更改内容，请重新发起。');
        return prev.status;
      }
      const settings=this.settings(), mine=this.usage(member.id), all=this.usage();
      if (settings.paused) throw new Problem(503,'AI_PAUSED','主人已暂停 AI，仍可手动编辑。');
      if (!settings.enabledModels.includes(model)) throw new Problem(400,'MODEL_DISABLED','AI 服务配置已更新，请重新生成。');
      if (mine.photos+photos>member.photo_limit || mine.writes+writes>member.write_limit || mine.calls>=200 || all.photos+photos>settings.globalPhotos || all.writes+writes>settings.globalWrites || all.calls>=1000)
        throw new Problem(429,'QUOTA_EXCEEDED','今日 AI 额度已用完，请联系主人或明天再试。');
      const recent=this.db.prepare('SELECT COUNT(*) n FROM requests WHERE member_id=? AND created_at>?').get(member.id,Date.now()-60000) as {n:number};
      if(recent.n>=10) throw new Problem(429,'RATE_LIMIT','请求较多，请稍后继续。');
      const active=this.db.prepare("SELECT COUNT(*) n FROM requests WHERE status='processing'").get() as {n:number};
      if(active.n>=2) throw new Problem(429,'BUSY','AI 正在处理其他照片，请稍后重试。');
      this.db.prepare("INSERT INTO requests(member_id,id,fingerprint,day,photos,writes,model,status,created_at) VALUES(?,?,?,?,?,?,?,'processing',?)").run(member.id,id,fingerprint,new Date().toISOString().slice(0,10),photos,writes,model,Date.now());
      return 'new';
    })();
  }
  finish(memberId:string,id:string,tokens:number|null,error?:string) {
    this.db.prepare('UPDATE requests SET status=?,tokens=?,error_code=? WHERE member_id=? AND id=?').run(error?'failed':'completed',tokens,error??null,memberId,id);
  }
  members() { return this.db.prepare('SELECT * FROM members ORDER BY role DESC,name').all() as Member[]; }
  devices() { return this.db.prepare('SELECT id,member_id,name,revoked,created_at FROM devices ORDER BY created_at DESC').all(); }
  revoke(id:string) { this.db.prepare('UPDATE devices SET revoked=1 WHERE id=?').run(id); }
  editMember(id:string,patch:{enabled:boolean;photoLimit:number;writeLimit:number}) {
    const member=this.db.prepare('SELECT * FROM members WHERE id=?').get(id) as Member|undefined;
    if(!member) throw new Problem(404,'NOT_FOUND','成员不存在。');
    if(member.role==='owner'&&!patch.enabled) throw new Problem(400,'OWNER_REQUIRED','不能停用主人。');
    this.db.prepare('UPDATE members SET enabled=?,photo_limit=?,write_limit=? WHERE id=?').run(patch.enabled?1:0,patch.photoLimit,patch.writeLimit,id);
  }
  recentUsage() { return this.db.prepare('SELECT member_id,day,model,status,COUNT(*) calls,SUM(photos) photos,SUM(writes) writes,SUM(tokens) tokens,error_code FROM requests WHERE created_at>? GROUP BY member_id,day,model,status,error_code ORDER BY day DESC').all(Date.now()-30*86400000); }
  close() { this.db.close(); }
}
