import { getSetupState } from "@/lib/auth/setup";
import { getInstanceId } from "@/lib/instance/service";

/**
 * GET /api/bootstrap —— App 首次连接时的实例识别（1.3）。
 * 公开端点但零隐私泄露：只返回产品标识、API 版本、初始化状态与稳定随机
 * instanceId。不返回家人、邮箱、人数、令牌或内部路径。
 * instanceId 只用于“连的是哪个实例”，不是凭据，不参与授权。
 */
export async function GET() {
  let setupState;
  try {
    setupState = await getSetupState();
  } catch {
    return Response.json(
      { error: "unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  let instanceId: string;
  try {
    instanceId = await getInstanceId();
  } catch {
    return Response.json(
      { error: "unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  const state = setupState.hasUsers
    ? "completed"
    : setupState.tokenConfigured
      ? "available"
      : "unconfigured";
  return Response.json(
    {
      product: "family-time-capsule",
      apiVersion: 1,
      instanceId,
      setup: { state },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
