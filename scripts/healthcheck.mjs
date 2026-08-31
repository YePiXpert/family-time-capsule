#!/usr/bin/env node
// Docker/Compose health probe. It verifies both HTTP readiness and SQLite access
// through the application's public health contract.
const port = process.env.PORT ?? "3000";
const healthUrl = process.env.HEALTHCHECK_URL ?? `http://127.0.0.1:${port}/api/health`;

try {
  const response = await fetch(healthUrl, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(4_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.db !== "ok") {
    throw new Error(`unexpected health response: HTTP ${response.status}, db=${body?.db ?? "?"}`);
  }
} catch (error) {
  console.error(`healthcheck failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
