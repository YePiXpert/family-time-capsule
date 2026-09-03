import "server-only";

import { mkdirSync } from "node:fs";
import path from "node:path";

/**
 * 数据目录布局（PRD §11）。数据库只存元数据与 storageKey，
 * 大媒体一律放在文件系统；Docker 部署时整个目录挂载为 volume。
 */
export const DATA_DIR =
  process.env.DATA_DIR ?? path.join(process.cwd(), "data");

export type DataDirs = {
  root: string;
  originals: string;
  derivatives: string;
  exports: string;
};

const DERIVATIVE_SUBDIRS = [
  "thumbnails",
  "previews",
  "transcodes",
  "waveforms",
] as const;

export function ensureDataDirs(root: string = DATA_DIR): DataDirs {
  const dirs: DataDirs = {
    root,
    originals: path.join(root, "originals"),
    derivatives: path.join(root, "derivatives"),
    exports: path.join(root, "exports"),
  };
  for (const dir of Object.values(dirs)) {
    mkdirSync(dir, { recursive: true });
  }
  for (const sub of DERIVATIVE_SUBDIRS) {
    // Runtime DATA_DIR is an operator-controlled volume, not a build input.
    mkdirSync(path.join(/* turbopackIgnore: true */ dirs.derivatives, sub), {
      recursive: true,
    });
  }
  return dirs;
}
