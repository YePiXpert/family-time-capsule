#!/usr/bin/env python3
"""Keep optional AI transport isolated from the offline journal and backup."""
import json
from pathlib import Path
import re
root=Path(__file__).resolve().parents[1]
for file in (root/'src').rglob('*'):
    if file.suffix not in ('.ts','.tsx'):continue
    text=file.read_text(encoding='utf-8')
    if file != root/'src'/'ai'/'client.ts':
        assert not re.search(r'\b(fetch|XMLHttpRequest|WebSocket)\s*\(',text), f'Networking outside AI client: {file}'
    assert 'serverUrl' not in text and 'credentials' not in text, f'Account dependency in {file}'
package=json.loads((root/'package.json').read_text(encoding='utf-8'))
assert not {'next','better-auth','drizzle-orm','expo-network'} & package['dependencies'].keys()
assert 'https://capsule.yep.li/api/v1' in (root/'src'/'ai'/'client.ts').read_text(encoding='utf-8')
print('Offline journal and isolated AI transport verified.')
