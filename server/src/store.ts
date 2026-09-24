import Database from 'better-sqlite3';
import { MODEL_ID } from './ai-model.ts';
import { createHash, randomBytes, randomUUID } from 'node:crypto';

/** 成员默认远端备份配额 20 GiB；主人可在管理页调整。 */
export const DEFAULT_BACKUP_LIMIT = 20 * 1024 ** 3;
/** 每设备的持久占位上限；重复对象只续期，不新增行。 */
export const CLAIMS_PER_DEVICE = 100_000;
/** 尚未发布清单的上传占位：重启仍有效，48 小时未续期才释放。 */
export const OBJECT_CLAIM_TTL_MS = 48 * 60 * 60 * 1000;
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
/** 配对申请挂 10 分钟；批准后新手机 24 小时内不确认，这台设备作废。 */
export const PAIR_TTL_MS = 10 * 60 * 1000;
export const PAIR_CONFIRM_MS = 24 * 60 * 60 * 1000;
/** 同时挂着的配对申请上限：不需要登录的接口，不能让人灌满。 */
export const PAIR_PENDING_LIMIT = 20;
/** 一台手机一年没用过，要管理者重新批准（主人 2026-09-24 拍板）。 */
export const DEVICE_IDLE_MS = 365 * 24 * 60 * 60 * 1000;
const TOUCH_MS = 60 * 60 * 1000;
/** 部署端的一次性激活码：24 小时内、空服务上用一次。25 位 Crockford base32（125 位随机）。 */
export const ACTIVATION_TTL_MS = 24 * 60 * 60 * 1000;
const BASE32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const normalizeActivationCode = (code: string) => code.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
export class Problem extends Error {
  status: number; code: string;
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; }
}
export type Role = 'admin'|'member';
export type Member = { id: string; name: string; role: Role; enabled: number; photo_limit: number; write_limit: number; backup_limit_bytes: number; deviceId?: string };
/** 家庭（一台服务一家人）：当前内容钥匙的指纹与用恢复秘密封的钥匙包；服务端没有钥匙本身。 */
export type Family = { familyId: string; keyId: string; recoveryEnvelope: string; recoveryVerifier: string; recoveryVersion: number; createdAt: number };
export type FamilyInput = { familyId: string; keyId: string; recovery: { envelope: string; verifier: string } };
/** 管理者封钥匙包与新手机解包时绑定的全部字段；两边必须逐字相同。 */
export type PairBinding = { familyId: string; requestId: string; memberId: string; role: Role; deviceId: string; deviceName: string; approverDeviceId: string; keyId: string; expiresAt: string };
type PairRow = { id: string; device_id: string; public_key: string; device_name: string; claim_hash: string; status: 'pending'|'approved'|'confirmed'|'cancelled'|'expired'; created_at: number; expires_at: number; member_id: string|null; approved_by: string|null; enc: string|null; ct: string|null; binding_json: string|null };
const MEMBER_COLUMNS = 'id,name,role,enabled,photo_limit,write_limit,backup_limit_bytes';
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
      CREATE TABLE IF NOT EXISTS family(id INTEGER PRIMARY KEY CHECK(id=1),family_id TEXT NOT NULL,key_id TEXT NOT NULL,recovery_envelope TEXT NOT NULL,recovery_verifier TEXT NOT NULL,recovery_version INTEGER NOT NULL,created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS pair_requests(id TEXT PRIMARY KEY,device_id TEXT NOT NULL UNIQUE,public_key TEXT NOT NULL,device_name TEXT NOT NULL,claim_hash TEXT NOT NULL,status TEXT NOT NULL,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,member_id TEXT,approved_by TEXT,enc TEXT,ct TEXT,binding_json TEXT);
      CREATE TABLE IF NOT EXISTS activation_codes(code_hash TEXT PRIMARY KEY,expires_at INTEGER NOT NULL,used_at INTEGER);
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
    // 1.1.0「家庭与设备」：主人改叫管理者（可以有几位）；设备登记公钥、最后使用时间、谁批准的、待确认期限。
    // 用户名与密码列留着不删，只是不再读写。已有设备的最后使用时间记为迁移这一刻，不会因为从没记过而一上来就过期。
    this.db.prepare("UPDATE members SET role='admin' WHERE role='owner'").run();
    const deviceColumns=(this.db.prepare('PRAGMA table_info(devices)').all() as {name:string}[]).map(column=>column.name);
    if(!deviceColumns.includes('public_key'))this.db.exec('ALTER TABLE devices ADD COLUMN public_key TEXT;ALTER TABLE devices ADD COLUMN approved_by TEXT;ALTER TABLE devices ADD COLUMN pending_until INTEGER;');
    if(!deviceColumns.includes('last_used_at')){this.db.exec('ALTER TABLE devices ADD COLUMN last_used_at INTEGER');this.db.prepare('UPDATE devices SET last_used_at=?').run(Date.now());}
    this.db.prepare('INSERT OR IGNORE INTO settings VALUES(1,?)').run(JSON.stringify(initialSettings));
    this.setSettings(this.settings());
  }
  recover() { this.db.prepare("UPDATE requests SET status='failed',error_code='SERVER_RESTARTED' WHERE status='processing'").run(); }
  settings(): Settings { return { ...JSON.parse((this.db.prepare('SELECT value FROM settings WHERE id=1').get() as { value: string }).value), defaultModel: MODEL_ID, enabledModels: [MODEL_ID] }; }
  setSettings(value: Settings) { this.db.prepare('UPDATE settings SET value=? WHERE id=1').run(JSON.stringify({ ...value, defaultModel: MODEL_ID, enabledModels: [MODEL_ID] })); }
  initialized() { return !!this.db.prepare('SELECT 1 FROM members LIMIT 1').get(); }
  family(): Family|undefined {
    const row=this.db.prepare('SELECT family_id,key_id,recovery_envelope,recovery_verifier,recovery_version,created_at FROM family WHERE id=1').get() as {family_id:string;key_id:string;recovery_envelope:string;recovery_verifier:string;recovery_version:number;created_at:number}|undefined;
    return row&&{familyId:row.family_id,keyId:row.key_id,recoveryEnvelope:row.recovery_envelope,recoveryVerifier:row.recovery_verifier,recoveryVersion:row.recovery_version,createdAt:row.created_at};
  }
  private insertFamily(input: FamilyInput) {
    this.db.prepare('INSERT INTO family(id,family_id,key_id,recovery_envelope,recovery_verifier,recovery_version,created_at) VALUES(1,?,?,?,?,1,?)').run(input.familyId,input.keyId,input.recovery.envelope,input.recovery.verifier,Date.now());
  }
  /** 部署端生成激活码：只在空服务上，同时只有最新一枚有效。返回明文，库里只存哈希。 */
  issueActivationCode(now=Date.now()) {
    if(this.initialized()) throw new Problem(409,'SETUP_DONE','这台服务已经有家庭了，不需要激活码。');
    const bytes=randomBytes(25),code=[...bytes].map(b=>BASE32[b&31]).join('');
    this.db.transaction(()=>{
      this.db.prepare('DELETE FROM activation_codes').run();
      this.db.prepare('INSERT INTO activation_codes(code_hash,expires_at) VALUES(?,?)').run(digest(code),now+ACTIVATION_TTL_MS);
    })();
    return code.match(/.{5}/g)!.join('-');
  }
  /** 空服务开一个家庭：激活码、第一位管理者、这台手机与家庭行在同一个事务里。 */
  activate(code: string, input: FamilyInput & { memberId: string; memberName: string; deviceName: string; publicKey: string }, now=Date.now()) {
    return this.db.transaction(() => {
      if(this.initialized()) throw new Problem(409,'SETUP_DONE','这台服务已经有家庭了，请让管理者扫码加你。');
      const row=this.db.prepare('SELECT expires_at,used_at FROM activation_codes WHERE code_hash=?').get(digest(normalizeActivationCode(code))) as {expires_at:number;used_at:number|null}|undefined;
      if(!row||row.used_at!==null||row.expires_at<now) throw new Problem(403,'ACTIVATION_INVALID','激活码不对或已过期，请让部署的人重新生成。');
      this.db.prepare('UPDATE activation_codes SET used_at=?').run(now);
      this.insertMember(input.memberId,input.memberName,'admin');
      this.insertFamily(input);
      return this.attach(input.memberId,input.deviceName,input.publicKey);
    })();
  }
  /** 1.0.8 的主人手机升级成家庭管理者：没有家庭行时凭现有管理者令牌建家庭，只发生一次。 */
  upgrade(member: Member, input: FamilyInput & { publicKey: string }) {
    this.db.transaction(() => {
      if(this.family()) throw new Problem(409,'FAMILY_EXISTS','这个家庭已经建好了。');
      if(member.role!=='admin') throw new Problem(403,'ADMIN_ONLY','此操作仅限管理者。');
      this.insertFamily(input);
      this.db.prepare('UPDATE devices SET public_key=? WHERE id=?').run(input.publicKey,member.deviceId);
    })();
    return this.family()!;
  }
  /** 管理者重新生成恢复码：版本只能加一，钥匙指纹必须是这个家庭的；旧恢复码随之失效。 */
  setRecovery(input: { envelope: string; verifier: string; version: number; keyId: string }) {
    this.db.transaction(() => {
      const family=this.family();
      if(!family) throw new Problem(404,'FAMILY_MISSING','这台服务还没有家庭。');
      if(input.keyId!==family.keyId) throw new Problem(409,'KEY_MISMATCH','这台手机的钥匙和家庭对不上。');
      if(input.version!==family.recoveryVersion+1) throw new Problem(409,'RECOVERY_CHANGED','恢复码刚被别的管理者换过，请刷新后再试。');
      this.db.prepare('UPDATE family SET recovery_envelope=?,recovery_verifier=?,recovery_version=? WHERE id=1').run(input.envelope,input.verifier,input.version);
    })();
  }
  /** 恢复证明只核对哈希；对不上一律同一句话。 */
  checkRecovery(proof: string) {
    const family=this.family();
    if(!family||digest(proof)!==family.recoveryVerifier) throw new Problem(403,'RECOVERY_INVALID','恢复码打不开这个家庭，请逐个词核对。');
    return family;
  }
  /** 所有管理者手机都没了：凭恢复证明给选定的管理者登记一台新手机，挂着的配对一律作废。 */
  recoverAdmin(proof: string, input: { memberId: string; deviceName: string; publicKey: string }, now=Date.now()) {
    return this.db.transaction(() => {
      const family=this.checkRecovery(proof);
      const member=this.db.prepare(`SELECT ${MEMBER_COLUMNS} FROM members WHERE id=?`).get(input.memberId) as Member|undefined;
      if(!member||member.role!=='admin') throw new Problem(400,'MEMBER_INVALID','只能以管理者身份找回。');
      this.db.prepare('UPDATE members SET enabled=1 WHERE id=?').run(member.id);
      this.cancelOpenPairs(now);
      return {...this.attach(member.id,input.deviceName,input.publicKey),family};
    })();
  }
  hasMember(id: string) { return !!this.db.prepare('SELECT 1 FROM members WHERE id=?').get(id); }
  admins() { return this.db.prepare(`SELECT ${MEMBER_COLUMNS} FROM members WHERE role='admin' AND enabled=1 ORDER BY rowid`).all() as Member[]; }
  /** 部署端最后一招：把一位家人升为管理者（他的手机本来就有钥匙），替代以前的改密码命令。 */
  promote(name: string) {
    const member=this.findExactByName(name);
    this.db.prepare("UPDATE members SET role='admin',enabled=1 WHERE id=?").run(member.id);
    return this.memberById(member.id);
  }
  findExactByName(name: string) {
    const rows=this.db.prepare(`SELECT ${MEMBER_COLUMNS} FROM members WHERE name=?`).all(name) as Member[];
    if(rows.length!==1) throw new Problem(400,'MEMBER_INVALID',`成员「${name}」不存在或重名，请先确认名字。`);
    return rows[0]!;
  }
  insertMember(id: string, name: string, role: Role) {
    if(this.db.prepare('SELECT 1 FROM members WHERE name=?').get(name)) throw new Problem(409,'NAME_TAKEN',`家里已经有「${name}」了；换手机请选「给已有家人加一台手机」。`);
    this.db.prepare('INSERT INTO members(id,name,role) VALUES(?,?,?)').run(id,name,role);
  }
  /** 给成员登记一台设备并发令牌；返回的成员带 deviceId。 */
  attach(memberId: string, deviceName: string, publicKey: string|null = null) {
    const token=randomBytes(32).toString('base64url'),deviceId=randomUUID();
    this.db.prepare('INSERT INTO devices(id,member_id,name,token_hash,revoked,created_at,public_key,last_used_at) VALUES(?,?,?,?,0,?,?,?)').run(deviceId,memberId,deviceName,digest(token),Date.now(),publicKey,Date.now());
    return { token, member: this.memberById(memberId,deviceId) };
  }
  private expirePairs(now: number) {
    this.db.prepare("UPDATE pair_requests SET status='expired',enc=NULL,ct=NULL WHERE status='pending' AND expires_at<?").run(now);
    // 批准了却一直没确认的：设备作废，申请也收掉。
    const stale=this.db.prepare("SELECT p.id,p.device_id FROM pair_requests p JOIN devices d ON d.id=p.device_id WHERE p.status='approved' AND d.pending_until<?").all(now) as {id:string;device_id:string}[];
    for(const row of stale){this.db.prepare('UPDATE devices SET revoked=1 WHERE id=?').run(row.device_id);this.db.prepare("UPDATE pair_requests SET status='expired',enc=NULL,ct=NULL WHERE id=?").run(row.id);}
  }
  private cancelOpenPairs(now: number) {
    this.expirePairs(now);
    this.db.prepare("UPDATE devices SET revoked=1 WHERE id IN (SELECT device_id FROM pair_requests WHERE status='approved')").run();
    this.db.prepare("UPDATE pair_requests SET status='cancelled',enc=NULL,ct=NULL WHERE status IN ('pending','approved')").run();
  }
  /** 新手机登记配对申请：只有公钥、手机名与领取凭据的哈希；不带任何权限。 */
  createPair(input: { publicKey: string; deviceName: string; claimHash: string }, now=Date.now()) {
    return this.db.transaction(() => {
      this.expirePairs(now);
      if(!this.family()) throw new Problem(409,'FAMILY_MISSING','这台服务还没有家庭，请先让管理者开一个家庭。');
      const pending=(this.db.prepare("SELECT COUNT(*) n FROM pair_requests WHERE status='pending'").get() as {n:number}).n;
      if(pending>=PAIR_PENDING_LIMIT) throw new Problem(429,'RATE_LIMIT','申请太多了，请稍后再试。');
      const id=randomUUID(),expiresAt=now+PAIR_TTL_MS;
      this.db.prepare("INSERT INTO pair_requests(id,device_id,public_key,device_name,claim_hash,status,created_at,expires_at) VALUES(?,?,?,?,?,'pending',?,?)").run(id,randomUUID(),input.publicKey,input.deviceName,input.claimHash,now,expiresAt);
      return {requestId:id,expiresAt:new Date(expiresAt).toISOString()};
    })();
  }
  private pairRow(id: string) { return this.db.prepare('SELECT * FROM pair_requests WHERE id=?').get(id) as PairRow|undefined; }
  /** 管理者扫码后看这条申请：封钥匙包要用的字段全在这里。 */
  pairForApprover(id: string, now=Date.now()) {
    this.expirePairs(now);
    const row=this.pairRow(id),family=this.family();
    if(!row||!family) throw new Problem(404,'NOT_FOUND','没有这条申请，请让对方重新打开二维码。');
    return {requestId:row.id,deviceId:row.device_id,deviceName:row.device_name,publicKey:row.public_key,status:row.status,expiresAt:new Date(row.expires_at).toISOString(),familyId:family.familyId,keyId:family.keyId};
  }
  /**
   * 管理者批准：（新增家人时）建成员、登记设备（公钥只取自申请）、存钥匙包，一个事务。
   * 设备先有一枚没人知道的占位令牌，真令牌等新手机凭领取凭据来拿时才生成——服务端从不存令牌明文。
   */
  approvePair(approver: Member, id: string, input: { member: { id: string; name?: string; role?: Role }; enc: string; ct: string }, now=Date.now()) {
    return this.db.transaction(() => {
      this.expirePairs(now);
      const row=this.pairRow(id),family=this.family();
      if(!row||!family) throw new Problem(404,'NOT_FOUND','没有这条申请，请让对方重新打开二维码。');
      if(row.status!=='pending') throw new Problem(409,'PAIR_CLOSED',row.status==='expired'?'这个二维码过期了，请让对方重新打开。':'这条申请已经处理过了。');
      let member=this.db.prepare(`SELECT ${MEMBER_COLUMNS} FROM members WHERE id=?`).get(input.member.id) as Member|undefined;
      if(member){
        if(!member.enabled) throw new Problem(409,'MEMBER_DISABLED','这位家人已停用，请先启用。');
      } else {
        const name=input.member.name?.trim();
        if(!name||!input.member.role) throw new Problem(400,'INVALID_INPUT','新增家人要填称呼。');
        this.insertMember(input.member.id,name,input.member.role);
        member=this.memberById(input.member.id);
      }
      const binding: PairBinding={familyId:family.familyId,requestId:row.id,memberId:member.id,role:member.role,deviceId:row.device_id,deviceName:row.device_name,approverDeviceId:approver.deviceId!,keyId:family.keyId,expiresAt:new Date(row.expires_at).toISOString()};
      this.db.prepare('INSERT INTO devices(id,member_id,name,token_hash,revoked,created_at,public_key,approved_by,pending_until,last_used_at) VALUES(?,?,?,?,0,?,?,?,?,?)').run(row.device_id,member.id,row.device_name,digest(randomBytes(32).toString('base64url')),now,row.public_key,approver.deviceId,now+PAIR_CONFIRM_MS,now);
      this.db.prepare("UPDATE pair_requests SET status='approved',member_id=?,approved_by=?,enc=?,ct=?,binding_json=? WHERE id=?").run(member.id,approver.deviceId,input.enc,input.ct,JSON.stringify(binding),row.id);
      return binding;
    })();
  }
  /**
   * 新手机凭领取凭据来拿：还没批准就说等着；批准了就发一枚新令牌（每次领取都换一枚，只认最后一枚），
   * 连同钥匙包与绑定字段。确认之后、过期、取消都拿不到。
   */
  collectPair(id: string, claim: string, now=Date.now()) {
    return this.db.transaction(() => {
      this.expirePairs(now);
      const row=this.pairRow(id);
      if(!row||digest(claim)!==row.claim_hash) throw new Problem(404,'NOT_FOUND','没有这条申请。');
      if(row.status==='pending') return {status:'pending' as const};
      if(row.status!=='approved') throw new Problem(410,'PAIR_CLOSED',row.status==='confirmed'?'这台手机已经加入了。':row.status==='cancelled'?'管理者取消了这次加入。':'这次加入过期了，请重新打开二维码。');
      const token=randomBytes(32).toString('base64url');
      this.db.prepare('UPDATE devices SET token_hash=? WHERE id=?').run(digest(token),row.device_id);
      const binding=JSON.parse(row.binding_json!) as PairBinding;
      return {status:'approved' as const,token,binding,enc:row.enc!,ct:row.ct!,member:this.memberById(binding.memberId,row.device_id)};
    })();
  }
  /** 新手机把令牌和钥匙都存好了：确认后清掉钥匙包，设备转正。 */
  confirmPair(device: Member, id: string) {
    this.db.transaction(() => {
      const row=this.pairRow(id);
      if(!row||row.device_id!==device.deviceId) throw new Problem(404,'NOT_FOUND','没有这条申请。');
      if(row.status==='confirmed') return;
      if(row.status!=='approved') throw new Problem(410,'PAIR_CLOSED','这次加入已经结束了。');
      this.db.prepare("UPDATE pair_requests SET status='confirmed',enc=NULL,ct=NULL WHERE id=?").run(id);
      this.db.prepare('UPDATE devices SET pending_until=NULL WHERE id=?').run(row.device_id);
    })();
  }
  /** 取消：管理者或新手机自己（凭领取凭据）；已批准未确认的设备一并作废。 */
  cancelPair(id: string, claim?: string) {
    this.db.transaction(() => {
      const row=this.pairRow(id);
      if(!row||(claim!==undefined&&digest(claim)!==row.claim_hash)) throw new Problem(404,'NOT_FOUND','没有这条申请。');
      if(row.status==='approved')this.db.prepare('UPDATE devices SET revoked=1 WHERE id=?').run(row.device_id);
      if(row.status==='pending'||row.status==='approved')this.db.prepare("UPDATE pair_requests SET status='cancelled',enc=NULL,ct=NULL WHERE id=?").run(id);
    })();
  }
  memberById(id: string, deviceId?: string) {
    const member=this.db.prepare(`SELECT ${MEMBER_COLUMNS} FROM members WHERE id=?`).get(id) as Member;
    return deviceId?{...member,deviceId}:member;
  }
  /** 令牌 → 成员与设备：设备没撤销、成员启用、待确认没过期、一年内用过；最后使用时间至多每小时记一次。 */
  auth(token: string, now=Date.now()): Member {
    const row = this.db.prepare('SELECT m.id,m.name,m.role,m.enabled,m.photo_limit,m.write_limit,m.backup_limit_bytes,d.id AS deviceId,d.last_used_at,d.created_at,d.pending_until FROM devices d JOIN members m ON m.id=d.member_id WHERE d.token_hash=? AND d.revoked=0 AND m.enabled=1').get(digest(token)) as (Member&{last_used_at:number|null;created_at:number;pending_until:number|null})|undefined;
    if (!row||(row.pending_until!==null&&row.pending_until<now)||(row.last_used_at??row.created_at)<now-DEVICE_IDLE_MS) throw new Problem(401,'AUTH_REQUIRED','这台手机还没获准，或已被停用；请让管理者扫码加入。');
    if ((row.last_used_at??0)<now-TOUCH_MS) this.db.prepare('UPDATE devices SET last_used_at=? WHERE id=?').run(now,row.deviceId);
    const { last_used_at: _used, created_at: _created, pending_until: _pending, ...member } = row;
    return member;
  }
  usage(memberId?: string) {
    // Failed requests (upstream garbage, timeout) are not the member's fault and must not burn the day's quota.
    return this.db.prepare(`SELECT COALESCE(SUM(photos),0) photos,COALESCE(SUM(writes),0) writes,COUNT(*) calls,COALESCE(SUM(tokens),0) tokens FROM requests WHERE day=? AND status!='failed' ${memberId?'AND member_id=?':''}`).get(...[new Date().toISOString().slice(0,10),...(memberId?[memberId]:[])]) as { photos:number; writes:number; calls:number; tokens:number };
  }
  reserve(member: Member,id: string,fingerprint: string,photos:number,writes:number,model:string,kind:'text'|'transcribe'='text') {
    return this.db.transaction(() => {
      const prev = this.db.prepare('SELECT fingerprint,status FROM requests WHERE member_id=? AND id=?').get(member.id,id) as {fingerprint:string;status:string}|undefined;
      if (prev) {
        if (prev.fingerprint!==fingerprint) throw new Problem(409,'REQUEST_CHANGED','同一请求不能更改内容，请重新发起。');
        return prev.status;
      }
      const settings=this.settings(), mine=this.usage(member.id), all=this.usage();
      if (settings.paused) throw new Problem(503,'AI_PAUSED','管理者已暂停 AI，仍可手动编辑。');
      // 转写模型由服务端装配固定，不受手机端的文本模型白名单约束。
      if (kind==='text'&&!settings.enabledModels.includes(model)) throw new Problem(400,'MODEL_DISABLED','AI 服务配置已更新，请重新生成。');
      if (mine.photos+photos>member.photo_limit || mine.writes+writes>member.write_limit || mine.calls>=200 || all.photos+photos>settings.globalPhotos || all.writes+writes>settings.globalWrites || all.calls>=1000)
        throw new Problem(429,'QUOTA_EXCEEDED','今日 AI 额度已用完，请联系管理者或明天再试。');
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
  members() { return this.db.prepare(`SELECT ${MEMBER_COLUMNS} FROM members ORDER BY role='admin' DESC,name`).all() as Member[]; }
  /** 设备清单：待确认的标出来；从不带令牌哈希与公钥以外的凭据。 */
  devices(now=Date.now()) {
    this.expirePairs(now);
    return this.db.prepare('SELECT id,member_id,name,revoked,created_at,last_used_at,approved_by,pending_until IS NOT NULL AS pending FROM devices ORDER BY created_at DESC').all();
  }
  /** 还能用的管理者设备（启用的管理者名下、没撤销、不在待确认）：少于一台家庭就没人能批准新手机了。 */
  private activeAdminDevices(): string[] {
    return (this.db.prepare("SELECT d.id FROM devices d JOIN members m ON m.id=d.member_id WHERE m.role='admin' AND m.enabled=1 AND d.revoked=0 AND d.pending_until IS NULL").all() as {id:string}[]).map(row=>row.id);
  }
  revoke(id:string) {
    this.db.transaction(()=>{
      const active=this.activeAdminDevices();
      if(active.length===1&&active[0]===id) throw new Problem(400,'LAST_ADMIN_DEVICE','这是最后一台管理者手机，停用后就没人能批准新手机了。');
      this.db.prepare('UPDATE devices SET revoked=1 WHERE id=?').run(id);
    })();
  }
  /** 启停与额度；不能停用最后一位启用的管理者。 */
  editMember(id:string,patch:{enabled:boolean;photoLimit:number;writeLimit:number;backupLimitBytes?:number}) {
    this.db.transaction(()=>{
      const member=this.db.prepare(`SELECT ${MEMBER_COLUMNS} FROM members WHERE id=?`).get(id) as Member|undefined;
      if(!member) throw new Problem(404,'NOT_FOUND','成员不存在。');
      if(member.role==='admin'&&member.enabled&&!patch.enabled&&this.admins().length<=1) throw new Problem(400,'ADMIN_REQUIRED','至少要留一位管理者。');
      this.db.prepare('UPDATE members SET enabled=?,photo_limit=?,write_limit=?,backup_limit_bytes=COALESCE(?,backup_limit_bytes) WHERE id=?').run(patch.enabled?1:0,patch.photoLimit,patch.writeLimit,patch.backupLimitBytes??null,id);
    })();
  }
  /** 改称呼与角色；不能把最后一位启用的管理者降成家人。改称呼不动任何旧落款（落款是内容）。 */
  setProfile(id:string,patch:{name:string;role:Role}) {
    this.db.transaction(()=>{
      const member=this.db.prepare(`SELECT ${MEMBER_COLUMNS} FROM members WHERE id=?`).get(id) as Member|undefined;
      if(!member) throw new Problem(404,'NOT_FOUND','成员不存在。');
      if(member.role==='admin'&&patch.role!=='admin'&&member.enabled&&this.admins().length<=1) throw new Problem(400,'ADMIN_REQUIRED','至少要留一位管理者。');
      if(patch.name!==member.name&&this.db.prepare('SELECT 1 FROM members WHERE name=? AND id!=?').get(patch.name,id)) throw new Problem(409,'NAME_TAKEN',`家里已经有「${patch.name}」了。`);
      this.db.prepare('UPDATE members SET name=?,role=? WHERE id=?').run(patch.name,patch.role,id);
    })();
  }
  /** 家庭配额：第一位管理者的 backup_limit_bytes 就是全家的上限（一台服务一家人）。 */
  familyLimitBytes(): number {
    const row=this.db.prepare("SELECT backup_limit_bytes FROM members WHERE role='admin' ORDER BY rowid LIMIT 1").get() as {backup_limit_bytes:number}|undefined;
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
  /**
   * 全家合并只取未撤销设备的清单；没有设备行的旧版备份仍参与合并。
   * 请求者自己名下被撤销的设备照给：丢了手机、换机后改密或被主人撤销旧机，新手机仍要能把旧机那份合回来——
   * 手机端换机恢复只走这个列表。
   */
  activeManifests(memberId?:string): BackupManifest[] { return this.manifestRows('WHERE d.revoked IS NULL OR d.revoked=0 OR m.member_id=?',memberId??null); }
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
      const count=(this.db.prepare('SELECT COUNT(*) n FROM backup_object_claims WHERE device_id=?').get(deviceId) as {n:number}).n;
      const exists=this.db.prepare('SELECT 1 FROM backup_object_claims WHERE device_id=? AND object_id=?');
      const unique=[...new Set(ids)],added=unique.filter(id=>!exists.get(deviceId,id)).length;
      if(count+added>CLAIMS_PER_DEVICE)throw new Problem(413,'QUOTA_FULL','远端对象数量已到上限，请联系管理者。');
      for(const id of unique)upsert.run(deviceId,id,now);
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
