import { beforeEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
const io = vi.hoisted(() => ({ files: new Map<string, Uint8Array>(), shared: '' }));
vi.mock('expo-sqlite', async () => await import('../../tests/mocks/expo-sqlite'));
vi.mock('expo-crypto', () => ({ randomUUID }));
vi.mock('expo-sharing', () => ({ isAvailableAsync: async () => true, shareAsync: async (uri: string) => { io.shared = uri; } }));
vi.mock('expo-file-system', () => {
  const resolve = (parts: (string | { uri: string })[]) => parts.map(p => typeof p === 'string' ? p : p.uri).join('/');
  class Directory { uri: string; constructor(...parts: (string | { uri: string })[]) { this.uri = resolve(parts); } create() {} }
  class File {
    uri: string; constructor(...parts: (string | { uri: string })[]) { this.uri = resolve(parts); }
    get exists() { return io.files.has(this.uri); }
    get size() { return io.files.get(this.uri)?.length ?? 0; }
    bytes() { return io.files.get(this.uri)!; }
    write(bytes: Uint8Array) { io.files.set(this.uri, new Uint8Array(bytes)); }
    delete() { io.files.delete(this.uri); }
  }
  return { Directory, File, Paths: { document: 'file:///documents', cache: 'file:///cache' } };
});
const db = await import('../src/storage/database');
const { getRawMockDatabase } = await import('../../tests/mocks/expo-sqlite');
const { exportRescuePackage, restoreRescuePackage } = await import('../src/rescue/device');
const { verifyRescuePackage } = await import('../src/rescue/rescue-package');
const scope = JSON.stringify(['https://family.invalid', 'instance', 'owner', 'family']);
const photo = new TextEncoder().encode('irreplaceable-original');
function seed() {
  const payload = { localUri: 'file:///original.jpg', fileName: 'original.jpg', mimeType: 'image/jpeg', mediaType: 'image', source: 'library', lastModified: null, memoryEditOwnerScope: scope, memoryEditTarget: 'memory' };
  const content = { title: '编辑', bodyText: '保留的全文', location: '', occurredAt: null, precision: 'unknown', participants: [], child: null, items: [{ id: 'item', assetId: null, localCaptureRef: 'photo', caption: '照片' }] };
  const snapshot = { scope, memoryId: 'memory', content, base: { ...content, items: [] }, baseRevision: 5, timezone: 'UTC', savedContent: content,
    submission: { mutationId: 'once', content, expectedRevision: 5 }, conflict: null, blocked: false, problem: null, revision: 2, updatedAt: '2026-09-16T00:00:00Z' };
  const raw = getRawMockDatabase();
  raw.prepare("INSERT INTO local_capture(id,kind,title,occurred_at,local_uri,media_type,payload_json,sync_state) VALUES('photo','media_capture','照片','2026-09-16T00:00:00Z',?,'image',?,'pending')").run(payload.localUri, JSON.stringify(payload));
  raw.prepare('INSERT INTO local_memory_edit(scope,memory_id,snapshot_json,updated_at) VALUES(?,?,?,?)').run(scope, 'memory', JSON.stringify(snapshot), snapshot.updatedAt);
  io.files.set(payload.localUri, photo);
}
beforeEach(async () => {
  await db.initializeLocalStore(); await db.clearLocalArchive(); io.files.clear(); io.shared = '';
});
it('device export and actual SQLite restore retain the full edit and original bytes without creating outbox work', async () => {
  seed();
  expect(await exportRescuePackage()).toContain('1 条记录编辑');
  const packageUri = io.shared;
  const manifest = (await verifyRescuePackage(io.files.get(packageUri)!)).manifest;
  expect(manifest.captures).toEqual([]);
  expect(manifest.memoryEdits![0]!.scope).toBe(scope);
  await db.clearLocalArchive(); io.files.delete('file:///original.jpg');
  expect(await restoreRescuePackage(packageUri)).toEqual({ imported: 1, skipped: 0, missingFiles: 0 });
  const group = (await db.listMemoryEditRescueGroups())[0]!;
  expect(group.snapshot).toMatchObject({ blocked: true, content: { bodyText: '保留的全文' }, submission: { mutationId: 'once', expectedRevision: 5 } });
  expect(io.files.get(group.originals[0]!.payload.localUri)).toEqual(photo);
  expect(getRawMockDatabase().prepare('SELECT * FROM outbox').all()).toEqual([]);
  expect(await db.listPendingRescueItems()).toEqual([]);
  const filesBeforeRetry = [...io.files.keys()].sort();
  expect(await restoreRescuePackage(packageUri)).toEqual({ imported: 0, skipped: 1, missingFiles: 0 });
  expect([...io.files.keys()].sort()).toEqual(filesBeforeRetry);
});
it('scope rejection never overwrites an existing original and removes provisional restored files', async () => {
  seed(); await exportRescuePackage(); const packageUri = io.shared;
  getRawMockDatabase().exec('DELETE FROM local_memory_edit');
  getRawMockDatabase().prepare("UPDATE local_capture SET payload_json=? WHERE id='photo'").run(JSON.stringify({ memoryEditOwnerScope: 'other', memoryEditTarget: 'other-memory' }));
  const filesBefore = [...io.files.keys()].sort();
  await expect(restoreRescuePackage(packageUri)).rejects.toThrow('另一条记录');
  expect(io.files.get('file:///original.jpg')).toEqual(photo);
  expect([...io.files.keys()].sort()).toEqual(filesBefore);
  expect(getRawMockDatabase().prepare('SELECT * FROM outbox').all()).toEqual([]);
});
it('restores missing original files when the same-owned capture row survived but its edit did not', async () => {
  seed(); await exportRescuePackage(); const packageUri = io.shared;
  getRawMockDatabase().exec('DELETE FROM local_memory_edit'); io.files.delete('file:///original.jpg');
  expect(await restoreRescuePackage(packageUri)).toEqual({ imported: 1, skipped: 0, missingFiles: 0 });
  const restored = (await db.listMemoryEditRescueGroups())[0]!;
  expect(restored.originals[0]!.payload.localUri).not.toBe('file:///original.jpg');
  expect(io.files.get(restored.originals[0]!.payload.localUri)).toEqual(photo);
  expect(getRawMockDatabase().prepare('SELECT * FROM outbox').all()).toEqual([]);
});
