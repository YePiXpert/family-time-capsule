#!/usr/bin/env python3
"""Native local record/edit/album/relaunch/backup checks against the Release app."""
import argparse
import json
import hashlib
import os
from pathlib import Path
import plistlib
import re
import shutil
import subprocess
import time
from ios_simulator import boot_simulator, cleanup_simulator, create_simulator, launch_simulator_app, xctest_launch_timed_out
from local_fixture import break_state, broken_root, check_blob_store, read_backup, seed, read_state, wait_for_library

# 一轮回归写进输出目录的证据；重来前整批挪进 attempt-1/，第二轮照原名重写。
ATTEMPT_EVIDENCE = ('local.xcresult', 'xctest.log', 'screenshots', 'recovery.xcresult', 'recovery-xctest.log', 'recovery-screenshots')


class LaunchTimeout(Exception):
    """XCTest gave up waiting for the simulator to launch the app; nothing about the app was asserted."""


def run(*args, timeout=180):
    result = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    if result.returncode:
        print(result.stdout[-6000:] + result.stderr[-6000:], flush=True)
        raise RuntimeError(f'Command failed: {args}')
    return result.stdout.strip()


def regression(udid, bundle, app, runner_build, out, report):
    started = time.monotonic(); run('xcrun','simctl','install',udid,str(app.resolve()))
    # 各阶段耗时只打日志：冷启动的模拟器上首次安装、首次启动常常比后面几次慢得多。
    print(f'Installed in {time.monotonic() - started:.0f}s', flush=True)
    run('xcrun','simctl','privacy',udid,'grant','microphone',bundle); started = time.monotonic(); launch_simulator_app(udid, bundle, out, 'regression-fresh')
    print(f'First launch in {time.monotonic() - started:.0f}s', flush=True)
    container = Path(run('xcrun','simctl','get_app_container',udid,bundle,'data')); database = container / 'Documents' / 'SQLite' / 'anan-local-v1.sqlite'
    # 等应用自己建好库再停：原先固定睡 12 秒，慢模拟器上不够，快的上白等。
    print(f'Local library created {wait_for_library(database):.0f}s after launch returned', flush=True); time.sleep(2)
    run('xcrun','simctl','terminate',udid,bundle); baseline = seed(container, database)
    print('Fixture seeded; starting XCUITest', flush=True)
    xctest = next(runner_build.resolve().glob('Build/Products/*.xctestrun'))
    command = ['xcodebuild','test-without-building','-xctestrun',str(xctest),'-destination',f'platform=iOS Simulator,id={udid}','-resultBundlePath',str(out/'local.xcresult'),'-parallel-testing-enabled','NO','-only-testing:NativeRegression/NativeRegressionTests/testLocalRecordAlbumAndBackup']
    started = time.monotonic(); result = subprocess.run(command, capture_output=True, text=True, timeout=900); (out/'xctest.log').write_text(result.stdout + result.stderr)
    print(f'Local flow XCUITest finished in {time.monotonic() - started:.0f}s', flush=True)
    subprocess.run(['xcrun','xcresulttool','export','attachments','--path',str(out/'local.xcresult'),'--output-path',str(out/'screenshots')],capture_output=True)
    if result.returncode:
        print(result.stdout[-12000:] + result.stderr[-12000:])
        if xctest_launch_timed_out(result.stdout + result.stderr, bundle): raise LaunchTimeout('Native local flow: XCTest timed out launching the app')
        raise AssertionError('Native local flow failed')
    # 系统分享结果还要对应一份完整的多页 PDF，不能只靠界面没有红字。
    books = list((container/'Library'/'Caches').rglob('yearbook-2026.pdf'))
    assert len(books) == 1, 'Bound PDF was not retained in the app cache'
    pdf = books[0].read_bytes()
    assert pdf.startswith(b'%PDF-') and pdf.rstrip().endswith(b'%%EOF'), 'Bound PDF is incomplete'
    assert len(re.findall(rb'/Type\s*/Page\b', pdf)) >= 2, 'Bound PDF has no real pagination'
    report['yearbookPdf'] = True
    # 开放归档必须是任何解压工具都认的 zip：zipfile 全量校验，且带离线网页与 fixture 那条记录的文件夹。
    import zipfile
    archives = list((container/'Library'/'Caches').rglob('*成长记归档-*.zip'))
    assert len(archives) == 1, 'Open archive was not retained in the app cache'
    with zipfile.ZipFile(archives[0]) as z:
        assert z.testzip() is None, 'Open archive has a corrupt entry'
        names = z.namelist()
        assert any(n.endswith('/index.html') for n in names) and any(n.endswith('/library.js') for n in names), 'Open archive lacks the offline page'
        assert any('/记录/2026/2026-09-15 First little wave/照片1.png' in n for n in names), f'Fixture photo missing from archive: {names[:20]}'
    report['openArchive'] = True
    state = read_state(database)
    assert state['records'] == baseline['records'], 'Full restore did not replace records'
    assert state['letters'] == baseline['letters'], 'Sealed letter did not survive the restore'
    assert not state['albums'] and not state['drafts'], 'Restore left behind post-backup content'
    # Build 70 起应用内保留的是清单备份（.xmbm）+ 内容寻址的 blob 库；旧的整份 .xmb 也仍然认。
    backups = list((container/'Documents'/'anan-v1'/'backups').glob('anan-*.xmb*')); assert len(backups) >= 2
    assert all(backup.suffix == '.xmbm' for backup in backups), f'Retention copies should be manifests: {[b.name for b in backups]}'
    check_blob_store(container/'Documents'/'anan-v1', backups)
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
        print(recovery.stdout[-12000:] + recovery.stderr[-12000:])
        if xctest_launch_timed_out(recovery.stdout + recovery.stderr, bundle): raise LaunchTimeout('Native startup recovery: XCTest timed out launching the app')
        raise AssertionError('Native startup recovery failed')
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


