"""Exercise a running service with synthetic media; never print device tokens."""
import argparse,base64,json,subprocess,time,urllib.request,urllib.error,uuid
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--base',default='http://127.0.0.1:3141');p.add_argument('--container',default='anan-ai-staging-ai-1');args=p.parse_args()
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
# 远端备份对象库：上传 → 重传幂等 → have → 读回逐字节一致 → 坏哈希拒收 → 清单往返 → prune 不动新对象 → 删库。
import hashlib,os
def raw(path,data,token,method='PUT',headers=None):
 req=urllib.request.Request(args.base+path,data=data,headers={'Authorization':'Bearer '+token,**(headers or {})},method=method)
 try:
  with urllib.request.urlopen(req,timeout=115) as r:return r.status,r.read(),r.headers.get('Content-Type','')
 except urllib.error.HTTPError as e:return e.code,e.read(),e.headers.get('Content-Type','')
blob=os.urandom(1000000);octet={'Content-Type':'application/octet-stream','X-Object-Sha256':hashlib.sha256(blob).hexdigest()}
object_id=hashlib.sha256(b'verification-object').hexdigest();object_path='/api/v1/backup/objects/'+object_id
status,body,_=raw(object_path,blob,member['token'],headers=octet);assert status==201,(status,body)
status,body,_=raw(object_path,blob,member['token'],headers=octet);assert status==200,(status,body)
status,have=call('/api/v1/backup/objects/have',{'ids':[object_id,'f'*64]},member['token']);assert status==200 and have['missing']==['f'*64],have
status,body,ctype=raw(object_path,None,member['token'],method='GET');assert status==200 and body==blob and ctype.startswith('application/octet-stream'),(status,ctype)
status,body,_=raw(object_path,blob,member['token'],headers={**octet,'X-Object-Sha256':'0'*64});assert status==400,(status,body)
status,_=call('/api/v1/backup/manifest',{'keyId':'0123456789abcdef','index':base64.b64encode(b'verification-index').decode()},member['token'],method='PUT');assert status==200
status,manifest=call('/api/v1/backup/manifest',token=member['token']);assert status==200 and manifest['keyId']=='0123456789abcdef'
status,state=call('/api/v1/backup/status',token=member['token']);assert status==200 and state['objects']==1 and state['bytes']==len(blob) and state['keyId']=='0123456789abcdef',state
status,pruned=call('/api/v1/backup/prune',{'keep':[]},member['token']);assert status==200 and pruned['removed']==0,pruned
assert call('/api/v1/backup',token=member['token'],method='DELETE')[0]==200
status,state=call('/api/v1/backup/status',token=member['token']);assert state['objects']==0 and state['keyId'] is None,state
print('backup object store passed')
status,overview=call('/api/v1/admin/overview',token=token);assert status==200
assert all('backup' in m for m in overview['members']) and overview['backupFreeBytes']>0
for device in overview['devices']:
 if device['member_id']==member['member']['id']:
  assert call('/api/v1/admin/devices/'+device['id'],token=token,method='DELETE')[0]==200
assert call('/api/v1/me',token=member['token'])[0]==401
# Revoke the temporary owner device through the local administrator, leaving no test access active.
subprocess.run(['docker','exec',args.container,'node','--input-type=module','-e',"import{Store}from'./src/store.ts';const s=new Store('/data/ai.sqlite');s.db.prepare('UPDATE devices SET revoked=1 WHERE id=?').run(process.argv[1]);s.close();",owner['member']['deviceId']],check=True,stdout=subprocess.DEVNULL)
print('Accounts, login, owner isolation, model results, idempotency, backup object store and revocation verified.')
