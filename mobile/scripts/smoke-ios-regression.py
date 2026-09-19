#!/usr/bin/env python3
"""Native local record/edit/album/relaunch/backup checks against the Release app."""
import argparse
import json
import hashlib
import os
from pathlib import Path
import plistlib
import re
import subprocess
import time
from ios_simulator import boot_simulator, cleanup_simulator, launch_simulator_app
from local_fixture import break_state, broken_root, read_backup, seed, read_state


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
    udid = run('xcrun','simctl','create','Anan offline regression','com.apple.CoreSimulator.SimDeviceType.iPhone-16e',runtime['identifier'])
    report = dict(gitSha=os.environ.get('SOURCE_SHA'), buildNumber=info['CFBundleVersion'], success=False)
    try:
        boot_simulator(udid, out); run('xcrun','simctl','install',udid,str(args.app.resolve())); run('xcrun','simctl','privacy',udid,'grant','microphone',bundle); launch_simulator_app(udid, bundle, out, 'regression-fresh'); time.sleep(12)
        container = Path(run('xcrun','simctl','get_app_container',udid,bundle,'data')); database = container / 'Documents' / 'SQLite' / 'anan-local-v1.sqlite'
        run('xcrun','simctl','terminate',udid,bundle); baseline = seed(container, database)
        xctest = next(args.runner_build.resolve().glob('Build/Products/*.xctestrun'))
        command = ['xcodebuild','test-without-building','-xctestrun',str(xctest),'-destination',f'platform=iOS Simulator,id={udid}','-resultBundlePath',str(out/'local.xcresult'),'-parallel-testing-enabled','NO','-only-testing:NativeRegression/NativeRegressionTests/testLocalRecordAlbumAndBackup']
        result = subprocess.run(command, capture_output=True, text=True, timeout=900); (out/'xctest.log').write_text(result.stdout + result.stderr)
        subprocess.run(['xcrun','xcresulttool','export','attachments','--path',str(out/'local.xcresult'),'--output-path',str(out/'screenshots')],capture_output=True)
        if result.returncode: print(result.stdout[-12000:] + result.stderr[-12000:]); raise AssertionError('Native local flow failed')
        # 系统分享结果还要对应一份完整的多页 PDF，不能只靠界面没有红字。
        books = list((container/'Library'/'Caches').rglob('yearbook-2026.pdf'))
        assert len(books) == 1, 'Bound PDF was not retained in the app cache'
        pdf = books[0].read_bytes()
        assert pdf.startswith(b'%PDF-') and pdf.rstrip().endswith(b'%%EOF'), 'Bound PDF is incomplete'
        assert len(re.findall(rb'/Type\s*/Page\b', pdf)) >= 2, 'Bound PDF has no real pagination'
        report['yearbookPdf'] = True
        state = read_state(database)
        assert state['records'] == baseline['records'], 'Full restore did not replace records'
        assert state['letters'] == baseline['letters'], 'Sealed letter did not survive the restore'
        assert not state['albums'] and not state['drafts'], 'Restore left behind post-backup content'
        backups = list((container/'Documents'/'anan-v1'/'backups').glob('anan-*.xmb')); assert len(backups) >= 2
        manifests=[read_backup(backup) for backup in backups]
        before=next(m for m in manifests if m['albums']); records=before['records']; own=[r for r in records.values() if r['text']=='A little story. More memories.']; assert len(own)==1 and own[0]['revision']==2
        assert any(before['media'][i]['kind']=='audio' for i in own[0]['mediaIds']), 'Recorded audio was not preserved'
        album=next(iter(before['albums'].values())); assert album['name']=='Our days' and len(album['items'])==3
        assert not before['drafts']
        # Force startup failure after validating the ordinary restore. Recovery must
        # activate an independent database and leave the unreadable original intact.
        break_state(database)
        recovery_command = command.copy()
        recovery_command[recovery_command.index(str(out/'local.xcresult'))] = str(out/'recovery.xcresult')
        recovery_command[-1] = '-only-testing:NativeRegression/NativeRegressionTests/testUnreadableLibraryRecoversFromLocalBackup'
        recovery = subprocess.run(recovery_command, capture_output=True, text=True, timeout=600)
        (out/'recovery-xctest.log').write_text(recovery.stdout + recovery.stderr)
        subprocess.run(['xcrun','xcresulttool','export','attachments','--path',str(out/'recovery.xcresult'),'--output-path',str(out/'recovery-screenshots')],capture_output=True)
        if recovery.returncode:
            print(recovery.stdout[-12000:] + recovery.stderr[-12000:]); raise AssertionError('Native startup recovery failed')
        registry = container/'Documents'/'anan-v1'/'libraries'
        marker = max(registry.glob('generation-*.json'), key=lambda f: int(f.name.split('-')[1]))
        activated = database.parent/json.loads(marker.read_text())['database']
        restored = read_state(activated)
        # 推荐位按设计挑选「最新的完整备份」；同一分钟内多份备份的名字序与创建序
        # 不保证一致，因此只要求恢复结果与某一份现存完整备份的内容完全一致。
        candidates = {json.dumps(m['records'], sort_keys=True) for m in manifests}
        assert json.dumps(restored['records'], sort_keys=True) in candidates, 'Startup recovery changed records'
        assert broken_root(database) == 'broken', 'Recovery overwrote original database'
        for media in restored['media'].values():
            original = container/'Documents'/'anan-v1'/'media'/media['file']
            assert hashlib.sha256(original.read_bytes()).hexdigest() == media['sha256']
        report.update(success=True, recordIdentityPreserved=True, albumSurvivedRelaunch=True, crossMonthSelection=True, fullBackupRestored=True, unreadableLibraryRecovered=True, originalDatabasePreserved=True, backupFiles=len(backups))
    finally:
        (out/'result.json').write_text(json.dumps(report,indent=2)+'\n'); cleanup_simulator(udid,out)


if __name__=='__main__': main()
