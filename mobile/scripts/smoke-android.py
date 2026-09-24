#!/usr/bin/env python3
"""Exercise the delivered Release APK offline via Android's accessibility hierarchy."""
import argparse
import json
import os
from pathlib import Path
import time
import xml.etree.ElementTree as ET
from android_ui import PACKAGE as package, adb, find, hierarchy, screencap, scrolls_around, seek, stats, tap, tap_last, tap_seek, tap_shelf, wait_until_drawn

p=argparse.ArgumentParser();p.add_argument('apk');p.add_argument('--output',type=Path,required=True);args=p.parse_args();args.output.mkdir(parents=True,exist_ok=True)
def shot(name,fresh=False):
    (args.output/f'{name}.png').write_bytes(screencap())
    (args.output/f'{name}.xml').write_text(ET.tostring(hierarchy(fresh),encoding='unicode'))
def launch(): adb('shell','am','start','-W','-n',package+'/.MainActivity');wait_until_drawn()
def restart(): adb('shell','am','force-stop',package);launch()
def assert_fits(sheet):
    # 一屏一张纸的页面（编辑、写信）键盘收着时不能上下滑；键盘收起有动画，多看几次。
    for attempt in range(5):
        if not scrolls_around(hierarchy(fresh=attempt>0),sheet): return
        time.sleep(1)
    shot(f'{sheet}-scrolls',fresh=True);raise AssertionError(f'{sheet} is taller than its scroll area with the keyboard down')
def write(text): adb('shell','input','text',text.replace(' ','%s'));time.sleep(1)
started=time.monotonic()
def phase(name):
    # 分段耗时只打日志，下一轮据此判断时间花在哪；dump 次数与耗时见 android_ui。
    print(f"{name}: {time.monotonic()-started:.0f}s, {stats['dumps']} dumps ({stats['dumpSeconds']:.0f}s)",flush=True)
