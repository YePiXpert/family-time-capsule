import { requireFamily } from "@/lib/family/context";
import { CollectionsClient } from "./ui";
export default async function CollectionsPage() {
  await requireFamily();
  return <CollectionsClient />;
}
