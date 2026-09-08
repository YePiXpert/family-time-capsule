#!/usr/bin/env python3
"""Fictional-only private upload/restart smoke in a newly labeled Docker volume."""
import argparse
import base64
import hashlib
import io
import json
import os
import subprocess
import time
import urllib.error
import urllib.request
import uuid
import zipfile

parser = argparse.ArgumentParser()
parser.add_argument('--image', required=True)
args = parser.parse_args()
identity = str(uuid.uuid4())
name = 'ftc-private-smoke-' + identity
volume = name + '-data'
label = 'ftc.test.identity=' + identity
prefix = ['docker'] if os.geteuid() == 0 else ['sudo', '-n', 'docker']

def docker(*arguments):
    return subprocess.check_output(prefix + list(arguments), text=True).strip()

def owned(kind, resource):
    data = json.loads(docker(kind, 'inspect', resource))[0]
    labels = data.get('Labels') if kind == 'volume' else data['Config'].get('Labels')
    return labels and labels.get('ftc.test.identity') == identity

base = ''
token = 'synthetic-a-' + identity
other = 'synthetic-b-' + identity

def request(method, route, data=None, actor=token, headers=None):
    body = json.dumps(data).encode() if isinstance(data, dict) else data
    extra = {'authorization': 'Bearer ' + actor, 'content-type': 'application/json'}
    extra.update(headers or {})
    req = urllib.request.Request(base + route, method=method, data=body, headers=extra)
    try:
        with urllib.request.urlopen(req, timeout=40) as response:
            return response.status, response.headers, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.headers, error.read()

def ready():
    global base
    # Docker can allocate a different ephemeral host port after restart.
    base = 'http://127.0.0.1:' + docker('port', name, '3000/tcp').split(':')[-1]
    for _ in range(40):
        try:
            status, _, body = request('GET', '/api/health')
            if status == 200 and json.loads(body).get('db') == 'ok':
                return
        except (OSError, ValueError):
            pass
        time.sleep(.25)
    print(docker('logs', '--tail', '60', name))
    raise RuntimeError('isolated container did not become ready')

