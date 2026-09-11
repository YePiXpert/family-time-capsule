/** Real Docker deployment failure/cutover checks; synthetic databases only. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const image = process.env.FTC_INSTANCE_TEST_IMAGE;
assert.ok(image, "Set FTC_INSTANCE_TEST_IMAGE to the trusted image built from this checkout");
const workspace = mkdtempSync(path.join(process.env.FTC_TEST_TEMP_DIR ?? tmpdir(), "ftc-deployment-"));
chmodSync(workspace, 0o700);
const project = `ftc-deployment-${randomUUID().slice(0, 12)}`;
const seed = path.join(workspace, "seed"), operator = path.join(workspace, "operator");
const envFile = path.join(operator, "config/env"), composeFile = path.join(operator, "releases/current/compose.yml");
const volumes = new Set<string>();
let brokenImage = "";
function command(program: string, args: string[], expected = 0) {
  const result = spawnSync(program, args, { encoding: "utf8", timeout: 240_000, maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, FTC_ROOT: operator } });
  assert.equal(result.status, expected, `${program} ${args[0]} failed: ${result.stderr?.slice(-3000)}`);
  return result.stdout.trim();
}
function value(key: string) {
  return readFileSync(envFile, "utf8").split("\n").find(line => line.startsWith(`${key}=`))!.slice(key.length + 1);
}
function rememberVolumes() {
  volumes.add(value("FTC_DATA_VOLUME"));
  for (const file of ["upgrade_candidate_volume", "rollback_candidate_volume"]) {
    try { volumes.add(readFileSync(path.join(operator, "state", file), "utf8")); } catch { /* not yet created */ }
  }
  for (const name of readdirSync(path.join(operator, "state/deployments"))) {
    const match = /^volume=(.+)$/m.exec(readFileSync(path.join(operator, "state/deployments", name), "utf8"));
    if (match) volumes.add(match[1]!);
  }
}
function ftc(args: string[], expected = 0) {
  try { return command("bash", ["scripts/ops/ftc", ...args], expected); }
  finally { rememberVolumes(); }
}
function compose(args: string[]) {
  return command("docker", ["compose", "-p", project, "-f", composeFile, "--env-file", envFile, ...args]);
}
function readMarker(volume: string) {
  return command("docker", ["run", "--rm", "--network", "none", "-v", `${volume}:/data`, image!, "node", "-e",
    "const db=require('better-sqlite3')('/data/db/capsule.sqlite',{readonly:true});console.log(db.prepare('SELECT value FROM ops_lifecycle_marker').get().value);db.close();"]);
}

