/**
 * 产品名、孩子名兜底，以及磁盘上带着产品名的那几个标识。改名时只动这一个文件。
 * 旧标识只出现在一次性迁移与向后兼容读取里（见 rename.ts）。
 */
export const APP_NAME = "桉桉成长记";
/** 还没填「宝宝资料」时，卡片落款与扉页印章用的名字。 */
export const CHILD_FALLBACK = "桉桉";
/** 文档目录名：media / backups / libraries / intake 都在它下面。 */
export const DOCS_DIR = "anan-v1";
/** 默认本机库文件名（expo-sqlite 放在 Documents/SQLite 下）。 */
export const LIBRARY_FILE = "anan-local-v1.sqlite";
/** 从备份恢复出来的独立库的文件名前缀。 */
export const RECOVERED_PREFIX = "anan-recovered-";
/** 导出备份的文件名前缀。 */
export const BACKUP_PREFIX = "anan";
/** 上一版产品名（小美）在磁盘上留下的旧标识，只用于迁移与兼容。 */
export const LEGACY_DOCS_DIR = "xiaomei-v1";
export const LEGACY_LIBRARY_FILE = "xiaomei-local-v1.sqlite";
export const LEGACY_RECOVERED_PREFIX = "xiaomei-recovered-";
export const LEGACY_BACKUP_PREFIX = "xiaomei";
/** 设备 AI 凭证与同意标记在 SecureStore 里的键名。 */
export const AI_SESSION_KEY = "anan-ai-device-v1";
export const AI_CONSENT_KEY = "anan-ai-consent-v1";
export const LEGACY_AI_SESSION_KEY = "xiaomei-ai-device-v1";
export const LEGACY_AI_CONSENT_KEY = "xiaomei-ai-consent-v1";