report=dict(gitSha=os.environ.get('SOURCE_SHA'),success=False)
month=time.strftime('%Y-%m')
try:
    adb('install','-r',args.apk);phase('Installed')
    adb('shell','svc','wifi','disable');adb('shell','svc','data','disable')
    adb('shell','wm','size','390x844');adb('shell','wm','density','160')
    launch();tap('welcome-start');shot('home-390');phase('Welcome')
    tap('capture-new');find('说一段');tap('capture-text');write('Offline little story.');find('AI 助手');adb('shell','input','keyevent','4');shot('editor')
    # 键盘收起后编辑页一屏放下、不能上下滑（1.0.5 出包：纸比滚动区高出一截，整页还能滑）。
    assert_fits('editor-sheet');report['editorFits']=True
    restart();tap('继续编辑');assert find('capture-text').get('text')=='Offline little story.'
    tap('editor-by');tap('editor-by-爸爸');tap('capture-save');find('record-edit');assert find('record-by').get('text')=='—— 爸爸';shot('record-reading')
    tap('record-edit');tap('capture-text');adb('shell','input','keyevent','KEYCODE_MOVE_END');write(' More.');adb('shell','input','keyevent','4');tap('capture-save');find('record-edit');assert find('record-by').get('text')=='—— 爸爸';phase('Record and draft')
    restart();find(f'volume-{month}');find(f"volume-year-{time.strftime('%Y')}");shot('home-recent');tap_seek('album-new')
    tree=hierarchy(); row=next(n for n in tree.iter('node') if n.get('resource-id','').startswith('record-'));tap(row.get('resource-id'));shot('selection')
    tap('material-done');tap('album-name');write('Our days');adb('shell','input','keyevent','4');tap('album-save');find('album-reading');shot('album-reading')
    restart();tap_shelf('Our days');find('album-reading');phase('Album')
    # 时间胶囊：写一封信 → 封存 → 重启后书架仍在 → 打开是「还没到日子」的信封 → 提前拆封能读到正文。
    # 首页一屏放下、不能上下滑：相册与信在书架横条上，找不到就横着拖（tap_shelf）。
    restart();tap_seek('letter-new');tap('letter-title');write('Letter for later');adb('shell','input','keyevent','4')
    tap('letter-text');write('Words kept for the future.');adb('shell','input','keyevent','4');shot('letter-editor')
    assert_fits('letter-sheet');report['letterFits']=True
    tap_seek('letter-seal');tap_last('封存');find('还没到日子');find('letter-open-early');shot('letter-sealed')
    restart();tap_shelf('Letter for later');find('还没到日子')
    tap('letter-open-early');tap_last('拆开');find('Words kept for the future.');shot('letter-opened');letterSealed=True;phase('Letter')
    # 改分辨率后先等书架按新宽度画好再截图。
    restart();adb('shell','wm','size','320x720');find('我的');shot('home-320')
    tap('我的');tap('AI 设置');find('ai-join');shot('ai-settings-offline-320');adb('shell','input','keyevent','4')
    # 家庭与设备：没加入时「加入已有家庭／开始一个家庭／用恢复码找回」，不联网也打得开。
    tap('家庭与设备');find('family-out');find('family-join');find('family-recover');shot('family-out-320');familyOffline=True;adb('shell','input','keyevent','4')
    tap('外观设置');tap('深色');shot('dark-320')
    # 远端备份卡：没加入家庭时只有一句说明与「去加入家庭」，没有任何上传入口。
    restart();tap('我的');tap('备份与恢复');seek('remote-card');seek('remote-family');shot('backup-remote-offline');remoteCardOffline=True;phase('Settings')
    # 备份闭环：导出 → 删一条记录 → 从本机保留的备份恢复 → 内容还原。
    restart();tap('我的');tap('备份与恢复');tap('backup-export')
    time.sleep(3);adb('shell','input','keyevent','4');time.sleep(1)  # 退出系统分享面板
    # 开放归档：真写一份 zip 出来，必须在系统分享面板里看到 zip 文件名。
    tap_seek('archive-export')
    deadline=time.monotonic()+300
    while time.monotonic()<deadline:
        tree=hierarchy(fresh=True)
        broken=[n.get('text') for n in tree.iter('node') if any(w in (n.get('text') or '') for w in ('失败','不够','缺失','损坏'))]
        assert not broken,f'Archive export reported {broken}'
        if any(n.get('package')=='com.android.intentresolver' and (n.get('text') or '').startswith('桉桉成长记归档-') and (n.get('text') or '').endswith('.zip') for n in tree.iter('node')):
            break
        time.sleep(1)
    else:raise AssertionError('Archive share sheet never appeared')
    shot('archive-share-sheet');adb('shell','input','keyevent','4');time.sleep(2);archiveSheet=True;phase('Backup export and archive')
    restart();tap(f'volume-{month}')
    tree=hierarchy(); row=next(n for n in tree.iter('node') if n.get('resource-id','').startswith('record-'));tap(row.get('resource-id'))
    tap('删除记录');tap_last('删除记录')
    restart();tap('我的');tap('备份与恢复');tap_seek('恢复这份备份');tap('恢复并替换')
    find('恢复完成。')
    restart();tap(f'volume-{month}')
    tree=hierarchy(); row=next(n for n in tree.iter('node') if n.get('resource-id','').startswith('record-'));tap(row.get('resource-id'))
    find('Offline little story. More.');shot('backup-roundtrip');phase('Restore')
    tap('keepsake-make');time.sleep(4);shot('keepsake-share-sheet');adb('shell','input','keyevent','4')
    find('record-edit')
    restart();tap(f"volume-year-{time.strftime('%Y')}")
    # 纪念册：一页 300 DPI 是 2433² 位图，安卓这一步最吃内存，必须真装订一本出来。
    tap('year-yearbook');tap('纪念册 PDF')
    tap('book-preview-next');shot('book-preview');tap('book-preview-bind')
    # 小册子可能在第一次 dump 之前就完成，不能要求观察到短暂的进度按钮。
    # 必须看到系统分享面板里的 PDF 文件名，进度消失或页面无报错都不算成功。
    deadline=time.monotonic()+300
    while time.monotonic()<deadline:
        tree=hierarchy(fresh=True)
        broken=[n.get('text') for n in tree.iter('node') if any(w in (n.get('text') or '') for w in ('失败','超时','还没准备好','尚未就绪'))]
        assert not broken,f'Book export reported {broken}'
        if any(n.get('package')=='com.android.intentresolver' and n.get('text')==f"yearbook-{time.strftime('%Y')}.pdf" for n in tree.iter('node')):
            break
        time.sleep(1)
    else:raise AssertionError('Book PDF share sheet never appeared')
    shot('book-share-sheet');adb('shell','input','keyevent','4');time.sleep(2)
    # 导出失败只在页面上留一行红字，截图看不出来，显式断言。
    broken=[n.get('text') for n in hierarchy().iter('node') if any(w in (n.get('text') or '') for w in ('失败','超时','尚未就绪'))]
    assert not broken,f'Book export reported {broken}'
    find('year-yearbook');bookExport=True;phase('Yearbook')
    report.update(success=True,offlineStartup=True,draftRecovered=True,albumSurvivedRelaunch=True,aiSettingsOffline=True,backupRoundtrip=True,remoteCardOffline=remoteCardOffline,familyOffline=familyOffline,keepsakeCard=True,yearbookBook=bookExport,letterSealed=letterSealed,archiveSheet=archiveSheet,widths=[320,390])
finally:
    report['timing']=dict(seconds=round(time.monotonic()-started),dumps=stats['dumps'],dumpSeconds=round(stats['dumpSeconds']))
    shot('final',fresh=True)
    (args.output/'result.json').write_text(json.dumps(report,indent=2)+'\n')
    (args.output/'logcat.txt').write_text(adb('logcat','-d','-t','1500'))
