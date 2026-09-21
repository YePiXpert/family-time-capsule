"""Exercise a running service with synthetic media; never print device tokens."""
import argparse,base64,json,subprocess,tempfile,time,urllib.request,urllib.error,uuid
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--base',default='http://127.0.0.1:3141');p.add_argument('--container',default='anan-ai-staging-ai-1');p.add_argument('--skip-transcribe',action='store_true');args=p.parse_args()
def call(path,body=None,token=None,method=None):
 headers={} if body is None else {'Content-Type':'application/json'}
 if token:headers['Authorization']='Bearer '+token
 req=urllib.request.Request(args.base+path,data=None if body is None else json.dumps(body).encode(),headers=headers,method=method or ('POST' if body is not None else 'GET'))
 try:
  with urllib.request.urlopen(req,timeout=115) as r:return r.status,json.load(r)
 except urllib.error.HTTPError as e:return e.code,json.load(e)
for attempt in range(15):
 try:
  assert call('/healthz')[0]==200
  break
 except (OSError,AssertionError):
  if attempt==14: raise
  time.sleep(1)
print('health ready');assert call('/api/v1/me')[0]==401
password='verification-passphrase'
status,state=call('/api/v1/status');assert status==200
if state['initialized']:
 # 复跑：用兜底命令给既有主人重设密码后登录（这也是丢手机时的找回路径）。
 subprocess.run(['docker','exec',args.container,'node','src/manage.ts','password','deployment-owner',password],check=True)
 status,owner=call('/api/v1/login',{'username':'deployment-owner','password':password,'deviceName':'deployment-verification'});assert status==200
else:
 status,owner=call('/api/v1/setup',{'username':'deployment-owner','password':password,'deviceName':'deployment-verification'});assert status==201
assert owner['member']['role']=='owner'
token=owner['token']
status,config=call('/api/v1/ai/config',token=token);assert status==200
assert config['defaultModel']=='deepseek-flash' and config['reasoningEffort']=='high'
assert config['enabledModels']==['deepseek-flash']
status,created=call('/api/v1/admin/members',{'username':'verification-member','password':password},token);assert status==201 or status==409
status,member=call('/api/v1/login',{'username':'verification-member','password':password,'deviceName':'synthetic-test'})
if status!=200:
 # 开放加入时代留下的旧成员没有密码，补上同一条兜底命令后再登录。
 subprocess.run(['docker','exec',args.container,'node','src/manage.ts','password','verification-member',password],check=True)
 status,member=call('/api/v1/login',{'username':'verification-member','password':password,'deviceName':'synthetic-test'})
assert status==200
assert call('/api/v1/admin/overview',token=member['token'])[0]==403
image='data:image/jpeg;base64,'+base64.b64encode((Path(__file__).parent.parent/'tests/fixtures/shapes.jpg').read_bytes()).decode()
for model in ['deepseek-flash']:
 for kind in ['group','write']:
  body={'requestId':str(uuid.uuid4()),'model':model,'photos':[{'id':'shapes','date':'2020-01-01T12:00:00','image':image}],'context':'这是几何图形测试，请客观描述形状和颜色。'}
  status,result=call('/api/v1/ai/'+kind,body,member['token']);assert status==200,(model,kind,status,result)
  status,replayed=call('/api/v1/ai/'+kind,body,member['token']);assert replayed==result
  print(model,kind,'passed, replay verified')
# 家庭远端空间（Build 72）：上传 → 重传幂等 → have → 读回逐字节一致 → 坏哈希拒收 → 这台设备发布清单（登记对象）
# → 全家清单列表里有它 → 同一成员的另一台设备 GET 拿到成员名下最新的一份（Build 71 换机恢复路径）
# → 空 keep 拒绝、prune 不动新对象 → 成员删自己的清单（对象是全家的，一小时内的新对象留着）。不清空家庭空间。
import hashlib,os
def raw(path,data,token,method='PUT',headers=None):
 req=urllib.request.Request(args.base+path,data=data,headers={**({'Authorization':'Bearer '+token} if token else {}),**(headers or {})},method=method)
 try:
  with urllib.request.urlopen(req,timeout=115) as r:return r.status,r.read(),r.headers.get('Content-Type','')
 except urllib.error.HTTPError as e:return e.code,e.read(),e.headers.get('Content-Type','')
