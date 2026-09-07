"use client";

import { useActionState, useState } from "react";
import { MediaImage } from "@/components/media-view";
import {
  scanClustersAction,
  resolveClusterAction,
  type ClusterActionState,
  type SuggestionActionState,
} from "./actions";

const inputClass =
  "rounded-lg border border-foreground/15 bg-transparent px-3 py-2 text-sm outline-none transition-colors focus:border-accent";

const KIND_LABEL: Record<string, string> = {
  time_proximity: "拍摄时间相近",
  similar_media: "看起来很相似",
  live_photo_pair: "Live Photo 组件",
};

export type ClusterMemberDto = {
  inboxItemId: string;
  label: string;
  assetId: string | null;
  thumbAssetId: string | null;
  mimeType: string | null;
};

export type ClusterSuggestionDto = {
  id: string;
  kind: string;
  reasonText: string;
  /** 成员摘要（文件名/文字开头） */
  memberLabels: string[];
  /** 成员缩略图信息（有图片原件时） */
  members: ClusterMemberDto[];
};

export type ClusterAlbumDto = { id: string; title: string };

/**
 * FIND-5 相似照片候选面板：
 * - 只说「这些照片看起来很相似」或「字节完全相同」，绝不叫“重复照片”；
 * - Live Photo 的图片与视频是一次拍摄的两部分，不会被当成相似重复；
 * - 候选组可以全部保留、勾选几份合并成一段记忆、或直接把勾选的原件
 *   加入相册（相册只引用原件，收件箱条目保留，不算处理完成）；
 * - 本轮不提供任何删除操作，系统永远不会自动删除照片。
 */
