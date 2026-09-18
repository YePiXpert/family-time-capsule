"""Synthetic, device-only fixtures; no HTTP fixture server or credentials."""
import hashlib
import json
import sqlite3
import struct
import zlib
from pathlib import Path


def empty():
    return dict(version=1, revision=0, welcome=True, profile=dict(name='小美', birthday='', avatarId=None),
                settings=dict(theme='auto', largeText=False), records={}, drafts={}, media={}, albums={}, selections={},
                series={}, persons={}, yearNotes={}, receivedShares=[])


def record(identifier, title, date='2026-09-15T10:00:00.000Z', media=None):
    return dict(id=identifier, title=title, text='今天的小小进步，值得好好记住。', date=date, location='', first=False,
                mediaIds=media or [], coverId=(media or [None])[0], revision=1, updatedAt=date)

ENTITY_KINDS = ('records', 'drafts', 'media', 'albums', 'selections', 'series', 'persons')


def write_state(database, state):
    """按应用当前的库结构落库：根一行，实体每条一行，旧版整库单行清空。"""
    root = {k: v for k, v in state.items() if k not in ENTITY_KINDS}
    with sqlite3.connect(database) as db:
        db.execute('DELETE FROM library')
        db.execute('DELETE FROM entity')
        db.execute('INSERT INTO root(id,json) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json',
                   (json.dumps(root, ensure_ascii=False),))
        for kind in ENTITY_KINDS:
            for identifier, entity in state.get(kind, {}).items():
                db.execute('INSERT INTO entity(kind,id,json) VALUES(?,?,?)',
                           (kind, identifier, json.dumps(entity, ensure_ascii=False)))


def write_legacy_state(database, state):
    """Build 62 及更早的整库单行快照，用来验开库切代。"""
    with sqlite3.connect(database) as db:
        db.execute('DELETE FROM entity')
        db.execute('DELETE FROM root')
        db.execute('INSERT INTO library(id,snapshot) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET snapshot=excluded.snapshot',
                   (json.dumps(state, ensure_ascii=False),))


def break_state(database):
    """把根写坏，模拟开库时资料读不出来。"""
    with sqlite3.connect(database) as db:
        db.execute("UPDATE root SET json='broken' WHERE id=1")


def broken_root(database):
    with sqlite3.connect(database) as db:
        return db.execute('SELECT json FROM root WHERE id=1').fetchone()[0]


def read_state(database):
    with sqlite3.connect(database) as db:
        assert db.execute('PRAGMA integrity_check').fetchone() == ('ok',)
        row = db.execute('SELECT json FROM root WHERE id=1').fetchone()
        if not row:
            return None
        state = json.loads(row[0])
        for kind in ENTITY_KINDS:
            state[kind] = {}
        for kind, identifier, raw in db.execute('SELECT kind,id,json FROM entity'):
            state.setdefault(kind, {})[identifier] = json.loads(raw)
        return state


def make_photo():
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)
    w, h = 480, 360
    pixels = b''.join(b'\x00' + b''.join(bytes((int(180 + 50*x/w), int(200-65*y/h), int(160+50*y/h))) for x in range(w)) for y in range(h))
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(pixels)) + chunk(b'IEND', b'')


def seed(container: Path, database: Path, records: int = 122):
    """records 是库内记录总数，含 fixture 与 earlier 两条固定记录。
    默认 122 条与原生冒烟的断言一致；量规模时传大数字，别改默认值。"""
    s = empty(); root = container / 'Documents' / 'xiaomei-v1'; media = root / 'media'; media.mkdir(parents=True, exist_ok=True)
    s['profile']['birthday'] = '2024-06-15'
    photo = make_photo(); (media / 'fixture.png').write_bytes(photo)
    s['media']['photo'] = dict(id='photo', file='fixture.png', name='Synthetic colors.png', kind='image', bytes=len(photo), sha256=hashlib.sha256(photo).hexdigest())
    s['records']['fixture'] = record('fixture', 'First little wave', media=['photo'])
    s['records']['earlier'] = record('earlier', 'Summer day', '2026-08-15T10:00:00.000Z')
    bulk = max(0, records - 2); width = max(3, len(str(max(0, bulk - 1))))
    for i in range(bulk):
        identifier = f'older-{i:0{width}d}'; s['records'][identifier] = record(identifier, f'Old memory {i:0{width}d}', '2025-01-15T10:00:00.000Z')
    write_state(database, s)
    backups = root / 'backups'; backups.mkdir(exist_ok=True)
    manifest = dict(format='xiaomei-local', version=1, createdAt='2026-09-15T10:00:00.000Z', library=s, mediaOrder=['photo'])
    raw = json.dumps(manifest, ensure_ascii=False).encode()
    (backups / 'baseline.xmb').write_bytes(b'XIAOMEI1' + struct.pack('>I', len(raw)) + raw + photo)
    return s
