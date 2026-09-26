import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Member, Store } from '../store.ts';
import type { BackupStore } from '../backup-store.ts';

declare module 'fastify' { interface FastifyContextConfig { anonymous?: boolean } }
/** 路由共用的依赖。auth/admin 从 Authorization 头取令牌；throttle 按连接地址加全局两级限流。 */
export type Ctx = {
 app: FastifyInstance;
 store: Store;
 backupStore: BackupStore;
 auth: (header?: string) => Member;
 admin: (header?: string) => Member;
 throttle: (req: Pick<FastifyRequest, 'ip'>, scope: string, perIp: number, globalLimit: number) => void;
 /** 配对申请按哪个来源地址分名额；undefined = 分不出来（没设 TRUST_PROXY 时经反代进来），只算全服务上限。 */
 pairSource: (req: Pick<FastifyRequest, 'ip'>) => string | undefined;
};
/** 不带令牌也能访问的路由；其余路由在 onRequest 里先验令牌，再读请求体。 */
export const open = { config: { anonymous: true } } as const;
export const name = z.string().trim().min(1).max(20);
export const iso = (ms: number) => new Date(ms).toISOString();
