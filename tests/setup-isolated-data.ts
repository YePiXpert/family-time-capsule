import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll } from "vitest";

// Even pure-looking worker/search tests can reach cleanup or a database lookup.
// Never let an omitted fixture DATA_DIR fall back to the developer's archive.
const dataDir = mkdtempSync(path.join(tmpdir(), "ftc-test-file-"));
process.env.DATA_DIR = dataDir;
afterAll(async () => {
  const database = await import("@/db");
  database.closeDatabase?.();
  rmSync(dataDir, { recursive: true, force: true });
});
