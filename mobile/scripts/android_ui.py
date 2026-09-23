"""Android accessibility-hierarchy helpers for the Release smoke; adb only, no network.

uiautomator 每次 dump 都要起一个进程、再等界面静止满 1 秒，一次两三秒，是安卓冒烟里最大的开销
（run 35832730488：冒烟脚本 6.1 分钟，一百多次 dump）。所以最近一次 dump 留在缓存里：此后只要
没有发过任何输入，同一屏的查找直接用它；一有输入（点、滑、打字、启动、改分辨率）就作废。
等界面自己变化的轮询必须 fresh=True，否则会一直看着同一份旧层级。
"""
import re
import subprocess
import time
import xml.etree.ElementTree as ET

PACKAGE = 'app.familytimecapsule.mobile'
# 这些 adb 命令只读，不改变屏幕；其余一律当作输入。
READ_ONLY = (('shell', 'uiautomator'), ('shell', 'cat'), ('logcat',))
_tree = None
stats = {'dumps': 0, 'dumpSeconds': 0.0}


def adb(*args):
    global _tree
    if not any(args[:len(prefix)] == prefix for prefix in READ_ONLY):
        _tree = None
    return subprocess.check_output(['adb', *args], timeout=60).decode(errors='replace')


def screencap():
    return subprocess.check_output(['adb', 'exec-out', 'screencap', '-p'], timeout=60)


def bounds(node):
    """[left, top, right, bottom]；uiautomator 给的是屏幕上露出的那一截。"""
    return list(map(int, re.findall(r'\d+', node.attrib['bounds'])))


def center(node):
    nums = bounds(node)
    return (nums[0] + nums[2]) // 2, (nums[1] + nums[3]) // 2


def dismiss_other_anr(tree):
    # 冷启动的模拟器上系统桌面偶尔「isn't responding」，弹窗盖住应用，dump 里只剩它
    # （run 35813660997：欢迎页好好的，找不到 welcome-start）。别的应用的无响应框点「Wait」接着测；
    # 本应用自己无响应是真问题，不点，留给后面的查找判失败、截图留证。
    wait = next((n for n in tree.iter('node') if n.get('resource-id') == 'android:id/aerr_wait'), None)
    if wait is None:
        return False
    title = ' '.join(n.get('text') or '' for n in tree.iter('node') if n.get('resource-id') == 'android:id/alertTitle')
    if '桉桉成长记' in title or PACKAGE in title:
        return False
    x, y = center(wait)
    adb('shell', 'input', 'tap', str(x), str(y))
    print(f'Dismissed system dialog: {title}', flush=True)
    time.sleep(2)
    return True


def hierarchy(fresh=False):
    """当前屏幕的无障碍层级；fresh=False 时，上次 dump 之后没有输入就直接复用。"""
    global _tree
    if _tree is not None and not fresh:
        return _tree
    # 冷启动或改分辨率后 dump 可能失败一两次；重试避免把环境抖动当代码红。
    last = None
    for _ in range(5):
        started = time.monotonic()
        try:
            adb('shell', 'uiautomator', 'dump', '/sdcard/window.xml')
            tree = ET.fromstring(adb('shell', 'cat', '/sdcard/window.xml'))
        except Exception as error:
            tree, last = None, error
        stats['dumps'] += 1
        stats['dumpSeconds'] += time.monotonic() - started
        if tree is None:
            time.sleep(2)
        elif not dismiss_other_anr(tree):
            _tree = tree
            return tree
    if last is None:
        raise AssertionError('A system dialog kept covering the app')
    raise last


def matches(node, label):
    rid = node.get('resource-id', '')
    desc = node.get('content-desc', '')
    # 书架 Volume 的标题常被折叠成「标题，副题」复合 desc（贴屏底时文本节点还会被裁掉），
    # 因此前缀匹配复合标签；testID 仍走 resource-id。
    return rid.endswith(label) or node.get('text') == label or desc == label or desc.startswith(label + '，')


