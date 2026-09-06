import { requireFamilyCapability } from "@/lib/authz/context";
import { listReadGrants } from "@/lib/family/read-grants";
import { CollectionEditor } from "../ui";
import { ReadGrantPanel } from "./read-grant-panel";

export const dynamic = "force-dynamic";

export default async function CollectionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const context = await requireFamilyCapability("archive:view");
  const { id } = await params;
  // 只读链接由管理员管理；其他角色不渲染该区块。
  let grants = null;
  if (context.role === "owner" || context.role === "admin") {
    grants = listReadGrants(context.familyId).filter(
      (grant) => grant.collectionId === id,
    );
  }
  return (
    <>
      <CollectionEditor id={id} />
      {grants !== null ? (
        <ReadGrantPanel collectionId={id} grants={grants} />
      ) : null}
    </>
  );
}
