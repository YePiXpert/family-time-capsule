/** 本机存储写满：Node/安卓 ENOSPC（No space left on device）、SQLite、iOS「isn’t enough space」。 */
export const isOutOfSpace = (e: unknown) =>
  (!!e && typeof e === "object" && (e as { code?: unknown }).code === "ENOSPC") ||
  /ENOSPC|SQLITE_FULL|disk.*full|no space left|(not|n[’']t) enough space/i.test(
    e instanceof Error ? e.message : String(e),
  );
export const messageOf = (e: unknown) => {
  if (!(e instanceof Error)) return "操作未完成，请重试。";
  if (isOutOfSpace(e))
    return "本机空间不足，请释放一些空间后重试。当前输入仍保留。";
  if (/JSON|parse|malformed|corrupt/i.test(e.message))
    return "本机资料暂时无法完整读取，原有文件已保留。请重试，或选择完整备份恢复。";
  if (/[一-鿿]/.test(e.message)) return e.message;
  return "操作未完成，现有资料和输入已保留，请重试。";
};
