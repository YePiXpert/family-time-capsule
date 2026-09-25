import type { FastifyInstance } from 'fastify';
import type { Store } from './store.ts';
/**
 * docker stop 先发 SIGTERM，10 秒后 SIGKILL。正在处理的请求有 graceMs 答完（app.ts 会让它们答完就断开 keep-alive）；
 * 到点还没答完的（多半在等 AI 上游）直接断开，数据库照常关好再退出。
 */
export function shutdown(app: FastifyInstance, store: Store, graceMs = 8000): Promise<void> {
  const deadline = setTimeout(() => app.server.closeAllConnections(), graceMs);
  deadline.unref();
  return app.close().finally(() => { clearTimeout(deadline); store.close(); });
}
