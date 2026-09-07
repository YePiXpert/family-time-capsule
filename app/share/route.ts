import { getApiFamilyContext } from "@/lib/family/context";
import { hasFamilyCapability } from "@/lib/authz/policy";
import { receiveWebShare } from "@/lib/imports/share";
import { uploadError } from "@/lib/imports/http";
import { MAX_VIDEO_BYTES } from "@/lib/assets/validation";
import { isSameOrigin, requestBodySizeError } from "@/lib/security/origin";

/** PWA shares preserve a batch before asking how to organize it. */
export async function GET(request: Request) {
  return Response.redirect(new URL("/imports", request.url), 303);
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const context = await getApiFamilyContext(request.headers);
  if (!context) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!hasFamilyCapability(context.role, "capture:create")) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const sizeError = requestBodySizeError(request, MAX_VIDEO_BYTES);
  if (sizeError) {
    return Response.json(
      { error: sizeError },
      { status: sizeError === "too_large" ? 413 : 411 },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "invalid_form" }, { status: 400 });
  }

  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  const combined = ["title", "text", "url"].map(key => String(form.get(key) ?? "").trim()).filter(Boolean).join("\n");
  try {
    const id = await receiveWebShare(context, files, combined);
    return Response.redirect(new URL(`/imports/${id}`, request.url), 303);
  } catch (error) { return uploadError(error); }
}
