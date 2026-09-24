#!/usr/bin/env python3
"""可执行的手机端「宪法」：本机记录离线、联网只在三个传输文件里、服务地址只有一处。

规则（违反即返回一条人话说明；空列表 = 通过）：
1. `fetch(`／`XMLHttpRequest(`／`WebSocket(` 只允许出现在 NETWORK_FILES 里（AI 客户端、同步传输层、家庭与设备）。
2. 任何 src 文件都不得含子串 `serverUrl`、`credentials`——本机记录不认识账号这回事。
3. `src/local/**` 里只有 LOCAL_MAY_IMPORT_SYNC 列出的两个界面文件可以 import `../sync/` 或 `../family/`：
   同步与家庭授权只走 `src/sync`、`src/family`，本机记录、备份与恢复的代码路径里没有网络。
4. package.json 不得带 FORBIDDEN_DEPENDENCIES（服务端框架、账号库、网络探测）。
5. 服务地址字面量只出现在 `src/local/brand.ts`（`SERVICE_URL`），其余文件都从那里 import。
6. `src/sync/**`、`src/ai/**` 与 `src/family/**` 不得 import `../local/<name>` 对应的 .tsx 页面组件；
   仅共享 ui、context 例外（SHARED_LOCAL_TSX），.ts 数据与工具模块不受限。
"""
import json
import re
from pathlib import Path

NETWORK_FILES = ('src/ai/client.ts', 'src/sync/transport.ts', 'src/family/api.ts')
NETWORK_CALL = re.compile(r'\b(fetch|XMLHttpRequest|WebSocket)\s*\(')
ACCOUNT_WORDS = ('serverUrl', 'credentials')
SHARED_LOCAL_TSX = ('ui', 'context')
LOCAL_TSX_IMPORT = re.compile(r'''from\s+["']\.\./local/([^/"']+)["']''')
LOCAL_MAY_IMPORT_SYNC = ('src/local/App.tsx', 'src/local/Settings.tsx')
SYNC_IMPORT = re.compile(r'''from\s+["']\.\./(sync|family)/''')
FORBIDDEN_DEPENDENCIES = {'next', 'better-auth', 'drizzle-orm', 'expo-network'}
SERVICE_URL = 'https://capsule.yep.li/api/v1'
SERVICE_URL_FILE = 'src/local/brand.ts'


def source_files(root: Path):
    for file in sorted((root / 'src').rglob('*')):
        if file.suffix in ('.ts', '.tsx'):
            yield file


def check(root: Path) -> list[str]:
    root = Path(root)
    problems: list[str] = []
    for file in source_files(root):
        relative = file.relative_to(root).as_posix()
        text = file.read_text(encoding='utf-8')
        if relative not in NETWORK_FILES and NETWORK_CALL.search(text):
            problems.append(f'Networking outside the transport files: {relative}')
        for word in ACCOUNT_WORDS:
            if word in text:
                problems.append(f'Account dependency ({word}) in {relative}')
        if relative.startswith('src/local/') and relative not in LOCAL_MAY_IMPORT_SYNC and SYNC_IMPORT.search(text):
            problems.append(f'src/local may not import src/sync or src/family: {relative}')
        if relative.startswith(('src/sync/', 'src/ai/', 'src/family/')):
            for name in LOCAL_TSX_IMPORT.findall(text):
                if name not in SHARED_LOCAL_TSX and (root / 'src/local' / f'{name}.tsx').is_file():
                    problems.append(f'Feature module imports a local page component: {relative} -> src/local/{name}.tsx')
        if SERVICE_URL in text and relative != SERVICE_URL_FILE:
            problems.append(f'Service address literal outside {SERVICE_URL_FILE}: {relative}')
    brand = root / SERVICE_URL_FILE
    if not brand.exists() or SERVICE_URL not in brand.read_text(encoding='utf-8'):
        problems.append(f'{SERVICE_URL_FILE} must define SERVICE_URL = {SERVICE_URL}')
    package_file = root / 'package.json'
    if package_file.exists():
        package = json.loads(package_file.read_text(encoding='utf-8'))
        banned = FORBIDDEN_DEPENDENCIES & set(package.get('dependencies', {}))
        if banned:
            problems.append(f'Forbidden dependencies: {", ".join(sorted(banned))}')
    return problems


def main(root: Path) -> int:
    problems = check(root)
    for problem in problems:
        print(problem)
    if problems:
        return 1
    print('Offline journal, isolated transport files and single service address verified; feature modules stay off the page components.')
    return 0