try {
  for (const key of Object.keys(process.env)) if (/^(AI_|ASR_|WEBDAV_)/u.test(key)) delete process.env[key];
  process.env.DATA_DIR = seed;
  const { getDb, closeDatabase } = await import("../db");
  getDb(); closeDatabase();
  const db = new Database(path.join(seed, "db/capsule.sqlite"));
  db.exec("CREATE TABLE ops_lifecycle_marker(value TEXT); INSERT INTO ops_lifecycle_marker VALUES('original');");
  db.close();
  for (const dir of ["config", "state/deployments", "releases/current"]) mkdirSync(path.join(operator, dir), { recursive: true });
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const port = address.port;
  await new Promise<void>(resolve => server.close(() => resolve()));
  const imageId = command("docker", ["inspect", "--format", "{{.Id}}", image]);
  const sourceVolume = `${project}-source`; volumes.add(sourceVolume);
  command("docker", ["volume", "create", sourceVolume]);
  command("docker", ["run", "--rm", "--network", "none", "--user", "0:0", "-v", `${seed}:/source:ro`, "-v", `${sourceVolume}:/target`, image,
    "sh", "-c", "cp -a /source/. /target/ && chown -R 1001:1001 /target"]);
  copyFileSync("scripts/ops/templates/compose.loopback.yml", composeFile);
  // Shorten only probe intervals, retaining the real deployment mounts/network/commands.
  writeFileSync(composeFile, readFileSync(composeFile, "utf8").replace(/interval: \d+s/g, "interval: 2s").replace(/start_period: \d+s/g, "start_period: 2s"));
  writeFileSync(envFile, `FTC_PROJECT_NAME=${project}\nFTC_DATA_VOLUME=${sourceVolume}\nFTC_IMAGE=${imageId}\nFTC_LOOPBACK_PORT=${port}\nAUTH_SECRET=synthetic-deployment-secret-2026\nBETTER_AUTH_URL=http://127.0.0.1:${port}\nAI_PROVIDER=disabled\n`, { mode: 0o600 });
  writeFileSync(path.join(operator, "state/current_deployment"), "source");
  writeFileSync(path.join(operator, "state/current_version"), "1.0.0-dev.2");
  writeFileSync(path.join(operator, "state/deployments/source.env"), `id=source\nimage=${imageId}\nversion=1.0.0-dev.2\nvolume=${sourceVolume}\naccepted_writes=true\n`);
  compose(["up", "-d", "--wait"]);
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/health`)).status, 200);

  const brokenContext = path.join(workspace, "broken-image"); mkdirSync(brokenContext);
  brokenImage = `${project}:broken`;
  writeFileSync(path.join(brokenContext, "Dockerfile"), `FROM ${image}\nCOPY server.js /app/server.js\n`);
  writeFileSync(path.join(brokenContext, "server.js"), "const db=require('better-sqlite3')('/data/db/capsule.sqlite');db.exec(\"UPDATE ops_lifecycle_marker SET value='failed-migration'\");db.close();process.exit(1);");
  command("docker", ["build", "-t", brokenImage, brokenContext]);
  const brokenId = command("docker", ["inspect", "--format", "{{.Id}}", brokenImage]);
  ftc(["upgrade", "--image", brokenId, "--version", "1.0.0-dev.3"], 14);
  const failedVolume = readFileSync(path.join(operator, "state/upgrade_candidate_volume"), "utf8");
  assert.equal(value("FTC_DATA_VOLUME"), sourceVolume);
  assert.equal(readMarker(sourceVolume), "original");
  assert.equal(readMarker(failedVolume), "failed-migration");
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/health`)).status, 200);
  console.log("Real failed migration retained in candidate; original service resumed on untouched volume");

  ftc(["upgrade", "--image", imageId, "--version", "1.0.0-dev.3"]);
  const upgradedVolume = value("FTC_DATA_VOLUME");
  assert.notEqual(upgradedVolume, sourceVolume);
  compose(["exec", "-T", "app", "node", "-e", "const db=require('better-sqlite3')('/data/db/capsule.sqlite');db.exec(\"UPDATE ops_lifecycle_marker SET value='public-write'\");db.close();"]);
  assert.equal(readMarker(upgradedVolume), "public-write");
  assert.equal(readMarker(sourceVolume), "original");
  const snapshot = path.basename(readFileSync(path.join(operator, "state/upgrade_snapshot"), "utf8"));
  ftc(["rollback", "--to", "source", "--snapshot", snapshot, "--accept-data-loss"], 28);
  const plan = readFileSync(path.join(operator, "state/pending_rollback"), "utf8");
  ftc(["start"], 28);
  ftc(["rollback", "--activate", plan, "--accept-data-loss"], 28);
  // Synthetic empty family: no post-snapshot grants/deletions require reconciliation.
  ftc(["rollback", "--activate", plan, "--accept-data-loss", "--access-reviewed"]);
  const restoredVolume = value("FTC_DATA_VOLUME");
  assert.notEqual(restoredVolume, upgradedVolume);
  assert.notEqual(restoredVolume, sourceVolume);
  assert.equal(readMarker(restoredVolume), "original");
  assert.equal(readMarker(upgradedVolume), "public-write");
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/health`)).status, 200);
  console.log("Real rollback activated restored bytes in a new volume and retained post-snapshot writes in the previous volume");

  const healthyCompose = readFileSync(composeFile, "utf8");
  writeFileSync(composeFile, healthyCompose.replace('command: ["node", "/app/ops/worker.mjs"]', 'command: ["node", "-e", "process.exit(7)"]'));
  ftc(["upgrade", "--image", imageId, "--version", "1.0.0-dev.3"], 13);
  assert.notEqual(value("FTC_DATA_VOLUME"), restoredVolume);
  assert.equal(readFileSync(path.join(operator, "state/phase"), "utf8"), "upgrade-open-failed");
  assert.equal(compose(["ps", "--status", "running", "-q", "app", "worker"]), "");
  assert.equal(readMarker(restoredVolume), "original");
  console.log("Real public worker failure stopped writers and preserved the newly activated pair without automatic rollback");
  writeFileSync(composeFile, healthyCompose);
} finally {
  try { compose(["down", "--remove-orphans"]); } catch { console.error("Synthetic deployment container cleanup failed"); }
  for (const volume of volumes) {
    try { command("docker", ["volume", "rm", volume]); } catch { console.error("Synthetic volume cleanup failed", volume); }
  }
  if (brokenImage) spawnSync("docker", ["image", "rm", brokenImage], { stdio: "ignore" });
  if (process.env.FTC_KEEP_INSTANCE_TEST === "1") console.log("Kept deployment evidence", workspace);
  else rmSync(workspace, { recursive: true, force: true });
}
