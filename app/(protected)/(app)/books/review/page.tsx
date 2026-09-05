import Link from "next/link";
import { requireFamily } from "@/lib/family/context";
import { calendarDate } from "@/mobile/src/utils/calendar";
import { bookReviewRange } from "@/mobile/src/books/review-types";
import { BookReviewEditor } from "@/components/book-review";
export const dynamic = "force-dynamic";
export const metadata = { title: "月度与年度回顾 · Family Time Capsule" };
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireFamily(),
    params = await searchParams,
    range = bookReviewRange(
      calendarDate(new Date(), context.familyTimezone).slice(0, 7),
    );
  if (
    typeof params.startDate === "string" &&
    typeof params.endDate === "string"
  ) {
    range.startDate = params.startDate;
    range.endDate = params.endDate;
  }
  return (
    <main className="page-container">
      <Link href="/books" className="ui-text-link">
        ← 家庭书架
      </Link>
      <h1 className="mt-6 text-3xl">月度与年度回顾</h1>
      <BookReviewEditor initialRange={range} />
    </main>
  );
}
