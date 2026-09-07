import type { DraftContent } from "./model";
export type BrowserDraft = {
  id: string;
  scope: string;
  content: DraftContent;
  revision: number;
  serverRevision: number;
  syncedRevision: number;
  mutationId: string;
  status: "editing" | "queued" | "published" | "discarded";
  memoryEventId: string | null;
  updatedAt: string;
};
/** Originals have a separate key; reordering/editing a draft never copies bytes. */
export type BrowserOriginal = { scope: string; id: string; file: File; assetId: string | null };
const DB_NAME = "ftc-drafts-v1";
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore("drafts", { keyPath: ["scope", "id"] });
      req.result.createObjectStore("originals", { keyPath: ["scope", "id"] });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new Error("无法打开本机草稿；请检查浏览器存储空间与权限。"));
    req.onblocked = () => reject(new Error("请关闭旧页面后重新打开草稿。"));
  });
}
export async function listBrowserDrafts(scope: string): Promise<BrowserDraft[]> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("drafts", "readonly");
    const req = tx.objectStore("drafts").getAll(IDBKeyRange.bound([scope, ""], [scope, "\uffff"]));
    tx.oncomplete = () => { db.close(); resolve((req.result as BrowserDraft[]).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))); };
    tx.onabort = tx.onerror = () => { db.close(); reject(new Error("无法读取本机草稿。")); };
  });
}
export async function readBrowserOriginal(scope: string, id: string): Promise<BrowserOriginal | undefined> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("originals", "readonly"), req = tx.objectStore("originals").get([scope, id]);
    tx.oncomplete = () => { db.close(); resolve(req.result); };
    tx.onabort = tx.onerror = () => { db.close(); reject(new Error("无法读取本机原件。")); };
  });
}
/** Resolve only on transaction completion, including disk/quota errors. */
export async function writeBrowserDraft(draft: BrowserDraft, expectedRevision: number | null, originals: BrowserOriginal[] = []): Promise<void> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["drafts", "originals"], "readwrite", { durability: "strict" });
    let conflict = false;
    const store = tx.objectStore("drafts"), get = store.get([draft.scope, draft.id]);
    get.onsuccess = () => {
      const current = get.result as BrowserDraft | undefined;
      if (expectedRevision !== null && (current?.revision ?? 0) !== expectedRevision) { conflict = true; tx.abort(); return; }
      store.put(draft);
      for (const original of originals) {
        if (original.scope !== draft.scope) { tx.abort(); return; }
        tx.objectStore("originals").put(original);
      }
    };
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onabort = () => { db.close(); reject(new Error(conflict ? "另一个页面已修改这份草稿，请重新打开；本次输入仍留在页面中。" : "本机保存失败，尚未安全落盘。请检查磁盘空间，保留此页面并重试。")); };
    tx.onerror = () => {}; // transaction abort reports the durable failure once
  });
}
