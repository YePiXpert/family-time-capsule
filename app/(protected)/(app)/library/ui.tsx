"use client";
import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { MediaReader } from "@/components/media-reader";
import { OrganizerControl } from "@/components/organizer-control";
import { utcToZonedWallTimeInput, zonedWallTimeToUtc } from "@/lib/metadata/time";
import type { LibraryDetail, LibraryPage } from "@/mobile/src/assets/types";
const button = "ui-button-secondary min-h-11";
const field = "min-h-11 rounded-xl border border-line bg-surface px-3 py-2 text-base";
const mediaLabels: Record<string, string> = { image: "照片", video: "视频", audio: "录音", document: "文档" };
const aiLabels: Record<string, string> = { none: "AI 尚未整理", pending: "AI 等待中", running: "AI 整理中", completed: "AI 已处理", failed: "AI 未完成，可重试", cancelled: "AI 已取消" };
async function request<T>(url: string, body?: unknown, method = "POST"): Promise<T> {
  const response = await fetch(url, body ? { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
  const result = await response.json();
  if (!response.ok) throw new Error(({ asset_in_use: "这份原件仍被草稿、记忆、相册或作品使用。请先移除相关引用，再删除原件。", revision_conflict: "内容已被修改，请刷新核对后重试。", forbidden: "当前权限不允许这次操作。", not_found: "资料已删除或不再有读取权限。", invalid_people: "人物信息已变化，请刷新后重试。" } as Record<string, string>)[result.error] ?? "操作未完成，请检查网络并重试。");
  return result;
}
export function LibraryActions({ ids, canWrite, onDone }: { ids: string[]; canWrite: boolean; onDone?: () => void }) {
  const router = useRouter();
  const [mode, setMode] = useState<"draft" | "memory" | "collection" | null>(null), [targets, setTargets] = useState<{ id: string; title: string; revision?: number }[]>([]), [cursor, setCursor] = useState<string | null>(null), [query, setQuery] = useState(""), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const load = async (kind: "draft" | "memory" | "collection", next = "") => {
    try {
      setMode(kind); setMessage("");
      if (!next) setTargets([]);
      const body = await request<{ drafts?: { id: string; title: string; text: string; revision: number }[]; entries?: { id: string; title: string; revision: number }[]; items?: { type: string; id: string; title: string }[]; nextCursor?: string | null }>(kind === "draft" ? "/api/mobile/v1/drafts" : kind === "collection" ? `/api/collections?cursor=${encodeURIComponent(next)}` : `/api/mobile/v1/search?q=${encodeURIComponent(query)}&cursor=${encodeURIComponent(next)}`);
      const rows = body.drafts?.map(d => ({ ...d, title: d.title || d.text.slice(0, 30) || "未命名草稿" })) ?? body.entries ?? body.items?.filter(i => i.type === "memory") ?? [];
      setTargets(old => next ? [...old, ...rows] : rows); setCursor(body.nextCursor ?? null);
    } catch (error) { setMessage((error as Error).message); }
  };
  const add = async (operation: "draft" | "memory" | "collection", targetId: string, revision = 0) => {
    setBusy(true); setMessage("");
    try {
      await request("/api/mobile/v1/assets", { operation, targetId, revision, mutationId: crypto.randomUUID(), assetIds: ids });
      if (operation === "draft") router.push(`/capture?draft=${encodeURIComponent(targetId)}`);
      else { setMessage(`已加入${operation === "memory" ? "记忆" : "相册"}，原件仍在资料库。`); onDone?.(); }
    } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  };
  return <section className="my-4 space-y-3" aria-label="整理所选资料">
    <p>已选 {ids.length} 份资料</p>
    <div className="flex flex-wrap gap-3"><button className={button} disabled={!ids.length || busy} onClick={() => void add("draft", crypto.randomUUID())}>加入一条新记忆</button><button className={button} disabled={!ids.length || busy} onClick={() => void load("draft")}>加入已有草稿</button>{canWrite && <><button className={button} disabled={!ids.length || busy} onClick={() => { setMode("memory"); setTargets([]); }}>加入已有记忆</button><button className={button} disabled={!ids.length || busy} onClick={() => void load("collection")}>加入相册</button></>}</div>
    {mode === "memory" && <form className="flex flex-wrap gap-2" onSubmit={e => { e.preventDefault(); void load("memory"); }}><input className={field} aria-label="搜索要加入的记忆" value={query} onChange={e => setQuery(e.target.value)} placeholder="输入记忆标题或文字" /><button className={button}>查找记忆</button></form>}
    {mode && <div className="flex flex-wrap gap-2">{targets.map(target => <button key={target.id} className={button} disabled={busy} onClick={() => void add(mode, target.id, target.revision)}>{target.title}</button>)}{cursor && <button className={button} onClick={() => void load(mode, cursor)}>继续查找</button>}{mode === "collection" && <Link className={button} href="/collections">新建相册</Link>}<button className={button} onClick={() => setMode(null)}>收起选择</button></div>}
    {message && <p role="status">{message}</p>}
  </section>;
}
export function LibraryClient({ initial, timezone, type }: { initial: LibraryPage; timezone: string; type: string }) {
  const [page, setPage] = useState(initial), [selected, setSelected] = useState<string[]>([]), [error, setError] = useState("");
  return <>
    <nav className="my-4 flex flex-wrap gap-3" aria-label="资料类型">{["", "image", "video", "audio", "document"].map(value => <Link key={value} className={type === value ? "ui-button-primary" : button} href={`/library?type=${value}`}>{mediaLabels[value] ?? "全部资料"}</Link>)}</nav>
    <p className="text-muted">原件收到后就可以打开。补标题、时间或使用 AI，都可以以后再做。</p>
    {page.canCapture && <LibraryActions ids={selected} canWrite={page.canWrite} />}
    {error && <p role="alert">{error}</p>}
    {page.pendingDeletions.length > 0 && <section role="alert" className="my-4 space-y-3"><p>有原件已移出资料库，但磁盘清理尚未完成。可以重试；再次失败时请联系维护者。</p>{page.pendingDeletions.map(row => <button key={row.id} className={button} onClick={() => void request<{ cleanupPending: boolean }>(`/api/mobile/v1/assets/${row.id}`, { confirmed: true }, "DELETE").then(result => { if (result.cleanupPending) setError("磁盘清理未完成，请联系维护者检查存储。"); else setPage(old => ({ ...old, pendingDeletions: old.pendingDeletions.filter(item => item.id !== row.id) })); }).catch(e => setError(e.message))}>重试清理已删除原件</button>)}</section>}
    <ul aria-label="已保全的资料" className="my-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{page.entries.map(item => <li key={item.id} className="min-w-0 rounded-2xl border border-line bg-surface p-4">
      {page.canCapture && <label className="flex min-h-11 items-center gap-3"><input type="checkbox" aria-label={`选择 ${item.title}`} checked={selected.includes(item.id)} onChange={e => setSelected(ids => e.target.checked ? [...ids, item.id] : ids.filter(id => id !== item.id))} />选择</label>}
      <Link className="block" href={`/library/${item.id}`}>{item.previewId ? <Image unoptimized src={`/api/media/${item.previewId}`} alt={item.title} width={480} height={320} className="mb-3 h-48 w-full object-contain" /> : <p className="my-8 text-xl">{mediaLabels[item.type]} · 打开原件</p>}<h2 className="break-words text-xl">{item.title}</h2></Link>
      <p>{mediaLabels[item.type]} · {item.capturedAt ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeZone: timezone }).format(new Date(item.capturedAt)) : "时间待补"}</p><p className="mt-2 text-muted">{item.referenced ? "已被记忆引用" : "尚未加入记忆"} · 服务器已收到 · {aiLabels[item.aiState] ?? "AI 状态待核对"}</p>
    </li>)}</ul>
    {!page.entries.length && <p>还没有资料，可以从“记录”或“批量导入”保存原件。</p>}
    {page.nextCursor && <button className={button} onClick={() => void request<LibraryPage>(`/api/mobile/v1/assets?type=${type}&cursor=${encodeURIComponent(page.nextCursor!)}`).then(next => setPage(old => ({ ...next, entries: [...old.entries, ...next.entries] }))).catch(e => setError(e.message))}>更多资料</button>}
  </>;
}
export function AssetDetailClient({ initial, timezone, people }: { initial: LibraryDetail; timezone: string; people: { id: string; displayName: string }[] }) {
  const router = useRouter();
  const [confirmDelete, setConfirmDelete] = useState(false), [deleting, setDeleting] = useState(false);
  const [asset, setAsset] = useState(initial), [at, setAt] = useState(initial.capturedAt ? utcToZonedWallTimeInput(new Date(initial.capturedAt), timezone) : ""), [ids, setIds] = useState(initial.participantIds), [message, setMessage] = useState("");
  async function save() {
    try {
      const capturedAt = at ? zonedWallTimeToUtc(at.length === 16 ? `${at}:00` : at, timezone).toISOString() : null;
      const next = await request<LibraryDetail>(`/api/mobile/v1/assets/${asset.id}`, { revision: asset.metadataRevision, capturedAt, participantIds: ids }, "PATCH");
      setAsset(next); setMessage("资料信息已保存，原件字节保持不变。");
    } catch (error) { setMessage((error as Error).message); }
  }
  return <div className="mt-6 space-y-5">
    <MediaReader assets={[{ id: asset.id, type: asset.type, mimeType: asset.mimeType, filename: initial.title, thumbnailId: asset.previewId, durationMs: asset.technical.durationMs }]} />
    <a className={button} href={`/api/media/${asset.id}?download=1`}>下载原件</a>
    {asset.canCapture && <LibraryActions ids={[asset.id]} canWrite={asset.canWrite} />}
    {asset.memories.map(memory => <Link key={memory.id} className={`${button} inline-block`} href={`/memories/${memory.id}`}>所在记忆：{memory.title}</Link>)}
    {asset.canWrite && <><OrganizerControl kind="asset" id={asset.id} assetOperation="name" /><div className="space-y-3"><label className="block">拍摄或发生时间<input className={`${field} ml-3`} type="datetime-local" value={at} onChange={e => setAt(e.target.value)} /></label><p>不确定时留空，显示“时间待补”。</p><fieldset><legend>资料中的人物</legend><div className="flex flex-wrap gap-3">{people.map(person => <label key={person.id} className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={ids.includes(person.id)} onChange={e => setIds(old => e.target.checked ? [...old, person.id] : old.filter(id => id !== person.id))} />{person.displayName}</label>)}</div></fieldset><button className={button} onClick={() => void save()}>保存时间与人物</button></div>{["audio", "video"].includes(asset.type) && <OrganizerControl kind="asset" id={asset.id} reviewNames={false} />}</>}
    {message && <p role="status">{message}</p>}
    {asset.canDelete && <section className="space-y-3">{confirmDelete ? <><p>永久删除这份原件及其预览，并移除未确认整理项中的引用。已被草稿、记忆、相册或作品使用时会拒绝删除。已有下载和历史备份仍可能保留副本。</p><button className={button} disabled={deleting} onClick={() => { setDeleting(true); void request<{ cleanupPending: boolean }>(`/api/mobile/v1/assets/${asset.id}`, { confirmed: true }, "DELETE").then(() => { router.push("/library"); router.refresh(); }).catch(e => { setMessage(e.message); setDeleting(false); }); }}>确认永久删除原件</button><button className={button} disabled={deleting} onClick={() => setConfirmDelete(false)}>取消</button></> : <button className={button} onClick={() => setConfirmDelete(true)}>删除原件</button>}</section>}
    <details className="rounded-xl border border-line p-4"><summary className="min-h-11 cursor-pointer">原件详细信息</summary><dl className="space-y-3 break-all"><dt>原文件名</dt><dd>{asset.technical.originalFilename}</dd><dt>SHA256</dt><dd>{asset.technical.sha256}</dd><dt>格式与尺寸</dt><dd>{asset.mimeType} · {asset.technical.bytes} 字节 · {asset.technical.width ?? "—"} × {asset.technical.height ?? "—"}</dd><dt>导入来源</dt><dd>{asset.technical.importSources.map(source => ({ web: "网页导入", native: "手机记录", share: "系统分享", guest: "亲友贡献" }[source] ?? "其他导入")).join("、") || "早期记录，未保留来源"}</dd><dt>导入时间</dt><dd>{asset.technical.importedAt}</dd><dt>EXIF 与原始元数据</dt><dd className="whitespace-pre-wrap">{asset.technical.metadataJson ?? "没有内嵌元数据"}</dd></dl></details>
  </div>;
}
