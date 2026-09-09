import { expect, type Page } from "@playwright/test";
import type { BrowserDraft, BrowserOriginal } from "../../../lib/drafts/browser-store";

export async function expandCaptureOptions(page: Page) {
  if (new URL(page.url()).pathname !== "/capture") return;
  const metadata = page.locator("summary").filter({ hasText: "补充信息（可选）" });
  const readOnly = page.getByText("当前账号是只读角色", { exact: false });
  await expect(metadata.or(readOnly)).toBeVisible();
  if (await readOnly.isVisible()) return;
  for (const summary of [metadata, page.locator("summary").filter({ hasText: /^(全家|指定成员|仅自己)可见$/ }), page.locator("summary").filter({ hasText: /^草稿$/ })]) {
    if (!await summary.count()) continue;
    if (!await summary.evaluate(node => (node.parentElement as HTMLDetailsElement).open)) await summary.click();
  }
}

/** Inbox editor fixtures submit an existing local draft through the supported API.
 * Owners' normal capture UI publishes directly; review is a separate contributor flow. */
export async function submitCaptureForReview(page: Page, submit = true) {
  await expect(page.getByRole("status").filter({ hasText: /^本机已保存 ·/ })).toBeVisible();
  await page.evaluate(async (submit) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("ftc-drafts-v1", 1);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    const read = <T,>(store: string, key?: IDBValidKey) => new Promise<T>((resolve, reject) => {
      const tx = db.transaction(store, "readonly"), os = tx.objectStore(store), request = key ? os.get(key) : os.getAll();
      tx.oncomplete = () => resolve(request.result); tx.onerror = () => reject(tx.error);
    });
    const rows = await read<BrowserDraft[]>("drafts");
    const row = rows.filter(r => r.status === "editing").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]!;
    if (!row) throw new Error("No local capture fixture");
    const json = async (url: string, method: string, body?: unknown) => {
      const response = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
      if (!response.ok) throw new Error(`${url}: ${response.status} ${await response.text()}`);
      return response.json();
    };
    const endpoint = `/api/mobile/v1/drafts/${row.id}`;
    let remote = await json(endpoint, "PUT", { expectedRevision: row.serverRevision, mutationId: crypto.randomUUID(), content: row.content });
    for (const item of row.content.items) {
      if (item.assetId || !item.localCaptureRef) continue;
      const original = await read<BrowserOriginal>("originals", [row.scope, item.localCaptureRef]);
      const file = original.file;
      const descriptor = await json("/api/uploads", "POST", { captureId: item.localCaptureRef, draftId: row.id, filename: file.name, declaredMime: file.type || "application/octet-stream", totalBytes: file.size, source: "web", importSessionId: null, lastModified: file.lastModified });
      let result = descriptor;
      if (!descriptor.assetId) {
        const upload = `/api/uploads/${descriptor.uploadId}`;
        const response = await fetch(upload, { method: "PATCH", headers: { "content-type": "application/offset+octet-stream", "upload-offset": String(descriptor.uploadOffset) }, body: file.slice(Number(descriptor.uploadOffset)) });
        if (!response.ok) throw new Error(`Upload failed: ${response.status}`);
        result = await json(`${upload}/complete`, "POST");
      }
      item.assetId = result.assetId ?? result.existingAssetId;
      const existing = row.content.items.find(other => other.id !== item.id && other.assetId === item.assetId);
      if (existing) {
        if (row.content.coverItemId === item.id) row.content.coverItemId = existing.id;
        row.content.items = row.content.items.filter(other => other.id !== item.id);
      }
    }
    remote = await json(endpoint, "PUT", { expectedRevision: remote.revision, mutationId: crypto.randomUUID(), content: row.content });
    if (submit) remote = await json(`${endpoint}/submit`, "POST", { expectedRevision: remote.revision });
    row.serverRevision = remote.revision; row.revision += 1; row.syncedRevision = row.revision;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("drafts", "readwrite"); tx.objectStore("drafts").put(row);
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, submit);
  await page.reload();
  await expandCaptureOptions(page);
}
