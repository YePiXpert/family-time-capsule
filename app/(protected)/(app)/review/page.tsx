import { redirect } from "next/navigation";
import { requireFamily } from "@/lib/family/context";
import { getOrCreateReviewPeriod } from "@/lib/review/service";

export const dynamic = "force-dynamic";

export default async function ReviewRedirectPage() {
  const context = await requireFamily();
  const { window } = await getOrCreateReviewPeriod(context);
  redirect(`/review/${window.key}`);
}