# 合成录音验证转写，不输出声音、文字或设备凭证；只在 staging 上运行。
if not args.skip_transcribe:
 with tempfile.TemporaryDirectory(prefix='anan-verify-audio-') as directory:
  path=str(Path(directory)/'tone.m4a')
  try:subprocess.run(['ffmpeg','-y','-f','lavfi','-i','sine=frequency=440:duration=2','-c:a','aac','-b:a','64k',path],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
  except FileNotFoundError:print('skip transcribe: no ffmpeg')
  else:
   audio=Path(path).read_bytes();route='/api/v1/ai/transcribe';headers={'Content-Type':'audio/mp4','X-Audio-Seconds':'2'}
   status,body,_=raw(route,audio,member['token'],method='POST',headers=headers)
   assert status==200 and isinstance(json.loads(body).get('text'),str),status
   print('transcribe response passed')
   assert raw(route,audio,member['token'],method='POST',headers={**headers,'X-Audio-Seconds':'999'})[0]==413
   print('transcribe duration limit passed')
   assert raw(route,b'{}',member['token'],method='POST',headers={'Content-Type':'application/json'})[0]==415
   print('transcribe content type passed')
   assert raw(route,audio,None,method='POST',headers=headers)[0]==401
   print('transcribe authentication passed')
   remaining=subprocess.run(['docker','exec',args.container,'sh','-c','ls -A /tmp'],check=True,capture_output=True,text=True)
   assert not remaining.stdout.strip(),'transcribe temporary files remain'
   print('transcribe temporary files cleaned')
blob=os.urandom(1000000);octet={'Content-Type':'application/octet-stream','X-Object-Sha256':hashlib.sha256(blob).hexdigest()}
object_id=hashlib.sha256(b'verification-object').hexdigest();object_path='/api/v1/backup/objects/'+object_id
status,before=call('/api/v1/backup/status',token=member['token']);assert status==200,before
status,body,_=raw(object_path,blob,member['token'],headers=octet);assert status in(200,201),(status,body)
status,body,_=raw(object_path,blob,member['token'],headers=octet);assert status==200,(status,body)
status,have=call('/api/v1/backup/objects/have',{'ids':[object_id,'f'*64]},member['token']);assert status==200 and have['missing']==['f'*64],have
status,body,ctype=raw(object_path,None,member['token'],method='GET');assert status==200 and body==blob and ctype.startswith('application/octet-stream'),(status,ctype)
status,body,_=raw(object_path,blob,member['token'],headers={**octet,'X-Object-Sha256':'0'*64});assert status==400,(status,body)
index=base64.b64encode(b'verification-index').decode()
status,_=call('/api/v1/backup/manifest',{'keyId':'0123456789abcdef','index':index,'objects':[object_id]},member['token'],method='PUT');assert status==200
status,manifest=call('/api/v1/backup/manifest',token=member['token']);assert status==200 and manifest['keyId']=='0123456789abcdef' and manifest['deviceId']==member['member']['deviceId'],manifest
status,manifests=call('/api/v1/backup/manifests',token=member['token']);assert status==200 and any(m['deviceId']==member['member']['deviceId'] and m['index']==index and m['deviceName']=='synthetic-test' for m in manifests),manifests
status,second=call('/api/v1/login',{'username':'verification-member','password':password,'deviceName':'synthetic-second'});assert status==200
status,fallback=call('/api/v1/backup/manifest',token=second['token']);assert status==200 and fallback['deviceId']==member['member']['deviceId'] and fallback['index']==index,fallback
status,state=call('/api/v1/backup/status',token=member['token']);assert status==200 and state['objects']>=1 and state['bytes']>=len(blob) and state['keyId']=='0123456789abcdef' and state['manifests']>=1 and state['limitBytes']>0,state
status,refused=call('/api/v1/backup/prune',{'keep':[]},member['token']);assert status==400 and refused['code']=='INVALID_INPUT',refused
status,pruned=call('/api/v1/backup/prune',{'keep':[object_id]},member['token']);assert status==200 and pruned['removed']==0,pruned
assert call('/api/v1/admin/backup',token=member['token'],method='DELETE')[0]==403
status,deleted=call('/api/v1/backup',token=member['token'],method='DELETE');assert status==200 and deleted['ok'] is True and 'pruned' in deleted,deleted
status,state=call('/api/v1/backup/status',token=member['token']);assert state['manifests']==before['manifests'] and state['objects']>=1,state
assert call('/api/v1/backup/manifest',token=member['token'])[0]==404
print('backup object store passed')
status,overview=call('/api/v1/admin/overview',token=token);assert status==200
assert all('manifests' in m for m in overview['members']) and overview['backup']['objects']>=1 and overview['backup']['limitBytes']>0 and overview['backupFreeBytes']>0,overview['backup']
for device in overview['devices']:
 if device['member_id']==member['member']['id']:
  assert call('/api/v1/admin/devices/'+device['id'],token=token,method='DELETE')[0]==200
assert call('/api/v1/me',token=member['token'])[0]==401
# Revoke the temporary owner device through the local administrator, leaving no test access active.
subprocess.run(['docker','exec',args.container,'node','--input-type=module','-e',"import{Store}from'./src/store.ts';const s=new Store('/data/ai.sqlite');s.db.prepare('UPDATE devices SET revoked=1 WHERE id=?').run(process.argv[1]);s.close();",owner['member']['deviceId']],check=True,stdout=subprocess.DEVNULL)
print('Accounts, login, owner isolation, model results, idempotency, family backup space and revocation verified.')
