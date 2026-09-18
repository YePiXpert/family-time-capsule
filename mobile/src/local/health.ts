/** 本机健康统计：纯计数与摘要，只留在设备上，不上报。 */

export type HealthStats = {
  version: 1;
  launches: number;
  lastLaunchMs: number;
  lastLaunchAt: string;
  changeCount: number;
  changeTotalMs: number;
  changeMaxMs: number;
  diskFailures: number;
  lastDiskError: string | null;
  lastDiskErrorAt: string | null;
};

export const emptyHealth = (): HealthStats => ({
  version: 1,
  launches: 0,
  lastLaunchMs: 0,
  lastLaunchAt: "",
  changeCount: 0,
  changeTotalMs: 0,
  changeMaxMs: 0,
  diskFailures: 0,
  lastDiskError: null,
  lastDiskErrorAt: null,
});

/** 老文件或字段缺失时补齐默认值，坏文件从零开始。 */
export function normalizeHealth(value: unknown): HealthStats {
  const base = emptyHealth();
  if (!value || typeof value !== "object") return base;
  const v = value as Partial<HealthStats>;
  const num = (n: unknown) => (typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : 0);
  return {
    version: 1,
    launches: num(v.launches),
    lastLaunchMs: num(v.lastLaunchMs),
    lastLaunchAt: typeof v.lastLaunchAt === "string" ? v.lastLaunchAt : "",
    changeCount: num(v.changeCount),
    changeTotalMs: num(v.changeTotalMs),
    changeMaxMs: num(v.changeMaxMs),
    diskFailures: num(v.diskFailures),
    lastDiskError:
      typeof v.lastDiskError === "string" ? v.lastDiskError.slice(0, 200) : null,
    lastDiskErrorAt:
      typeof v.lastDiskErrorAt === "string" ? v.lastDiskErrorAt : null,
  };
}

export function recordLaunch(
  h: HealthStats,
  ms: number,
  at: string,
): HealthStats {
  return {
    ...h,
    launches: h.launches + 1,
    lastLaunchMs: Math.max(0, Math.round(ms)),
    lastLaunchAt: at,
  };
}

/** 只统计写成功的 change；失败交给 recordDiskFailure。 */
export function recordChange(h: HealthStats, ms: number): HealthStats {
  const rounded = Math.max(0, Math.round(ms));
  return {
    ...h,
    changeCount: h.changeCount + 1,
    changeTotalMs: h.changeTotalMs + rounded,
    changeMaxMs: Math.max(h.changeMaxMs, rounded),
  };
}

export function changeAvgMs(h: HealthStats): number {
  return h.changeCount ? h.changeTotalMs / h.changeCount : 0;
}

export function recordDiskFailure(
  h: HealthStats,
  message: string,
  at: string,
): HealthStats {
  return {
    ...h,
    diskFailures: h.diskFailures + 1,
    lastDiskError: message.slice(0, 200),
    lastDiskErrorAt: at,
  };
}
