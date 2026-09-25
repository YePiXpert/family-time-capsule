import { describe, expect, it } from "vitest";
import { unlockFailureMessage } from "../src/local/lock";

describe("unlockFailureMessage", () => {
  it("关掉了锁屏密码时说明下一步，而不是让人一直重试", () => {
    for (const error of ["not_enrolled", "passcode_not_set", "not_available"])
      expect(unlockFailureMessage(error)).toContain("重新打开锁屏密码");
  });
  it("取消、验证不过、锁定照旧提示再试", () => {
    for (const error of ["user_cancel", "authentication_failed", "lockout", undefined])
      expect(unlockFailureMessage(error)).toBe("没有解锁成功，再试一次。");
  });
});
