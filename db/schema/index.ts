/**
 * 汇总导出全部 schema，供 drizzle() 实例使用。
 * 认证表（better-auth）在 auth.ts，业务表按域拆分。
 */
export * as authSchema from "./auth";
export * as familySchema from "./family";
export * as assetSchema from "./asset";
export * as aiJobSchema from "./ai-job";
export * as inboxSchema from "./inbox";
export * as memorySchema from "./memory";
export * as contributionSchema from "./contribution";
export * as capsuleSchema from "./capsule";
export * as invitationSchema from "./invitation";
export * as transcriptSchema from "./transcript";
export * as analysisSchema from "./analysis";
export * as suggestionSchema from "./suggestion";
export * as clusterSchema from "./clusters";
export * as storySchema from "./story";
export * as oralHistorySchema from "./oral-history";
export * as backupSchema from "./backup";
export * as importSchema from "./import";
export * as reviewSchema from "./review";

export * as collectionSchema from "./collection";

export * from "./media-job";

export * from "./book";
