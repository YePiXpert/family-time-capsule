import { emptyDraftContent, type DraftContent } from "../drafts/model";
export type VoiceReceipt = {
  id: string; originalId: string; assetId: string | null;
  memoryId: string; authorPersonId: string; authorName: string;
  visibility: "family" | "private" | "parents" | "child_later";
  text: string;
};
type RemoteDraft = { id: string; revision: number; status: string; memoryEventId: string | null; items: DraftContent["items"] };
export type VoiceTransport = (path: string, init?: RequestInit) => Promise<unknown>;
/** A stable receipt retries upload and contribution creation without duplicating either. */
export async function submitVoice(
  receipt: VoiceReceipt,
  request: VoiceTransport,
  upload: () => Promise<string>,
  preserveAsset: (id: string) => Promise<void>,
  guard: () => void,
) {
  const endpoint = `/api/mobile/v1/drafts/${encodeURIComponent(receipt.id)}`;
  guard();
  let remote: RemoteDraft | null = null;
  try { remote = await request(endpoint) as RemoteDraft; }
  catch (error) { if (!error || typeof error !== "object" || !("status" in error) || error.status !== 404) throw error; }
  guard();
  if (remote?.status === "published") {
    if (remote.memoryEventId !== receipt.memoryId) throw new Error("这份录音草稿已用于另一条记录，请核对。");
    return;
  }
  const content = { ...emptyDraftContent(), visibility: "private" as const, text: receipt.text,
    items: [{ id: receipt.originalId, localCaptureRef: receipt.originalId, assetId: receipt.assetId, caption: "" }] };
  if (!remote) remote = await request(endpoint, { method: "PUT", body: JSON.stringify({ expectedRevision: 0, mutationId: receipt.id, content }) }) as RemoteDraft;
  guard();
  const assetId = receipt.assetId || remote.items.find(i => i.id === receipt.originalId)?.assetId || await upload();
  guard(); await preserveAsset(assetId); guard();
  content.items[0]!.assetId = assetId;
  if (!remote.items.some(i => i.id === receipt.originalId && i.assetId === assetId)) {
    remote = await request(endpoint, { method: "PUT", body: JSON.stringify({ expectedRevision: remote.revision, mutationId: `${receipt.id}-uploaded`, content }) }) as RemoteDraft;
  }
  guard();
  await request(`/api/mobile/v1/memories/${encodeURIComponent(receipt.memoryId)}/contributions`, { method: "POST", body: JSON.stringify({ authorPersonId: receipt.authorPersonId, text: receipt.text || undefined, visibility: receipt.visibility, audioAssetId: assetId, clientId: receipt.id, sourceDraftId: receipt.id }) });
  guard();
}
