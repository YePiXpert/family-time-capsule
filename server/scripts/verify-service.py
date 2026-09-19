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
status,overview=call('/api/v1/admin/overview',token=token);assert status==200
for device in overview['devices']:
 if device['member_id']==member['member']['id']:
  assert call('/api/v1/admin/devices/'+device['id'],token=token,method='DELETE')[0]==200
assert call('/api/v1/me',token=member['token'])[0]==401
# Revoke the temporary owner device through the local administrator, leaving no test access active.
subprocess.run(['docker','exec',args.container,'node','--input-type=module','-e',"import{Store}from'./src/store.ts';const s=new Store('/data/ai.sqlite');s.db.prepare('UPDATE devices SET revoked=1 WHERE id=?').run(process.argv[1]);s.close();",owner['member']['deviceId']],check=True,stdout=subprocess.DEVNULL)
print('Accounts, login, owner isolation, model results, idempotency and revocation verified.')
