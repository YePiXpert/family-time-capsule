/**
 * 全量重建全文搜索索引（M4）。
 *
 * 用法：npm run search:rebuild
 * 索引是纯 derivative：删除后从关系表全量重建，主数据不受影响。
 */
import { closeDatabase } from "../db";
import { rebuildSearchIndex } from "../lib/search/service";

const counts = rebuildSearchIndex();
console.log(
  `搜索索引重建完成：事件 ${counts.events}、确认事实 ${counts.facts}、讲述 ${counts.contributions}、已修订转录 ${counts.transcripts}。`,
);
closeDatabase();
