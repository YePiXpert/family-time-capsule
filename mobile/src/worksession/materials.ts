import { fetchBookMaterials, type BookMaterials } from "../api/client";
import { formatOccurredDateLabel } from "../utils/occurred-precision";
import type { Credentials } from "../types";
import {
  localMaterialDetails,
  materialKey,
  type MaterialRef,
} from "../collections/local";
export type MaterialPresentation = {
  ref: MaterialRef;
  title: string;
  date?: string | null;
  uri?: string | null;
  remote?: boolean;
  available: boolean;
  text?: string;
  sourceMemoryId?: string;
};
export function remotePresentation(
  item: BookMaterials["entries"][number],
  scope: string,
  credentials: Credentials,
): MaterialPresentation {
  const image = item.images?.find((i) => i.type === "image");
  return {
    ref: { kind: item.kind, id: item.id, scope },
    title: item.title,
    date:
      item.occurredAt && item.occurredAtPrecision
        ? formatOccurredDateLabel(
            item.occurredAtPrecision,
            item.occurredAt,
            "UTC",
          )
        : null,
    uri: image
      ? `${credentials.serverUrl}/api/media/${encodeURIComponent(image.previewAssetId || image.id)}`
      : null,
    remote: true,
    available: true,
  };
}
export async function resolveMaterials(
  refs: MaterialRef[],
  scope: string,
  credentials: Credentials | null,
  audience: "personal" | "family",
): Promise<MaterialPresentation[]> {
  const map = new Map<string, MaterialPresentation>(),
    aliases = new Map<string, MaterialRef[]>();
  for (const ref of refs.filter(
    (r) =>
      r.kind === "localDraft" && (r.scope === "local" || r.scope === scope),
  )) {
    const row = await localMaterialDetails(ref);
    if (row?.remoteMemoryId) {
      aliases.set(row.remoteMemoryId, [
        ...(aliases.get(row.remoteMemoryId) ?? []),
        ref,
      ]);
      continue;
    }
    if (row)
      map.set(materialKey(ref), {
        ref,
        title: row.title,
        date: row.occurredAt
          ? formatOccurredDateLabel(
              row.occurredAtPrecision,
              row.occurredAt,
              "UTC",
            )
          : null,
        uri: row.uri,
        available: true,
        text: row.text,
      });
  }
  if (credentials && scope !== "local")
    for (const kind of ["memory", "collection"] as const) {
      const ids = [
        ...new Set([
          ...refs
            .filter((r) => r.kind === kind && r.scope === scope)
            .map((r) => r.id),
          ...(kind === "memory" ? [...aliases.keys()] : []),
        ]),
      ];
      for (let offset = 0; offset < ids.length; offset += 100) {
        try {
          const page = await fetchBookMaterials(
            credentials,
            kind,
            audience,
            "",
            "",
            ids.slice(offset, offset + 100),
          );
          for (const row of page.entries) {
            const presentation = remotePresentation(row, scope, credentials);
            map.set(materialKey({ kind, scope, id: row.id }), presentation);
            if (kind === "memory")
              for (const ref of aliases.get(row.id) ?? [])
                map.set(materialKey(ref), {
                  ...presentation,
                  ref,
                  sourceMemoryId: row.id,
                });
          }
        } catch {
          /* Remote sources remain explicitly unavailable; local originals still read locally. */
        }
      }
    }
  return refs.map(
    (ref) =>
      map.get(materialKey(ref)) ?? {
        ref,
        title: "这条记录目前不可用",
        available: false,
      },
  );
}
