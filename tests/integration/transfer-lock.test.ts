import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { expect, it } from 'vitest';
import { withTransferLock, TransferBusyError } from '@/lib/imports/transfer-lock';

it.skipIf(process.platform === 'linux')('dev fallback rejects a second in-process writer while the first holds the lock', async () => {
  const id = randomUUID();
  let release!: () => void;
  const held = withTransferLock(id, () => new Promise<void>(resolve => { release = resolve; }));
  await expect(withTransferLock(id, async () => 'unsafe second writer')).rejects.toBeInstanceOf(TransferBusyError);
  release();
  await expect(held).resolves.toBeUndefined();
  await expect(withTransferLock(id, async () => 'recovered')).resolves.toBe('recovered');
});

it.skipIf(process.platform !== 'linux')('kernel lock is shared by independent processes and released by process death without deleting a lock file', async () => {
  const id = randomUUID();
  const program = `import { withTransferLock } from './lib/imports/transfer-lock.ts';
    await withTransferLock(${JSON.stringify(id)}, async () => {
      process.stdout.write('acquired'); await new Promise(() => { setInterval(() => {}, 1000); });
    });`;
  const child = spawn(process.execPath, ['--import','tsx','--conditions=react-server','--input-type=module','-e',program], {env:process.env,stdio:['ignore','pipe','pipe']});
  let errors = '';
  child.stderr.on('data', chunk => { errors += chunk; });
  try {
    const ready = await Promise.race([once(child.stdout,'data').then(([bytes]) => String(bytes)), once(child,'exit').then(([code]) => { throw new Error(`child ${code}: ${errors}`); })]);
    expect(ready).toBe('acquired');
    await expect(withTransferLock(id, async () => 'unsafe second writer')).rejects.toBeInstanceOf(TransferBusyError);
    const exited = once(child,'exit'); child.kill('SIGKILL'); await exited;
    await expect(withTransferLock(id, async () => 'recovered')).resolves.toBe('recovered');
  } finally { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }
});
