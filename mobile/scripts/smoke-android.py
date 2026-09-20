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
  # 冷启动或改分辨率后 dump 可能失败一两次；重试避免把环境抖动当代码红。
  last:Exception|None=None
  for _ in range(3):
    try:
      adb('shell','uiautomator','dump','/sdcard/window.xml')
      return ET.fromstring(adb('shell','cat','/sdcard/window.xml'))
    except Exception as e:
      last=e;time.sleep(2)
  raise last
def matches(node,label):
  rid=node.get('resource-id','')
  desc=node.get('content-desc','')
  # 书架 Volume 的标题常被折叠成「标题，副题」复合 desc（贴屏底时文本节点还会被裁掉），
  # 因此前缀匹配复合标签；testID 仍走 resource-id。
  return rid.endswith(label) or node.get('text')==label or desc==label or desc.startswith(label+'，')
def find(label):
  for _ in range(30):
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
def tap_seek(label,tries=6):
    # 书架与长表单里目标可能在首屏之外：uiautomator 只 dump 看得见的节点，找不到就向下滑再找。
    for _ in range(tries):
        for node in hierarchy().iter('node'):
            if matches(node,label):
                nums=list(map(int,re.findall(r'\d+',node.attrib['bounds'])));x=(nums[0]+nums[2])//2;y=(nums[1]+nums[3])//2;adb('shell','input','tap',str(x),str(y));time.sleep(1);return node
        adb('shell','input','swipe','200','650','200','250','300');time.sleep(1)
    raise AssertionError(f'Missing {label}')
def shot(name):
    (args.output/f'{name}.png').write_bytes(subprocess.check_output(['adb','exec-out','screencap','-p']))
    (args.output/f'{name}.xml').write_text(ET.tostring(hierarchy(),encoding='unicode'))
def launch(): adb('shell','am','start','-W','-n',package+'/.MainActivity');time.sleep(4)
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
    # 时间胶囊：写一封信 → 封存 → 重启后书架仍在 → 打开是「还没到日子」的信封 → 提前拆封能读到正文。
    restart();tap_seek('letter-new');tap('letter-title');write('Letter for later');adb('shell','input','keyevent','4')
    tap('letter-text');write('Words kept for the future.');adb('shell','input','keyevent','4')
    tap_seek('letter-seal');tap_last('封存');find('还没到日子');find('letter-open-early');shot('letter-sealed')
    restart();tap_seek('Letter for later');find('还没到日子')
    tap('letter-open-early');tap_last('拆开');find('Words kept for the future.');shot('letter-opened');letterSealed=True
    restart();adb('shell','wm','size','320x720');shot('home-320')
    tap('我的');tap('AI 设置');find('ai-join');shot('ai-settings-offline-320');adb('shell','input','keyevent','4')
    tap('外观设置');tap('深色');shot('dark-320')
    # 备份闭环：导出 → 删一条记录 → 从本机保留的备份恢复 → 内容还原。
    restart();tap('我的');tap('备份与恢复');tap('backup-export')
    time.sleep(3);adb('shell','input','keyevent','4');time.sleep(1)  # 退出系统分享面板
    # 开放归档：真写一份 zip 出来，必须在系统分享面板里看到 zip 文件名。
    tap_seek('archive-export')
    deadline=time.monotonic()+300
    while time.monotonic()<deadline:
        tree=hierarchy()
        broken=[n.get('text') for n in tree.iter('node') if any(w in (n.get('text') or '') for w in ('失败','不够','缺失','损坏'))]
        assert not broken,f'Archive export reported {broken}'
        if any(n.get('package')=='com.android.intentresolver' and (n.get('text') or '').startswith('桉桉成长记归档-') and (n.get('text') or '').endswith('.zip') for n in tree.iter('node')):
            break
        time.sleep(1)
    else:raise AssertionError('Archive share sheet never appeared')
    shot('archive-share-sheet');adb('shell','input','keyevent','4');time.sleep(2);archiveSheet=True
    restart();tap(f'volume-{month}')
    tree=hierarchy(); row=next(n for n in tree.iter('node') if n.get('resource-id','').startswith('record-'));tap(row.get('resource-id'))
    tap('删除记录');tap_last('删除记录')
    restart();tap('我的');tap('备份与恢复');tap_seek('恢复这份备份');tap('恢复并替换')
    find('恢复完成。')
    restart();tap(f'volume-{month}')
    tree=hierarchy(); row=next(n for n in tree.iter('node') if n.get('resource-id','').startswith('record-'));tap(row.get('resource-id'))
    find('Offline little story. More.');shot('backup-roundtrip')
    tap('keepsake-make');time.sleep(4);shot('keepsake-share-sheet');adb('shell','input','keyevent','4')
    find('record-edit')
    restart();tap(f"volume-year-{time.strftime('%Y')}")
    tap('year-yearbook');tap('长图');time.sleep(8);shot('yearbook-share-sheet');adb('shell','input','keyevent','4')
    find('year-yearbook');yearbookExport=True
    # 纪念册：一页 300 DPI 是 2433² 位图，安卓这一步最吃内存，必须真装订一本出来。
    tap('year-yearbook');tap('纪念册 PDF')
    tap('book-preview-next');shot('book-preview');tap('book-preview-bind')
    # 小册子可能在第一次 dump 之前就完成，不能要求观察到短暂的进度按钮。
    # 必须看到系统分享面板里的 PDF 文件名，进度消失或页面无报错都不算成功。
    deadline=time.monotonic()+300
    while time.monotonic()<deadline:
        tree=hierarchy()
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
    find('year-yearbook');bookExport=True
    report.update(success=True,offlineStartup=True,draftRecovered=True,albumSurvivedRelaunch=True,aiSettingsOffline=True,backupRoundtrip=True,keepsakeCard=True,yearbookSheet=yearbookExport,yearbookBook=bookExport,letterSealed=letterSealed,archiveSheet=archiveSheet,widths=[320,390])
finally:
    shot('final')
    (args.output/'result.json').write_text(json.dumps(report,indent=2)+'\n')
    (args.output/'logcat.txt').write_text(adb('logcat','-d','-t','1500'))
