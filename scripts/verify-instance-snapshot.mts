/** Real Docker + production HTTP + full instance snapshot, using synthetic data.
 * FTC_INSTANCE_TEST_IMAGE must be a trusted image built from the checkout.
 * Run: node --conditions=react-server --import tsx scripts/verify-instance-snapshot.mts
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync, chmodSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";
import { createLocalAccountIssuer } from "@better-auth/core/db";
import type { FamilyContext } from "../lib/family/context";
import type { MobileMemory } from "../mobile/src/types";

const image = process.env.FTC_INSTANCE_TEST_IMAGE;
assert.ok(image, "Build a trusted image and set FTC_INSTANCE_TEST_IMAGE first");
const root = process.cwd();
const workspace = mkdtempSync(path.join(process.env.FTC_TEST_TEMP_DIR ?? tmpdir(), "ftc-instance-roundtrip-"));
chmodSync(workspace, 0o700);
const suffix = randomUUID().slice(0, 12);
const sourceProject = `ftc-snapshot-source-${suffix}`;
const targetProject = `ftc-snapshot-target-${suffix}`;
const sourceData = path.join(workspace, "source-data");
const operator = path.join(workspace, "source-ops");
const target = path.join(workspace, "restored");
const sourceCompose = path.join(operator, "releases/current/compose.yml");
const targetCompose = path.join(root, "scripts/ops/templates/compose.restore-check.yml");
const secret = "synthetic-instance-restore-secret-2026";
const password = "Synthetic-restore-password-2026";
const oldToken = "synthetic-session-before-snapshot";
const guestToken = "synthetic-guest-link-before-snapshot";
const uid = String(process.getuid!()), gid = String(process.getgid!());
let closeDatabase: (() => void) | undefined;
let sourceStarted = false, targetStarted = false;
let sourcePort = 0, targetPort = 0;

function command(program: string, args: string[], extraEnv: Partial<NodeJS.ProcessEnv> = {}) {
  const result = spawnSync(program, args, { cwd: root, env: { ...process.env, ...extraEnv }, encoding: "utf8", timeout: 180_000, maxBuffer: 4 * 1024 * 1024 });
  assert.equal(result.status, 0, `${program} failed: ${result.stderr?.slice(-2500)}`);
  return result.stdout;
}
async function freePort() {
  const socket = createServer();
  await new Promise<void>(resolve => socket.listen(0, "127.0.0.1", resolve));
  const address = socket.address();
  assert.ok(address && typeof address !== "string");
  await new Promise<void>(resolve => socket.close(() => resolve()));
  return address.port;
}
function targetEnv(): Partial<NodeJS.ProcessEnv> {
  return { FTC_RESTORE_IMAGE: image, FTC_RESTORE_PORT: String(targetPort), FTC_RESTORE_PROJECT: targetProject,
    FTC_RESTORE_DATA_DIR: path.join(target, "data"), FTC_RESTORE_UID: uid, FTC_RESTORE_GID: gid, AUTH_SECRET: secret };
}
function compose(config: string, project: string, args: string[], env: Partial<NodeJS.ProcessEnv> = {}) {
  return command("docker", ["compose", "-p", project, "-f", config, ...args], env);
}
const headers = (token: string) => ({ authorization: `Bearer ${token}` });
async function getMemory(origin: string, id: string, token: string) {
  const response = await fetch(`${origin}/api/mobile/v1/memories/${id}`, { headers: headers(token) });
  assert.equal(response.status, 200, "authorized memory must remain readable");
  return await response.json() as MobileMemory;
}
async function login(origin: string, id: string) {
  const response = await fetch(`${origin}/api/auth/sign-in/email`, { method: "POST",
    headers: { "content-type": "application/json", origin }, body: JSON.stringify({ email: `${id}@snapshot.fixture.invalid`, password }) });
  const body = await response.json() as { token: string; code?: string };
  assert.equal(response.status, 200, `credential login failed: ${body.code ?? "unknown"}`);
  assert.equal(typeof body.token, "string");
  return body.token;
}

try {
  for (const key of Object.keys(process.env)) if (/^(AI_|ASR_|WEBDAV_)/u.test(key)) delete process.env[key];
  Object.assign(process.env, { DATA_DIR: sourceData, AUTH_SECRET: secret, AI_PROVIDER: "disabled", BETTER_AUTH_URL: "http://localhost" });
  const database = await import("../db");
  closeDatabase = database.closeDatabase;
  const db = database.getDb();
  const { family, person } = await import("../db/schema/family");
  const { user, account, session, verification } = await import("../db/schema/auth");
  const { memoryEvent } = await import("../db/schema/memory");
  const { collection, collectionItem, guestReadGrant } = await import("../db/schema/collection");
  const { saveDraft, publishDraft } = await import("../lib/drafts/service");
  const { emptyDraftContent } = await import("../lib/drafts/model");
  const { ingestImage, ingestMedia } = await import("../lib/assets/ingest");
  const { deleteLibraryAsset } = await import("../lib/assets/deletion");
  db.insert(family).values({ id: "family", name: "Snapshot synthetic family", timezone: "Pacific/Auckland" }).run();
  const hash = await hashPassword(password);
  for (const id of ["a", "b", "c"]) {
    db.insert(person).values({ id: `person-${id}`, familyId: "family", displayName: `Synthetic ${id}` }).run();
    db.insert(user).values({ id, name: `Synthetic ${id}`, email: `${id}@snapshot.fixture.invalid`, emailVerified: true,
      familyId: "family", personId: `person-${id}`, role: "admin" }).run();
    db.insert(account).values({ id: `credential-${id}`, accountId: id, providerId: "credential", issuer: createLocalAccountIssuer("credential"), userId: id, password: hash }).run();
  }
  const context = (id: string): FamilyContext => ({ familyId: "family", userId: id, userName: `Synthetic ${id}`, personId: `person-${id}`,
    role: "admin", accountEnabled: true, isGuardian: false, familyTimezone: "Pacific/Auckland", childLaterUnlockAge: 18 });
  const jpg = readFileSync(path.join(root, "tests/fixtures/sample-exif.jpg"));
  const wav = readFileSync(path.join(root, "tests/fixtures/sample.wav"));
  const originals: { id: string; bytes: Buffer; owner: string }[] = [];
  for (const owner of ["a", "b"]) {
    const result = await ingestImage({ familyId: "family", createdByUserId: owner, filename: `private-${owner}.jpg`, declaredMime: "image/jpeg", buffer: jpg, visibility: "private" });
    assert.equal(result.status, "stored");
    if (result.status === "stored") originals.push({ id: result.asset.id, bytes: jpg, owner });
  }
  const voice = await ingestMedia({ familyId: "family", createdByUserId: "a", filename: "private-voice.wav", kind: "audio", declaredMime: "audio/wav", buffer: wav, visibility: "private" });
  assert.equal(voice.status, "stored");
  if (voice.status === "stored") originals.push({ id: voice.asset.id, bytes: wav, owner: "a" });
  function publish(owner: string, visibility: "private" | "family" | "members", text: string, assets: string[] = []) {
    const id = randomUUID();
    saveDraft(context(owner), id, 0, randomUUID(), { ...emptyDraftContent(), text, title: text,
      visibility, readerUserIds: visibility === "members" ? ["b"] : [], occurredAtPrecision: "unknown", occurredAt: null,
      items: assets.map(assetId => ({ id: randomUUID(), assetId, localCaptureRef: null, caption: "" })) });
    const result = publishDraft(context(owner), id, 1, { inferTime: false });
    assert.ok(result.memoryEventId);
    return result.memoryEventId;
  }
  const privateA = publish("a", "private", "Private text A: unknown date", originals.filter(o => o.owner === "a").map(o => o.id));
  const privateB = publish("b", "private", "Private text B", originals.filter(o => o.owner === "b").map(o => o.id));
  const shared = publish("a", "family", "Shared family text");
  const knownDate = new Date("2025-12-24T11:00:00.000Z");
  db.update(memoryEvent).set({ occurredAt: knownDate, occurredAtPrecision: "date_only" }).where(eq(memoryEvent.id, shared)).run();
  const members = publish("a", "members", "Only A and B may read");
  const trashed = publish("a", "private", "Soft-deleted text remains deleted");
  db.update(memoryEvent).set({ deletedAt: new Date() }).where(eq(memoryEvent.id, trashed)).run();
  const removed = await ingestImage({ familyId: "family", createdByUserId: "a", filename: "removed.jpg", declaredMime: "image/jpeg", buffer: Buffer.concat([jpg, Buffer.from("removed")]), visibility: "private" });
  assert.equal(removed.status, "stored");
  const removedId = removed.status === "stored" ? removed.asset.id : "unreachable";
  deleteLibraryAsset(context("a"), removedId, true);
  db.insert(collection).values({ id: "shared-album", familyId: "family", kind: "album", title: "Synthetic shared album" }).run();
  db.insert(collectionItem).values({ id: "shared-item", familyId: "family", collectionId: "shared-album", memoryEventId: shared, position: 0 }).run();
  db.insert(guestReadGrant).values({ id: "guest", familyId: "family", collectionId: "shared-album", title: "Synthetic guest link", createdByUserId: "a", tokenHash: createHash("sha256").update(guestToken).digest("hex") }).run();
  db.insert(session).values({ id: "old-session", token: oldToken, userId: "a", expiresAt: new Date(Date.now() + 3600_000) }).run();
  db.insert(verification).values({ id: "old-verification", identifier: "synthetic", value: "synthetic-code", expiresAt: new Date(Date.now() + 3600_000) }).run();
  const identity = await (await import("../lib/instance/service")).getInstanceId();
  closeDatabase();
  sourcePort = await freePort(); targetPort = await freePort();
  const sourceOrigin = `http://127.0.0.1:${sourcePort}`, targetOrigin = `http://127.0.0.1:${targetPort}`;
  mkdirSync(path.dirname(sourceCompose), { recursive: true });
  mkdirSync(path.join(operator, "config"), { recursive: true });
  const environment = { DATA_DIR: "/data", AUTH_SECRET: secret, BETTER_AUTH_URL: sourceOrigin, AI_PROVIDER: "disabled", INITIAL_SETUP_TOKEN: "" };
  const common = { image, user: `${uid}:${gid}`, environment, volumes: [`${sourceData}:/data`] };
  writeFileSync(sourceCompose, JSON.stringify({ services: {
    app: { ...common, ports: [`127.0.0.1:${sourcePort}:3000`], healthcheck: {
      test: ["CMD", "node", "/app/ops/healthcheck.mjs"], interval: "2s", timeout: "5s", retries: 30,
    } },
    worker: { ...common, command: ["node", "/app/ops/worker.mjs"], healthcheck: {
      test: ["CMD", "node", "-e", "process.kill(1, 0)"], interval: "2s", timeout: "2s", retries: 10,
    } },
  } }));
  const originalEnv = `FTC_PROJECT_NAME=${sourceProject}\nFTC_DATA_VOLUME=${sourceData}\nFTC_IMAGE=${image}\nAUTH_SECRET=${secret}\nBETTER_AUTH_URL=${sourceOrigin}\nAI_PROVIDER=disabled\n`;
  writeFileSync(path.join(operator, "config/env"), originalEnv, { mode: 0o600 });
  sourceStarted = true;
  compose(sourceCompose, sourceProject, ["up", "-d", "--wait", "--wait-timeout", "90"]);
  console.log("Synthetic source started", sourceOrigin);
  await login(sourceOrigin, "a");
  assert.equal((await getMemory(sourceOrigin, privateA, oldToken)).bodyText, "Private text A: unknown date");
  assert.equal((await fetch(`${sourceOrigin}/view/${guestToken}`)).status, 200);
  let cursor: string | null = null, checkpoint = "", originalGeneration = "";
  do {
    const response: Response = await fetch(`${sourceOrigin}/api/mobile/v1/sync?protocol=2${cursor ? `&cursor=${cursor}` : ""}`, { headers: headers(oldToken) });
    assert.equal(response.status, 200);
    const page = await response.json() as { nextCursor: string | null; sync: { generation: string; checkpoint: string | null } };
    cursor = page.nextCursor; checkpoint = page.sync.checkpoint ?? checkpoint; originalGeneration = page.sync.generation;
  } while (cursor);
  assert.ok(checkpoint);
  command("bash", ["scripts/ops/ftc", "backup"], { FTC_ROOT: operator });
  console.log("Full instance backup verified and source restarted");
  const snapshots = readdirSync(path.join(operator, "backups")).filter(name => name.endsWith(".tar.gz"));
  assert.equal(snapshots.length, 1);
  const snapshot = path.join(operator, "backups", snapshots[0]!);
  const prior = await getMemory(sourceOrigin, privateA, oldToken);
  const change = await fetch(`${sourceOrigin}/api/mobile/v1/memories/${privateA}`, { method: "PATCH", headers: { ...headers(oldToken), "content-type": "application/json" },
    body: JSON.stringify({ bodyText: "Source changed after snapshot", expectedRevision: prior.titleRevision, mutationId: randomUUID() }) });
  assert.equal(change.status, 200);
  command("bash", ["scripts/ops/ftc", "restore", snapshot, "--to", target], { FTC_ROOT: operator });
  console.log("Isolated restore published after verification");
  assert.equal(readFileSync(path.join(target, "config/env.snapshot"), "utf8"), originalEnv);
  const report = JSON.parse(readFileSync(path.join(target, "restore-report.json"), "utf8"));
  assert.equal(report.originalCount, 3);
  assert.equal(report.postSnapshotRevocationsReconciled, false);
  const restoredDb = new Database(path.join(target, "data/db/capsule.sqlite")), sourceDb = new Database(path.join(sourceData, "db/capsule.sqlite"));
  try {
    for (const table of ["user", "account", "person", "memory_event_reader", "asset_deletion"])
      assert.deepEqual(restoredDb.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(), sourceDb.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(), table);
    assert.equal((restoredDb.prepare("SELECT count(*) n FROM session").get() as { n: number }).n, 0);
    assert.notEqual((restoredDb.prepare("SELECT generation FROM sync_state").get() as { generation: string }).generation, originalGeneration);
  } finally { restoredDb.close(); sourceDb.close(); }
  targetStarted = true;
  compose(targetCompose, targetProject, ["up", "-d", "--wait", "--wait-timeout", "90"], targetEnv());
  console.log("Restored instance started", targetOrigin);
  assert.equal((await fetch(`${targetOrigin}/api/bootstrap`).then(r => r.json()) as { instanceId: string }).instanceId, identity);
  assert.equal((await fetch(`${targetOrigin}/api/mobile/v1/memories/${privateA}`, { headers: headers(oldToken) })).status, 401);
  const tokens = { a: await login(targetOrigin, "a"), b: await login(targetOrigin, "b"), c: await login(targetOrigin, "c") };
  assert.equal((await getMemory(targetOrigin, privateA, tokens.a)).bodyText, "Private text A: unknown date");
  assert.equal((await getMemory(targetOrigin, privateA, tokens.a)).occurredAtPrecision, "unknown");
  assert.equal((await getMemory(targetOrigin, privateB, tokens.b)).bodyText, "Private text B");
  for (const id of [privateA, privateB, members, trashed])
    assert.equal((await fetch(`${targetOrigin}/api/mobile/v1/memories/${id}`, { headers: headers(tokens.c) })).status, 404);
  await getMemory(targetOrigin, members, tokens.b);
  const restoredShared = await getMemory(targetOrigin, shared, tokens.c);
  assert.equal(restoredShared.occurredAtPrecision, "date_only");
  assert.equal(restoredShared.occurredAt, knownDate.toISOString());
  for (const original of originals) {
    const media = await fetch(`${targetOrigin}/api/media/${original.id}`, { headers: headers(tokens[original.owner as "a" | "b"]) });
    assert.equal(media.status, 200);
    assert.deepEqual(Buffer.from(await media.arrayBuffer()), original.bytes);
    assert.equal((await fetch(`${targetOrigin}/api/media/${original.id}`, { headers: headers(tokens.c) })).status, 404);
  }
  assert.equal((await fetch(`${targetOrigin}/api/media/${removedId}`, { headers: headers(tokens.a) })).status, 404);
  assert.equal((await fetch(`${targetOrigin}/view/${guestToken}`)).status, 404);
  const stale = await fetch(`${targetOrigin}/api/mobile/v1/sync?protocol=2&cursor=${checkpoint}`, { headers: headers(tokens.a) });
  assert.equal(stale.status, 409);
  assert.equal((await stale.json() as { error: string }).error, "sync_reset");
  assert.equal((await getMemory(sourceOrigin, privateA, oldToken)).bodyText, "Source changed after snapshot");
  console.log("Instance snapshot verified: full originals, private/members/family HTTP access, deleted state, old sessions/links/cursors, independent startup and untouched source.");
} finally {
  closeDatabase?.();
  if (targetStarted) {
    try { compose(targetCompose, targetProject, ["down", "--remove-orphans"], targetEnv()); } catch { console.error("Isolated restore test container cleanup failed"); }
  }
  if (sourceStarted) {
    try { compose(sourceCompose, sourceProject, ["down", "--remove-orphans"]); } catch { console.error("Isolated source test container cleanup failed"); }
  }
  if (process.env.FTC_KEEP_INSTANCE_TEST === "1") console.log("Kept synthetic restore fixture", workspace);
  else rmSync(workspace, { recursive: true, force: true });
}
