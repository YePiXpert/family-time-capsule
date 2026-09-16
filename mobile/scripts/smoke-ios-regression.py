#!/usr/bin/env python3
"""Native local record/edit/album/relaunch/backup checks against the Release app."""
import argparse
import json
import os
from pathlib import Path
import plistlib
import re
import struct
import subprocess
import time
from ios_simulator import boot_simulator, cleanup_simulator
from local_fixture import seed, read_state


def run(*args, timeout=180):
    result = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    if result.returncode:
        print(result.stdout[-6000:] + result.stderr[-6000:], flush=True)
        raise RuntimeError(f'Command failed: {args}')
    return result.stdout.strip()


def main():
    p = argparse.ArgumentParser(); p.add_argument('app', type=Path); p.add_argument('--runner-build', type=Path, required=True); p.add_argument('--output', type=Path, required=True); args = p.parse_args()
    out = args.output.resolve(); out.mkdir(parents=True, exist_ok=True)
    info = plistlib.loads((args.app / 'Info.plist').read_bytes()); bundle = info['CFBundleIdentifier']
    runtimes = json.loads(run('xcrun','simctl','list','runtimes','--json'))['runtimes']
    runtime = max((r for r in runtimes if r.get('isAvailable') and '.iOS-' in r['identifier']), key=lambda r: tuple(int(n) for n in r['version'].split('.')))
    udid = run('xcrun','simctl','create','Xiaomei offline regression','com.apple.CoreSimulator.SimDeviceType.iPhone-16e',runtime['identifier'])
    report = dict(gitSha=os.environ.get('SOURCE_SHA'), buildNumber=info['CFBundleVersion'], success=False)
    try:
        boot_simulator(udid, out); run('xcrun','simctl','install',udid,str(args.app.resolve())); run('xcrun','simctl','launch',udid,bundle); time.sleep(12)
        container = Path(run('xcrun','simctl','get_app_container',udid,bundle,'data')); database = container / 'Documents' / 'SQLite' / 'xiaomei-local-v1.sqlite'
        run('xcrun','simctl','terminate',udid,bundle); baseline = seed(container, database)
        xctest = next(args.runner_build.resolve().glob('Build/Products/*.xctestrun'))
        command = ['xcodebuild','test-without-building','-xctestrun',str(xctest),'-destination',f'platform=iOS Simulator,id={udid}','-resultBundlePath',str(out/'local.xcresult'),'-parallel-testing-enabled','NO']
        result = subprocess.run(command, capture_output=True, text=True, timeout=900); (out/'xctest.log').write_text(result.stdout + result.stderr)
        subprocess.run(['xcrun','xcresulttool','export','attachments','--path',str(out/'local.xcresult'),'--output-path',str(out/'screenshots')],capture_output=True)
        if result.returncode: print(result.stdout[-12000:] + result.stderr[-12000:]); raise AssertionError('Native local flow failed')
        state = read_state(database)
        assert state['records'] == baseline['records'], 'Full restore did not replace records'
        assert not state['albums'] and not state['drafts'], 'Restore left behind post-backup content'
        backups = list((container/'Documents'/'xiaomei-v1'/'backups').glob('xiaomei-*.xmb')); assert len(backups) >= 2
        manifests=[]
        for backup in backups:
            data=backup.read_bytes(); assert data[:8] == b'XIAOMEI1'; n=struct.unpack('>I',data[8:12])[0]; manifest=json.loads(data[12:12+n]); manifests.append(manifest)
        before=next(m for m in manifests if m['library']['albums']); records=before['library']['records']; own=[r for r in records.values() if r['text']=='A little story. More memories.']; assert len(own)==1 and own[0]['revision']==2
        album=next(iter(before['library']['albums'].values())); assert album['name']=='Our days' and len(album['items'])==3
        assert not before['library']['drafts']
        report.update(success=True, recordIdentityPreserved=True, albumSurvivedRelaunch=True, crossMonthSelection=True, fullBackupRestored=True, backupFiles=len(backups))
    finally:
        (out/'result.json').write_text(json.dumps(report,indent=2)+'\n'); cleanup_simulator(udid,out)


if __name__=='__main__': main()
