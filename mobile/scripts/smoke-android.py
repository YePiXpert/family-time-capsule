#!/usr/bin/env python3
"""Exercise the delivered Release APK offline via Android's accessibility hierarchy."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import time
import xml.etree.ElementTree as ET

p=argparse.ArgumentParser();p.add_argument('apk');p.add_argument('--output',type=Path,required=True);args=p.parse_args();args.output.mkdir(parents=True,exist_ok=True)
package='app.familytimecapsule.mobile'
def adb(*args): return subprocess.check_output(['adb',*args],timeout=60).decode(errors='replace')
def hierarchy():
    adb('shell','uiautomator','dump','/sdcard/window.xml')
    return ET.fromstring(adb('shell','cat','/sdcard/window.xml'))
def matches(node,label): return node.get('resource-id','').endswith(label) or node.get('text')==label or node.get('content-desc')==label
def find(label):
    for _ in range(15):
        tree=hierarchy()
        for node in tree.iter('node'):
            if matches(node,label):return node
        time.sleep(1)
    raise AssertionError(f'Missing {label}')
def tap(label):
    node=find(label); nums=list(map(int,re.findall(r'\d+',node.attrib['bounds']))); x=(nums[0]+nums[2])//2;y=(nums[1]+nums[3])//2;adb('shell','input','tap',str(x),str(y));time.sleep(1)
def tap_last(label):
    # 确认对话框与页面元素同名时，取层级里最后一个（对话框在最后）。
    node=None
    for _ in range(15):
        tree=hierarchy();nodes=[n for n in tree.iter('node') if matches(n,label)]
        if nodes:node=nodes[-1];break
        time.sleep(1)
    if node is None:raise AssertionError(f'Missing {label}')
    nums=list(map(int,re.findall(r'\d+',node.attrib['bounds'])));x=(nums[0]+nums[2])//2;y=(nums[1]+nums[3])//2;adb('shell','input','tap',str(x),str(y));time.sleep(1)
def shot(name):
    (args.output/f'{name}.png').write_bytes(subprocess.check_output(['adb','exec-out','screencap','-p']))
    (args.output/f'{name}.xml').write_text(ET.tostring(hierarchy(),encoding='unicode'))
def launch(): adb('shell','am','start','-n',package+'/.MainActivity');time.sleep(3)
def restart(): adb('shell','am','force-stop',package);launch()
def write(text): adb('shell','input','text',text.replace(' ','%s'));time.sleep(1)
report=dict(gitSha=os.environ.get('SOURCE_SHA'),success=False)
month=time.strftime('%Y-%m')
try:
    adb('install','-r',args.apk)
    adb('shell','svc','wifi','disable');adb('shell','svc','data','disable')
    adb('shell','wm','size','390x844');adb('shell','wm','density','160')
    launch();tap('welcome-start');shot('home-390')
    tap('capture-new');tap('capture-text');write('Offline little story.');find('AI 助手');adb('shell','input','keyevent','4');shot('editor')
    restart();tap('继续编辑');assert find('capture-text').get('text')=='Offline little story.'
    tap('capture-save');find('record-edit');shot('record-reading')
    tap('record-edit');tap('capture-text');adb('shell','input','keyevent','KEYCODE_MOVE_END');write(' More.');adb('shell','input','keyevent','4');tap('capture-save');find('record-edit')
    restart();find(f'volume-{month}');find(f"volume-year-{time.strftime('%Y')}");tap('album-new')
    tree=hierarchy(); row=next(n for n in tree.iter('node') if n.get('resource-id','').startswith('record-'));tap(row.get('resource-id'));shot('selection')
    tap('material-done');tap('album-name');write('Our days');adb('shell','input','keyevent','4');tap('album-save');find('album-reading');shot('album-reading')
    restart();tap('Our days');find('album-reading')
    restart();adb('shell','wm','size','320x720');shot('home-320')
    tap('打开设置');tap('AI 设置');find('加入 AI 服务');shot('ai-settings-offline-320');adb('shell','input','keyevent','4')
    tap('外观设置');tap('深色');shot('dark-320')
    # 备份闭环：导出 → 删一条记录 → 从本机保留的备份恢复 → 内容还原。
    restart();tap('打开设置');tap('备份与恢复');tap('backup-export')
    time.sleep(3);adb('shell','input','keyevent','4');time.sleep(1)  # 退出系统分享面板
    restart();tap(f'volume-{month}')
    tree=hierarchy(); row=next(n for n in tree.iter('node') if n.get('resource-id','').startswith('record-'));tap(row.get('resource-id'))
    tap('删除记录');tap_last('删除记录')
    restart();tap('打开设置');tap('备份与恢复');tap('恢复这份备份');tap('恢复并替换')
    find('恢复完成。')
    restart();tap(f'volume-{month}')
    tree=hierarchy(); row=next(n for n in tree.iter('node') if n.get('resource-id','').startswith('record-'));tap(row.get('resource-id'))
    find('Offline little story. More.');shot('backup-roundtrip')
    tap('keepsake-make');time.sleep(4);shot('keepsake-share-sheet');adb('shell','input','keyevent','4')
    find('record-edit')
    report.update(success=True,offlineStartup=True,draftRecovered=True,albumSurvivedRelaunch=True,aiSettingsOffline=True,backupRoundtrip=True,keepsakeCard=True,widths=[320,390])
finally:
    shot('final')
    (args.output/'result.json').write_text(json.dumps(report,indent=2)+'\n')
    (args.output/'logcat.txt').write_text(adb('logcat','-d','-t','1500'))
