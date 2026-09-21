import Database from 'better-sqlite3';
import { MODEL_ID } from './ai-model.ts';
import { createHash, randomBytes, randomUUID } from 'node:crypto';

/** 成员默认远端备份配额 20 GiB；主人可在管理页调整。 */
export const DEFAULT_BACKUP_LIMIT = 20 * 1024 ** 3;
/** 尚未发布清单的上传占位：重启仍有效，48 小时未续期才释放。 */
export const OBJECT_CLAIM_TTL_MS = 48 * 60 * 60 * 1000;
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const uniqueProblem = (error: unknown) =>
  error instanceof Error && String((error as {code?:string}).code ?? error.message).includes('UNIQUE')
    ? new Problem(409,'USERNAME_TAKEN','这个用户名已经在用了。') : error;
export class Problem extends Error {
  status: number; code: string;
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; }
}
export type Member = { id: string; name: string; role: 'owner'|'member'; enabled: number; photo_limit: number; write_limit: number; username: string|null; backup_limit_bytes: number; deviceId?: string };
/** 一台设备发布的清单：密文索引、钥匙指纹、登记的对象。旧版整份备份迁来的行 deviceId 是 `legacy:<成员 id>`，deviceName 为 null。 */
export type BackupManifest = { deviceId: string; memberId: string; deviceName: string | null; keyId: string; index: string; updatedAt: number; objects: string[] };
export type Settings = { paused: boolean; defaultModel: string; enabledModels: string[]; globalPhotos: number; globalWrites: number };
export const initialSettings: Settings = { paused: false, defaultModel: MODEL_ID, enabledModels: [MODEL_ID], globalPhotos: 500, globalWrites: 100 };
export class Store {
  db: Database.Database;
  constructor(file: string) {
    this.db = new Database(file);
    this.db.pragma('journal_mode = WAL'); this.db.pragma('foreign_keys = ON'); this.db.pragma('busy_timeout = 5000');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS members(id TEXT PRIMARY KEY,name TEXT NOT NULL,role TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,photo_limit INTEGER NOT NULL DEFAULT 100,write_limit INTEGER NOT NULL DEFAULT 20,username TEXT,password_hash TEXT,backup_limit_bytes INTEGER NOT NULL DEFAULT 21474836480);
      CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY,member_id TEXT NOT NULL REFERENCES members(id),name TEXT NOT NULL,token_hash TEXT UNIQUE NOT NULL,revoked INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY CHECK(id=1),value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS requests(member_id TEXT NOT NULL,id TEXT NOT NULL,fingerprint TEXT NOT NULL,day TEXT NOT NULL,photos INTEGER NOT NULL,writes INTEGER NOT NULL,model TEXT NOT NULL,status TEXT NOT NULL,created_at INTEGER NOT NULL,tokens INTEGER,error_code TEXT,PRIMARY KEY(member_id,id));
      CREATE INDEX IF NOT EXISTS requests_day ON requests(day,member_id);
      DROP TABLE IF EXISTS invites;
      CREATE TABLE IF NOT EXISTS backup_manifests_v2(device_id TEXT PRIMARY KEY,member_id TEXT NOT NULL REFERENCES members(id),key_id TEXT NOT NULL,index_b64 TEXT NOT NULL,updated_at INTEGER NOT NULL,objects_json TEXT);
      CREATE INDEX IF NOT EXISTS backup_manifests_v2_member ON backup_manifests_v2(member_id,updated_at);
      CREATE TABLE IF NOT EXISTS backup_object_claims(device_id TEXT NOT NULL REFERENCES devices(id),object_id TEXT NOT NULL,claimed_at INTEGER NOT NULL,PRIMARY KEY(device_id,object_id));
      CREATE INDEX IF NOT EXISTS backup_object_claims_time ON backup_object_claims(claimed_at);
    `);
    // 旧库补上账号列（唯一索引用部分索引，多个 NULL 不冲突）。
    const columns=this.db.prepare('PRAGMA table_info(members)').all() as {name:string}[];
    if(!columns.some(column=>column.name==='username'))this.db.exec('ALTER TABLE members ADD COLUMN username TEXT;ALTER TABLE members ADD COLUMN password_hash TEXT;');
    // Build 70：远端备份配额列；旧库补默认值即可。
    if(!columns.some(column=>column.name==='backup_limit_bytes'))this.db.exec(`ALTER TABLE members ADD COLUMN backup_limit_bytes INTEGER NOT NULL DEFAULT ${DEFAULT_BACKUP_LIMIT}`);
    // Build 72：清单改为按设备存（一家人共用对象空间，各台手机各发布一份）。Build 70／71 按成员存的那张表
    // 逐行迁成 `legacy:<成员 id>`——成员任一台设备发布过自己的清单后就把它删掉（内容已被包含）。首版没有 objects_json 列。
    if(this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='backup_manifests'").get()) {
      const legacyColumns=this.db.prepare('PRAGMA table_info(backup_manifests)').all() as {name:string}[];
      const objectsColumn=legacyColumns.some(column=>column.name==='objects_json')?'objects_json':'NULL';
      this.db.exec(`INSERT OR IGNORE INTO backup_manifests_v2(device_id,member_id,key_id,index_b64,updated_at,objects_json) SELECT 'legacy:'||member_id,member_id,key_id,index_b64,updated_at,${objectsColumn} FROM backup_manifests; DROP TABLE backup_manifests;`);
    }
    this.db.exec('CREATE UNIQUE INDEX IF NOT EXISTS members_username ON members(username) WHERE username IS NOT NULL');
    this.db.prepare('INSERT OR IGNORE INTO settings VALUES(1,?)').run(JSON.stringify(initialSettings));
    this.setSettings(this.settings());
  }
  recover() { this.db.prepare("UPDATE requests SET status='failed',error_code='SERVER_RESTARTED' WHERE status='processing'").run(); }
  settings(): Settings { return { ...JSON.parse((this.db.prepare('SELECT value FROM settings WHERE id=1').get() as { value: string }).value), defaultModel: MODEL_ID, enabledModels: [MODEL_ID] }; }
  setSettings(value: Settings) { this.db.prepare('UPDATE settings SET value=? WHERE id=1').run(JSON.stringify({ ...value, defaultModel: MODEL_ID, enabledModels: [MODEL_ID] })); }
  initialized() { return !!this.db.prepare('SELECT 1 FROM members LIMIT 1').get(); }
  /** 空库上的一次性初始化：第一台设备直接成为主人，之后家人账号都由主人创建。 */
  setup(username: string, passwordHash: string, deviceName: string) {
    return this.db.transaction(() => {
      if(this.initialized()) throw new Problem(409,'SETUP_DONE','这台服务已经初始化过，请直接登录。');
      const id=randomUUID();
      this.insertMember(id,username,passwordHash,'owner',username);
      return this.attach(id,deviceName);
    })();
  }
  createMember(username: string, passwordHash: string, name = username) {
    const id=randomUUID();
    try { this.insertMember(id,username,passwordHash,'member',name); }
    catch(error) { throw uniqueProblem(error); }
    return this.memberById(id);
  }
  setLogin(id: string, username: string, passwordHash: string) {
    if(!this.db.prepare('SELECT 1 FROM members WHERE id=?').get(id)) throw new Problem(404,'NOT_FOUND','成员不存在。');
    try { this.db.prepare('UPDATE members SET username=?,password_hash=? WHERE id=?').run(username,passwordHash,id); }
    catch(error) { throw uniqueProblem(error); }
  }
  setPassword(id: string, passwordHash: string) { this.db.prepare('UPDATE members SET password_hash=? WHERE id=?').run(passwordHash,id); }
  byUsername(username: string) { return this.db.prepare('SELECT * FROM members WHERE username=?').get(username) as (Member&{password_hash:string|null})|undefined; }
  fullById(id: string) { return this.db.prepare('SELECT * FROM members WHERE id=?').get(id) as (Member&{password_hash:string|null})|undefined; }
  /** 兜底命令用：先按登录名找，找不到再按成员名（主人重置登录会改登录名但不改成员名）。 */
  findByUsernameOrName(name: string) {
    return this.byUsername(name) ?? this.findExactByName(name);
  }
  findExactByName(name: string) {
    const rows=this.db.prepare('SELECT * FROM members WHERE name=?').all(name) as Member[];
    if(rows.length!==1) throw new Problem(400,'MEMBER_INVALID',`成员「${name}」不存在或重名，请先确认名字。`);
    return rows[0]!;
  }
  insertMember(id: string, username: string, passwordHash: string, role: 'owner'|'member', name: string) {
    this.db.prepare('INSERT INTO members(id,name,role,username,password_hash) VALUES(?,?,?,?,?)').run(id,name,role,username,passwordHash);
  }
  /** 登录成功后给成员发一台设备；返回的成员带 deviceId，绝不含密码哈希。 */
  attach(memberId: string, deviceName: string) {
    const token=randomBytes(32).toString('base64url'),deviceId=randomUUID();
    this.db.prepare('INSERT INTO devices VALUES(?,?,?,?,0,?)').run(deviceId,memberId,deviceName,digest(token),Date.now());
    return { token, member: this.memberById(memberId,deviceId) };
  }
  memberById(id: string, deviceId?: string) {
    const member=this.db.prepare('SELECT id,name,role,enabled,photo_limit,write_limit,username,backup_limit_bytes FROM members WHERE id=?').get(id) as Member;
    return deviceId?{...member,deviceId}:member;
  }
  auth(token: string): Member {
    const row = this.db.prepare('SELECT m.id,m.name,m.role,m.enabled,m.photo_limit,m.write_limit,m.username,m.backup_limit_bytes,d.id AS deviceId FROM devices d JOIN members m ON m.id=d.member_id WHERE d.token_hash=? AND d.revoked=0 AND m.enabled=1').get(digest(token)) as Member|undefined;
    if (!row) throw new Problem(401,'AUTH_REQUIRED','请先登录，或联系主人重新开通此设备。');
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
    // 已完成的请求不可被晚到的失败回写覆盖（例如成功后授权失效）：第二次 finish 静默无效。
    this.db.prepare("UPDATE requests SET status=?,tokens=?,error_code=? WHERE member_id=? AND id=? AND status!='completed'").run(error?'failed':'completed',tokens,error??null,memberId,id);
  }
  members() { return this.db.prepare('SELECT id,name,role,enabled,photo_limit,write_limit,username,backup_limit_bytes FROM members ORDER BY role DESC,name').all() as Member[]; }
  devices() { return this.db.prepare('SELECT id,member_id,name,revoked,created_at FROM devices ORDER BY created_at DESC').all(); }
  revoke(id:string) { this.db.prepare('UPDATE devices SET revoked=1 WHERE id=?').run(id); }
  revokeOthers(memberId:string,keepDeviceId:string) { this.db.prepare('UPDATE devices SET revoked=1 WHERE member_id=? AND id!=?').run(memberId,keepDeviceId); }
  revokeAll(memberId:string) { this.db.prepare('UPDATE devices SET revoked=1 WHERE member_id=?').run(memberId); }
  editMember(id:string,patch:{enabled:boolean;photoLimit:number;writeLimit:number;backupLimitBytes?:number}) {
    const member=this.db.prepare('SELECT * FROM members WHERE id=?').get(id) as Member|undefined;
    if(!member) throw new Problem(404,'NOT_FOUND','成员不存在。');
    if(member.role==='owner'&&!patch.enabled) throw new Problem(400,'OWNER_REQUIRED','不能停用主人。');
    this.db.prepare('UPDATE members SET enabled=?,photo_limit=?,write_limit=?,backup_limit_bytes=COALESCE(?,backup_limit_bytes) WHERE id=?').run(patch.enabled?1:0,patch.photoLimit,patch.writeLimit,patch.backupLimitBytes??null,id);
  }
  /** 家庭配额：主人的 backup_limit_bytes 就是全家的上限（一台服务一家人）。 */
  familyLimitBytes(): number {
    const row=this.db.prepare("SELECT backup_limit_bytes FROM members WHERE role='owner' ORDER BY rowid LIMIT 1").get() as {backup_limit_bytes:number}|undefined;
    return row?.backup_limit_bytes??DEFAULT_BACKUP_LIMIT;
  }
  /**
   * 一台设备发布自己的清单：密文索引（服务端只认 keyId 与一段 base64）与它引用的对象 id（prune 永远不删）。
   * 这台设备发布过，成员名下从旧版迁来的整份备份就被包含了，一并删掉。
   */
  putManifest(deviceId:string,memberId:string,keyId:string,index:string,objects:readonly string[]|null=null) {
    const updatedAt=Date.now();
    this.db.transaction(()=>{
      this.db.prepare('INSERT INTO backup_manifests_v2(device_id,member_id,key_id,index_b64,updated_at,objects_json) VALUES(?,?,?,?,?,?) ON CONFLICT(device_id) DO UPDATE SET member_id=excluded.member_id,key_id=excluded.key_id,index_b64=excluded.index_b64,updated_at=excluded.updated_at,objects_json=excluded.objects_json').run(deviceId,memberId,keyId,index,updatedAt,objects===null?null:JSON.stringify(objects));
      if(!deviceId.startsWith('legacy:'))this.db.prepare("DELETE FROM backup_manifests_v2 WHERE device_id='legacy:'||?").run(memberId);
      // 完整登记提交成功后，由清单接管保护；只解除本设备的上传占位，与清单写入同一事务。
      if(objects!==null)this.db.prepare('DELETE FROM backup_object_claims WHERE device_id=?').run(deviceId);
    })();
    return updatedAt;
  }
  private manifestRows(where='',...params:unknown[]): BackupManifest[] {
    const rows=this.db.prepare(`SELECT m.device_id,m.member_id,m.key_id,m.index_b64,m.updated_at,m.objects_json,d.name AS device_name FROM backup_manifests_v2 m LEFT JOIN devices d ON d.id=m.device_id ${where} ORDER BY m.updated_at DESC`).all(...params) as {device_id:string;member_id:string;key_id:string;index_b64:string;updated_at:number;objects_json:string|null;device_name:string|null}[];
    return rows.map(row=>({deviceId:row.device_id,memberId:row.member_id,deviceName:row.device_name,keyId:row.key_id,index:row.index_b64,updatedAt:row.updated_at,objects:row.objects_json?JSON.parse(row.objects_json) as string[]:[]}));
  }
  /** 全部设备的清单，新的在前。 */
  manifests(): BackupManifest[] { return this.manifestRows(); }
  /** 全家合并只取未撤销设备的清单；没有设备行的旧版备份仍参与合并。 */
  activeManifests(): BackupManifest[] { return this.manifestRows('WHERE d.revoked IS NULL OR d.revoked=0'); }
  manifestOf(deviceId:string): BackupManifest|undefined { return this.manifestRows('WHERE m.device_id=?',deviceId)[0]; }
  /** 成员名下最新的一份（含旧版迁来的）：给 Build 71 的 GET /backup/manifest 用。 */
  latestManifestOf(memberId:string): BackupManifest|undefined { return this.manifestRows('WHERE m.member_id=?',memberId)[0]; }
  latestManifest(): BackupManifest|undefined { return this.manifestRows()[0]; }
  /** 全部清单登记的对象并集：prune 的保护名单。 */
  manifestObjects(): Set<string> {
    const keep=new Set<string>();
    for(const row of this.db.prepare('SELECT objects_json FROM backup_manifests_v2').all() as {objects_json:string|null}[])
      if(row.objects_json)for(const id of JSON.parse(row.objects_json) as string[])keep.add(id);
    return keep;
  }
  /** 缺 objects 和明确的 [] 不能混为一谈：任一未知清单都让整轮回收停下。 */
  hasUnknownManifestObjects(): boolean {
    return !!this.db.prepare('SELECT 1 FROM backup_manifests_v2 WHERE objects_json IS NULL LIMIT 1').get();
  }
  /** have 的几千个 id 共用一次事务与一个预备语句；已存在与尚缺的对象都占位。 */
  claimObjects(deviceId:string,ids:readonly string[],now=Date.now()) {
    const upsert=this.db.prepare('INSERT INTO backup_object_claims(device_id,object_id,claimed_at) VALUES(?,?,?) ON CONFLICT(device_id,object_id) DO UPDATE SET claimed_at=excluded.claimed_at');
    this.db.transaction(()=>{
      this.expireObjectClaims(now);
      for(const id of ids)upsert.run(deviceId,id,now);
    })();
  }
  private expireObjectClaims(now:number) {
    this.db.prepare('DELETE FROM backup_object_claims WHERE claimed_at<=?').run(now-OBJECT_CLAIM_TTL_MS);
  }
  claimedObjects(now=Date.now()): Set<string> {
    this.expireObjectClaims(now);
    return new Set((this.db.prepare('SELECT DISTINCT object_id FROM backup_object_claims').all() as {object_id:string}[]).map(row=>row.object_id));
  }
  clearObjectClaims() { this.db.prepare('DELETE FROM backup_object_claims').run(); }
  manifestCount(): number { return (this.db.prepare('SELECT COUNT(*) n FROM backup_manifests_v2').get() as {n:number}).n; }
  deleteManifest(deviceId:string): boolean { return this.db.prepare('DELETE FROM backup_manifests_v2 WHERE device_id=?').run(deviceId).changes>0; }
  /** 成员的全部清单（含旧版迁来的）：Build 71 的 DELETE /backup 与主人按成员删除都走这里；对象留给 prune。 */
  deleteMemberManifests(memberId:string) { this.db.prepare('DELETE FROM backup_manifests_v2 WHERE member_id=?').run(memberId); }
  deleteAllManifests() { this.db.prepare('DELETE FROM backup_manifests_v2').run(); }
  recentUsage() { return this.db.prepare('SELECT member_id,day,model,status,COUNT(*) calls,SUM(photos) photos,SUM(writes) writes,SUM(tokens) tokens,error_code FROM requests WHERE created_at>? GROUP BY member_id,day,model,status,error_code ORDER BY day DESC').all(Date.now()-30*86400000); }
  close() { this.db.close(); }
}
