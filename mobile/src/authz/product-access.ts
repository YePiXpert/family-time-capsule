import type { Viewer } from "../types";

export type NativeCaptureAccess = "local" | "enabled" | "readonly";

export function resolveNativeCaptureAccess(
  connectedToServer: boolean,
  viewer: Viewer | null,
): NativeCaptureAccess {
  if (!connectedToServer) return "local";
  return viewer?.canCapture === true ? "enabled" : "readonly";
}

export function canReviewMobileInbox(viewer: Viewer | null): boolean {
  return viewer?.canReviewInbox === true;
}
