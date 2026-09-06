import { createAuthClient } from "better-auth/react";
import { twoFactorClient } from "better-auth/plugins";

export const authClient = createAuthClient({
  plugins: [
    // 密码登录命中两步验证时自动跳转 /login/two-factor；
    // 该页负责 TOTP 与恢复码两种验证方式。
    twoFactorClient({
      twoFactorPage: "/login/two-factor",
    }),
  ],
});
