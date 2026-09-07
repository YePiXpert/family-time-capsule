import { notFound } from "next/navigation";
import { requireFamily } from "@/lib/family/context";
import { listPeople } from "@/lib/family/service";
import { AssetLibraryError, getLibraryAsset } from "@/lib/assets/library";
import { PageHeader } from "@/components/page-header";
import { AssetDetailClient } from "../ui";
export const dynamic = "force-dynamic";
export default async function AssetPage({ params }: { params: Promise<{ id: string }> }) {
  const context = await requireFamily();
  let original;
  try { original = getLibraryAsset(context, (await params).id); }
  catch (error) { if (error instanceof AssetLibraryError && error.status === 404) notFound(); throw error; }
  const people = await listPeople(context.familyId);
  return <main className="page-container"><PageHeader title={original.title} backHref="/library" backLabel="返回资料库" /><AssetDetailClient initial={original} timezone={context.familyTimezone} people={people.map(p => ({ id: p.id, displayName: p.displayName }))} /></main>;
}
