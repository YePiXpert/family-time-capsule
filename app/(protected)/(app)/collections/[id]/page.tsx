import { requireFamily } from "@/lib/family/context";
import { CollectionEditor } from "../ui";
export default async function CollectionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireFamily();
  return <CollectionEditor id={(await params).id} />;
}
