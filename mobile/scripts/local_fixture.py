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
                yearNotes={}, receivedShares=[])


def record(identifier, title, date='2026-09-15T10:00:00.000Z', media=None):
    return dict(id=identifier, title=title, text='今天的小小进步，值得好好记住。', date=date, location='', first=False,
                mediaIds=media or [], coverId=(media or [None])[0], revision=1, updatedAt=date)


def write_state(database, state):
    with sqlite3.connect(database) as db:
        db.execute('UPDATE library SET snapshot=? WHERE id=1', (json.dumps(state, ensure_ascii=False),))


def read_state(database):
    with sqlite3.connect(database) as db:
        assert db.execute('PRAGMA integrity_check').fetchone() == ('ok',)
        return json.loads(db.execute('SELECT snapshot FROM library WHERE id=1').fetchone()[0])


def make_photo():
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)
    w, h = 480, 360
    pixels = b''.join(b'\x00' + b''.join(bytes((int(180 + 50*x/w), int(200-65*y/h), int(160+50*y/h))) for x in range(w)) for y in range(h))
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(pixels)) + chunk(b'IEND', b'')


def seed(container: Path, database: Path):
    s = empty(); root = container / 'Documents' / 'xiaomei-v1'; media = root / 'media'; media.mkdir(parents=True, exist_ok=True)
    photo = make_photo(); (media / 'fixture.png').write_bytes(photo)
    s['media']['photo'] = dict(id='photo', file='fixture.png', name='Synthetic colors.png', kind='image', bytes=len(photo), sha256=hashlib.sha256(photo).hexdigest())
    s['records']['fixture'] = record('fixture', 'First little wave', media=['photo'])
    s['records']['earlier'] = record('earlier', 'Summer day', '2026-08-15T10:00:00.000Z')
    for i in range(120):
        identifier = f'older-{i:03d}'; s['records'][identifier] = record(identifier, f'Old memory {i:03d}', '2025-01-15T10:00:00.000Z')
    write_state(database, s)
    backups = root / 'backups'; backups.mkdir(exist_ok=True)
    manifest = dict(format='xiaomei-local', version=1, createdAt='2026-09-15T10:00:00.000Z', library=s, mediaOrder=['photo'])
    raw = json.dumps(manifest, ensure_ascii=False).encode()
    (backups / 'baseline.xmb').write_bytes(b'XIAOMEI1' + struct.pack('>I', len(raw)) + raw + photo)
    return s