def main():
    p = argparse.ArgumentParser(); p.add_argument('app', type=Path); p.add_argument('--runner-build', type=Path, required=True); p.add_argument('--output', type=Path, required=True)
    # 出包流水线在等构建时已把模拟器建好、启动并热身（ios_simulator.py prepare）；本地手跑不传就自己建。
    p.add_argument('--udid'); args = p.parse_args()
    out = args.output.resolve(); out.mkdir(parents=True, exist_ok=True)
    info = plistlib.loads((args.app / 'Info.plist').read_bytes()); bundle = info['CFBundleIdentifier']
    udid = args.udid or create_simulator('Anan offline regression')
    report = dict(gitSha=os.environ.get('SOURCE_SHA'), buildNumber=info['CFBundleVersion'], success=False)
    try:
        if not args.udid: boot_simulator(udid, out)
        # 只有「XCTest 等不到模拟器把应用拉起来」这一种失败重来一次：卸载重装、重新写入测试数据、
        # 两段 XCUITest 从头再跑。断言失败、崩溃和别的错误照旧直接判红；第一轮的证据留在 attempt-1/。
        for attempt in (1, 2):
            try:
                regression(udid, bundle, args.app, args.runner_build, out, report)
                break
            except LaunchTimeout as timeout:
                if attempt == 2: raise AssertionError(f'{timeout} again after one clean retry') from timeout
                print(f'{timeout}; reinstalling, reseeding and running the regression once more', flush=True)
                report['launchTimeoutRetried'] = str(timeout)
                kept = out / 'attempt-1'; kept.mkdir()
                for item in [out / name for name in ATTEMPT_EVIDENCE] + list(out.glob('regression-fresh-launch-*.log')):
                    if item.exists(): shutil.move(str(item), str(kept / item.name))
                subprocess.run(['xcrun','simctl','terminate',udid,bundle], capture_output=True, timeout=60)
                run('xcrun','simctl','uninstall',udid,bundle)
                # 钥匙串不随卸载清掉（AI 会话、远端密钥都在里面）：第二轮也要从一台什么都没存过的设备开始。
                reset = subprocess.run(['xcrun','simctl','keychain',udid,'reset'], capture_output=True, text=True, timeout=60)
                if reset.returncode: print(f'Keychain reset failed ({reset.stderr.strip()}); retrying with the old keychain', flush=True)
    finally:
        (out/'result.json').write_text(json.dumps(report,indent=2)+'\n'); cleanup_simulator(udid,out)


if __name__=='__main__': main()
