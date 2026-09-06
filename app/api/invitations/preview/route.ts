import { inspectInvitationToken } from "@/lib/invitations/service";

/**
 * GET /api/invitations/preview?token=… —— 受邀人确认邀请（1.3 App 注册）。
 * 公开但 scoped 到单个高熵邀请 token：只返回邀请允许披露的有限信息
 * （状态、家庭名、角色、可选邮箱约束、绑定人物称呼、有效期）。
 * 只读，不消耗 token；不能借 token 枚举家庭或成员。
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";
  const preview = await inspectInvitationToken(token);
  return Response.json(preview, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