export function ClusterSuggestionPanel({
  suggestions,
  albums,
}: {
  suggestions: ClusterSuggestionDto[];
  albums: ClusterAlbumDto[];
}) {
  const [scanState, scanActionRun, scanPending] = useActionState(
    scanClustersAction,
    undefined as SuggestionActionState | undefined,
  );

  return (
    <section
      aria-label="相似照片候选"
      className="mt-8 rounded-xl border border-foreground/10 bg-foreground/[0.02] p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-medium">相似照片候选</h2>
          <p className="mt-1 text-xs leading-5 text-foreground/50">
            完全在本地计算（时间相近 / 画面相似 / Live Photo 配对），不识别人脸、不依赖
            AI；这里只给建议，任何操作都由你决定，也永远不会自动删除照片。
          </p>
        </div>
        <form action={scanActionRun}>
          <button
            type="submit"
            disabled={scanPending}
            className="rounded-lg border border-foreground/20 px-3 py-1.5 text-sm transition-colors hover:border-accent disabled:opacity-50"
          >
            {scanPending ? "扫描中…" : "扫描相似照片"}
          </button>
        </form>
      </div>
      {scanState?.message && (
        <p role="status" className="mt-2 text-sm text-foreground/70">
          {scanState.message}
        </p>
      )}
      {scanState?.error && (
        <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-400">
          {scanState.error}
        </p>
      )}

      {suggestions.length > 0 && (
        <ul className="mt-4 flex flex-col gap-3" aria-label="相似照片候选列表">
          {suggestions.map((s) => (
            <ClusterRow key={s.id} cluster={s} albums={albums} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ClusterRow({
  cluster,
  albums,
}: {
  cluster: ClusterSuggestionDto;
  albums: ClusterAlbumDto[];
}) {
  const [state, action, pending] = useActionState(
    resolveClusterAction,
    undefined as ClusterActionState | undefined,
  );
  const [albumChoice, setAlbumChoice] = useState("");
  const isLivePhoto = cluster.kind === "live_photo_pair";
  const isSimilar = cluster.kind === "similar_media";
  const isExact = cluster.reasonText.includes("字节完全相同");

  return (
    <li className="rounded-lg border border-foreground/10 px-4 py-3 text-sm">
      <p>
        <span className="rounded border border-foreground/15 px-1.5 py-0.5 text-xs text-foreground/60">
          {isLivePhoto ? KIND_LABEL.live_photo_pair : isExact ? "内容完全相同" : KIND_LABEL[cluster.kind] ?? cluster.kind}
        </span>
        <span className="ml-2">{cluster.reasonText}</span>
      </p>
      {isLivePhoto ? (
        <p className="mt-1 text-xs leading-5 text-foreground/50">
          图片与视频是同一次拍摄的两个组成部分，不会被视为相似重复，也不会建议去掉任何一个。
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-2" aria-label="候选组成员">
        {cluster.members.map((member) => (
          <label
            key={member.inboxItemId}
            className="flex w-24 cursor-pointer flex-col gap-1 rounded-lg border border-foreground/10 bg-background p-1.5"
          >
            <input
              type="checkbox"
              name="member"
              value={member.inboxItemId}
              defaultChecked
              className="sr-only peer"
              aria-label={`选中：${member.label}`}
            />
            <span
              className="relative block aspect-[4/3] overflow-hidden rounded-md outline-offset-1 peer-checked:outline-2 peer-checked:outline-accent"
              aria-hidden="true"
            >
              {member.assetId && member.mimeType?.startsWith("image/") ? (
                <MediaImage
                  assetId={member.assetId}
                  mimeType={member.mimeType}
                  thumbAssetId={member.thumbAssetId}
                  alt={member.label}
                  className="h-full w-full"
                  imgClassName="h-full w-full object-cover"
                />
              ) : (
                <span className="flex h-full w-full items-center justify-center bg-foreground/5 px-1 text-center text-xs leading-4 text-foreground/50">
                  {member.label}
                </span>
              )}
            </span>
            <span className="truncate text-xs" title={member.label}>{member.label}</span>
          </label>
        ))}
      </div>
      <form action={action} className="mt-2 flex flex-wrap items-center gap-2">
        <input type="hidden" name="suggestionId" value={cluster.id} />
        <input
          type="text"
          name="title"
          maxLength={100}
          placeholder="合并后的事件标题（可留空自动生成）"
          aria-label="分簇合并事件标题"
          className={`${inputClass} min-w-40 flex-1`}
        />
        <button
          type="submit"
          name="action"
          value="accept"
          disabled={pending}
          className="min-h-11 rounded-lg bg-foreground px-3 py-1.5 text-xs text-background transition-opacity disabled:opacity-50"
        >
          {pending ? "处理中…" : "把选中的合成一段记忆"}
        </button>
        <button
          type="submit"
          name="action"
          value="dismiss"
          disabled={pending}
          className="min-h-11 rounded-lg border border-foreground/15 px-3 py-1.5 text-xs text-foreground/60 transition-colors hover:border-accent disabled:opacity-50"
        >
          全部保留（不作处理）
        </button>
        {isSimilar ? (
          <>
            <select
              name="albumChoice"
              value={albumChoice}
              onChange={(event) => setAlbumChoice(event.target.value)}
              aria-label="选择要加入的相册"
              className={`${inputClass} max-w-44`}
            >
              <option value="">选择相册…</option>
              {albums.map((album) => (
                <option key={album.id} value={album.id}>
                  {album.title}
                </option>
              ))}
              <option value="__new">新建相册…</option>
            </select>
            {albumChoice === "__new" ? (
              <input
                type="text"
                name="newAlbumTitle"
                maxLength={100}
                placeholder="新相册名称"
                aria-label="新相册名称"
                className={`${inputClass} max-w-44`}
              />
            ) : null}
            <button
              type="submit"
              name="action"
              value="add_album"
              disabled={pending}
              className="min-h-11 rounded-lg border border-foreground/15 px-3 py-1.5 text-xs text-foreground/60 transition-colors hover:border-accent disabled:opacity-50"
            >
              把选中的加入相册
            </button>
          </>
        ) : null}
        {state?.error && (
          <span className="text-xs text-red-700 dark:text-red-400">
            {state.error}
          </span>
        )}
        {state?.message && (
          <span role="status" className="text-xs text-foreground/70">
            {state.message}
          </span>
        )}
      </form>
      <p className="mt-1 text-xs leading-5 text-foreground/40">
        勾选框决定哪些成员参与；合并至少选两份，加入相册只引用原件（收件箱条目保留，之后仍可合并）。这里没有删除操作，原件始终保留。
      </p>
    </li>
  );
}
