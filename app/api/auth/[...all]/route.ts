import { getAuth } from "@/lib/auth/auth";
import {
  getUserBinding,
  InvalidUserBindingError,
} from "@/lib/family/service";

async function handleAuthRequest(request: Request) {
  const pathname = new URL(request.url).pathname;
  // A disabled principal must still be able to clear a stale cookie.
  const isSessionRecoveryRequest =
    pathname.endsWith("/sign-out") || pathname.includes("/sign-in/");
  if (!isSessionRecoveryRequest) {
    const current = await getAuth().api.getSession({ headers: request.headers });
    if (current) {
      try {
        await getUserBinding(current.user.id);
      } catch (error) {
        if (error instanceof InvalidUserBindingError) {
          return Response.json({ error: "forbidden" }, { status: 403 });
        }
        throw error;
      }
    }
  }
  return getAuth().handler(request);
}

export async function GET(request: Request) {
  return handleAuthRequest(request);
}

export async function POST(request: Request) {
  return handleAuthRequest(request);
}
