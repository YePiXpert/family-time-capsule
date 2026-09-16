#!/usr/bin/env python3
"""Reject reintroduction of runtime business networking or server dependencies."""
import json
from pathlib import Path
import re
root=Path(__file__).resolve().parents[1]
for file in (root/'src').rglob('*'):
    if file.suffix not in ('.ts','.tsx'):continue
    text=file.read_text()
    assert not re.search(r'\b(fetch|XMLHttpRequest|WebSocket)\s*\(',text), f'Runtime networking in {file}'
    assert 'serverUrl' not in text and 'credentials' not in text, f'Account dependency in {file}'
package=json.loads((root/'package.json').read_text())
assert not {'next','better-auth','drizzle-orm','expo-secure-store','expo-network'} & package['dependencies'].keys()
print('Device-only runtime boundary verified.')