created_volume = False
created_container = False
try:
    docker('volume', 'create', '--label', label, volume)
    created_volume = True
    docker('run', '-d', '--name', name, '--label', label, '-p', '127.0.0.1::3000',
           '-v', volume + ':/data', '-e', 'AUTH_SECRET=synthetic-container-test-secret-only',
           args.image)
    created_container = True
    port = docker('port', name, '3000/tcp').split(':')[-1]
    base = 'http://127.0.0.1:' + port
    ready()
    seed = '''const Database=require('better-sqlite3');const db=new Database('/data/db/capsule.sqlite');
      db.pragma('foreign_keys=ON');db.prepare("insert into family(id,name,timezone,created_at,updated_at) values ('family','合成家庭','Asia/Shanghai',unixepoch(),unixepoch())").run();
      for (const [id,token] of JSON.parse(process.argv[1])) {
        db.prepare("insert into user(id,name,email,role,family_id,created_at,updated_at) values (?,?,?,'admin','family',unixepoch(),unixepoch())").run(id,id,id+'@fixture.invalid');
        db.prepare("insert into session(id,token,user_id,expires_at,created_at,updated_at) values (?,?,?,unixepoch()+3600,unixepoch(),unixepoch())").run(id,token,id);
      }db.close();'''
    docker('exec', name, 'node', '-e', seed, json.dumps([['a', token], ['b', other]]))
    draft_id, capture_id, item_id = [str(uuid.uuid4()) for _ in range(3)]
    content = dict(title='容器私密记录', text='时间不详的合成正文', occurredAt=None,
                   occurredAtPrecision='unknown', locationText='', participantIds=[],
                   visibility='private', readerUserIds=[], coverItemId=item_id,
                   items=[dict(id=item_id, assetId=None, localCaptureRef=capture_id, caption='')])
    draft_route = '/api/mobile/v1/drafts/' + draft_id
    assert request('PUT', draft_route, dict(content=content, expectedRevision=0, mutationId=str(uuid.uuid4())))[0] == 200
    original = ('仅用于测试的容器原件\n' * 1000).encode()
    status, _, body = request('POST', '/api/uploads', dict(draftId=draft_id, captureId=capture_id,
        filename='synthetic.txt', declaredMime='text/plain', totalBytes=len(original), lastModified=None,
        source='native', importSessionId=None))
    assert status == 201, body
    transfer = '/api/uploads/' + json.loads(body)['uploadId']
    def append(offset, data):
        return request('PATCH', transfer, data, headers={'content-type':'application/offset+octet-stream','upload-offset':str(offset)})
    assert append(0, original[:1234])[0] == 204
    assert request('HEAD', transfer, actor=other)[0] == 404
    # Restart only the container and volume created above; no shared instance.
    docker('restart', name)
    ready()
    assert request('HEAD', transfer)[1]['upload-offset'] == '1234'
    assert append(1234, original[1234:])[0] == 204
    status, _, body = request('POST', transfer + '/complete')
    assert status == 201, body
    receipt = json.loads(body)
    assert receipt['inboxItemId'] is None
    docker('restart', name)
    ready()
    replay = json.loads(request('POST', transfer + '/complete')[2])
    assert replay == receipt
    asset_route = '/api/media/' + receipt['assetId']
    assert request('GET', asset_route, actor=other)[0] == 404
    assert request('GET', asset_route)[2] == original
    content['items'][0]['assetId'] = receipt['assetId']
    assert request('PUT', draft_route, dict(content=content, expectedRevision=1, mutationId=str(uuid.uuid4())))[0] == 200
    status, _, body = request('POST', draft_route + '/publish', dict(expectedRevision=2))
    assert status == 200, body
    event_id = json.loads(body)['memoryEventId']
    event_route = '/api/mobile/v1/memories/' + event_id
    assert request('GET', event_route)[0] == 200
    assert request('GET', event_route, actor=other)[0] == 404
    assert request('GET', asset_route, actor=other)[0] == 404
    # Body must outlive its published draft and survive the shipped CLI restore.
    docker('exec', name, 'node', '-e', "const db=require('better-sqlite3')('/data/db/capsule.sqlite');db.prepare('delete from draft where id=?').run(process.argv[1]);db.prepare('update session set recent_auth_at=unixepoch()').run();db.close()", draft_id)
    docker('restart', name)
    ready()
    assert content['text'] in request('GET', event_route)[2].decode()
    status, _, archive = request('GET', '/api/export')
    assert status == 200, archive[:500]
    with zipfile.ZipFile(io.BytesIO(archive)) as z:
        security = json.loads(z.read('family-time-capsule-export/privacy.json'))
        principal = next(e['owner'] for e in security['events'] if e['id'] == event_id)
        memories = json.loads(z.read('family-time-capsule-export/memories.json'))
        assert next(e['bodyText'] for e in memories if e['id'] == event_id) == content['text']
    docker('exec', name, 'node', '-e', "require('fs').writeFileSync('/data/synthetic.zip',Buffer.from(process.argv[1],'base64'))", base64.b64encode(archive).decode())
    docker('exec', name, 'node', 'ops/verify-export.mjs', '/data/synthetic.zip')
    restored_dir = '/data/restored'
    docker('exec', '-e', 'DATA_DIR=' + restored_dir, name, 'node', 'ops/restore-principals.mjs', '--family', 'family')
    docker('exec', name, 'node', '-e', "const db=require('better-sqlite3')('/data/restored/db/capsule.sqlite');db.prepare(\"insert into user(id,name,email,role,created_at,updated_at) values ('operator','合成恢复维护者','restore@fixture.invalid','owner',unixepoch(),unixepoch())\").run();db.close()")
    docker('exec', '-e', 'DATA_DIR=' + restored_dir, name, 'node', 'ops/restore.mjs', '/data/synthetic.zip', '--user', 'operator')
    check = "const db=require('better-sqlite3')('/data/restored/db/capsule.sqlite'); const e=db.prepare('select body_text,visibility,created_by_user_id from memory_event where id=?').get(process.argv[1]); console.log(JSON.stringify(e));db.close()"
    restored = json.loads(docker('exec', name, 'node', '-e', check, event_id))
    assert restored['body_text'] == content['text'] and restored['visibility'] == 'private'
    assert restored['created_by_user_id'] != 'operator'
    docker('exec', name, 'node', '-e', "const db=require('better-sqlite3')('/data/restored/db/capsule.sqlite');db.prepare(\"update user set family_id='family' where id='operator'\").run();db.close()")
    bound = docker('exec', '-e', 'DATA_DIR=' + restored_dir, name, 'node', 'ops/restore-principals.mjs', '--family', 'family', '--bind', principal, '--to', 'operator', '--operator', 'operator')
    assert json.loads(bound)['changed'] is True
    assert json.loads(docker('exec', name, 'node', '-e', check, event_id))['created_by_user_id'] == 'operator'
    result = {'image': docker('image','inspect',args.image,'--format','{{.Id}}'),
              'privateUpload': True, 'containerRestarts': 3, 'privateBodyRestore': True, 'explicitPrincipalBinding': True, 'duplicateOriginals': False,
              'originalSha256': hashlib.sha256(original).hexdigest(), 'thirdPartyRead': 404}
    print(json.dumps(result, ensure_ascii=False))
finally:
    if created_container and owned('container', name):
        docker('rm', '-f', name)
    if created_volume and owned('volume', volume):
        docker('volume', 'rm', volume)