def first_match(tree, label):
    return next((node for node in tree.iter('node') if matches(node, label)), None)


def find(label, tries=30):
    for attempt in range(tries):
        cached = attempt == 0 and _tree is not None
        node = first_match(hierarchy(fresh=attempt > 0), label)
        if node is not None:
            return node
        # 缓存里没有就马上重新 dump；新 dump 里也没有才等一秒。
        if not cached:
            time.sleep(1)
    raise AssertionError(f'Missing {label}')


def tap_node(node):
    x, y = center(node)
    adb('shell', 'input', 'tap', str(x), str(y))
    time.sleep(1)
    return node


def tap(label):
    return tap_node(find(label))


def tap_last(label, tries=15):
    # 确认对话框与页面元素同名时，取层级里最后一个（对话框在最后）。
    for attempt in range(tries):
        cached = attempt == 0 and _tree is not None
        nodes = [n for n in hierarchy(fresh=attempt > 0).iter('node') if matches(n, label)]
        if nodes:
            return tap_node(nodes[-1])
        if not cached:
            time.sleep(1)
    raise AssertionError(f'Missing {label}')


def seek(label, tries=6):
    # 书架与长表单里目标可能在首屏之外：uiautomator 只 dump 看得见的节点，找不到就向下滑再找。
    # 只在新 dump 里也找不到时才滑：缓存的那一屏可能是应用还没画完的时候，滑了会把目标滑走。
    for _ in range(tries):
        cached = _tree is not None
        node = first_match(hierarchy(), label)
        if node is None and cached:
            node = first_match(hierarchy(fresh=True), label)
        if node is not None:
            return node
        adb('shell', 'input', 'swipe', '200', '650', '200', '250', '300')
        time.sleep(1)
    raise AssertionError(f'Missing {label}')


def tap_seek(label, tries=6):
    return tap_node(seek(label, tries))


# 露出不到这么宽（像素）的书当作还在屏幕外：点在一窄条的中心容易落到条外。
SHELF_MIN_VISIBLE = 40


def seek_shelf(label, tries=6):
    """首页一屏放下、不能上下滑：年份、月册、相册与信都在书架（shelf-strip）这一条横着翻的小封面上。
    目标不在屏幕上、或只露出一窄条时，在书架那一行从右往左拖一下再找。与 seek 一样，缓存里没有就先
    重新 dump 一次再拖，免得缓存是应用还没画完的一屏。"""
    for _ in range(tries):
        cached = _tree is not None
        node = first_match(hierarchy(), label)
        if node is None and cached:
            node = first_match(hierarchy(fresh=True), label)
        if node is not None:
            left, _, right, _ = bounds(node)
            if right - left >= SHELF_MIN_VISIBLE:
                return node
        strip = first_match(hierarchy(), 'shelf-strip')
        if strip is None:
            raise AssertionError(f'Missing shelf-strip while looking for {label}')
        left, top, right, bottom = bounds(strip)
        y = (top + bottom) // 2
        adb('shell', 'input', 'swipe', str(right - 40), str(y), str(left + 40), str(y), '400')
        time.sleep(1)
    raise AssertionError(f'Missing {label}')


def tap_shelf(label, tries=6):
    return tap_node(seek_shelf(label, tries))


def wait_until_drawn(timeout=60):
    """am start -W 只等到首帧；再等应用画出带文字的界面（启动画面没有文字）。
    原来固定睡 4 秒。这次 dump 留在缓存里，接下来的查找直接复用。"""
    deadline = time.monotonic() + timeout
    while True:
        tree = hierarchy(fresh=True)
        if any(n.get('package') == PACKAGE and (n.get('text') or n.get('content-desc')) for n in tree.iter('node')):
            return tree
        if time.monotonic() > deadline:
            raise AssertionError('App did not draw its first screen')
        time.sleep(1)
