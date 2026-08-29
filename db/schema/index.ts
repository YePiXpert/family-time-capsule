/**
 * 汇总导出全部 schema，供 drizzle() 实例使用。
 * 认证表（better-auth）在 auth.ts，业务表按域拆分。
 */
export * as authSchema from "./auth";
export * as familySchema from "./family";
export * as assetSchema from "./asset";
export * as inboxSchema from "./inbox";
