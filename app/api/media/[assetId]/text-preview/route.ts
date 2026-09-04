import { authorizeApiFamilyRequest } from "@/lib/authz/context";
import {
  canReadContributionAsset,
  createContributionAccessSnapshot,
} from "@/lib/authz/contribution-access";
import { getDb } from "@/db";
import { documentText } from "@/db/schema/asset";
import { and, eq } from "drizzle-orm";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ assetId: string }> },
) {
  const { assetId } = await params;
  const authorization = await authorizeApiFamilyRequest(request.headers, "archive:view");
  if (!authorization.ok) return new Response(null, { status: authorization.status });
  if (
    !(await canReadContributionAsset(
      createContributionAccessSnapshot(authorization.context),
      assetId,
    ))
  ) {
    return new Response("Not Found", { status: 404 });
  }
  const row = await getDb()
    .select()
    .from(documentText)
    .where(
      and(
        eq(documentText.familyId, authorization.context.familyId),
        eq(documentText.assetId, assetId),
      ),
    )
    .limit(1);
  if (!row[0]) return new Response("Not Found", { status: 404 });
  return new Response(row[0].text, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "private, no-store",
      "content-disposition": "inline",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
      "x-preview-truncated": String(row[0].truncated),
    },
  });
}
