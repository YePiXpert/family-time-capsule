/**
 * Defense in depth for secret-bearing modules. AI environment variables never
 * use NEXT_PUBLIC_ prefixes, and runtime construction is refused in a browser.
 */
export function assertAiServerRuntime(): void {
  if (typeof window !== "undefined") {
    throw new Error("AI provider configuration is server-only.");
  }
}
