"""Exercise family activation, device pairing, recovery, five text modes, transcription and backups with synthetic data; never print device tokens."""
import argparse,base64,hashlib,json,os,re,subprocess,tempfile,time,urllib.request,urllib.error,uuid
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--base',default='http://127.0.0.1:3141');p.add_argument('--container',default='anan-ai-staging-ai-1');p.add_argument('--skip-transcribe',action='store_true');p.add_argument('--skip-text',action='store_true');p.add_argument('--allow-live',action='store_true');args=p.parse_args()
if not args.allow_live:p.error('Real calls disabled: obtain App usage/billing authorization before --allow-live.')
if args.base!='http://127.0.0.1:3141':p.error('Use isolated staging at http://127.0.0.1:3141, never production.')
inspection=json.loads(subprocess.check_output(['docker','inspect',args.container],text=True))[0]
assert any(binding['HostPort']=='3141' for binding in inspection['NetworkSettings']['Ports'].get('3000/tcp',[]) or []),'Container must be staging on 3141'
assert all(mount['Source']!='/opt/anan-ai/data' for mount in inspection['Mounts']),'Production data must not be used'
check="import{loadMiMoConfig}from'./src/ai-config.ts';loadMiMoConfig('AI');"+("loadMiMoConfig('TRANSCRIBE');" if not args.skip_transcribe else '')
subprocess.run(['docker','exec',args.container,'node','--input-type=module','-e',check],check=True)
def call(path,body=None,token=None,method=None):
 tracked=path.startswith('/api/v1/ai/') and path!='/api/v1/ai/config' and token
 before=call('/api/v1/me',token=token)[1]['usage']['tokens'] if tracked else 0
 started=time.monotonic()
 headers={} if body is None else {'Content-Type':'application/json'}
 if token:headers['Authorization']='Bearer '+token
 req=urllib.request.Request(args.base+path,data=None if body is None else json.dumps(body).encode(),headers=headers,method=method or ('POST' if body is not None else 'GET'))
 try:
  with urllib.request.urlopen(req,timeout=115) as r:result=(r.status,json.load(r))
 except urllib.error.HTTPError as e:result=(e.code,json.load(e))
 if tracked:
  elapsed=time.monotonic()-started;after=call('/api/v1/me',token=token)[1]['usage']['tokens']
  print(json.dumps({'model':'mimo-v2.6-pro','mode':(body or {}).get('writingMode',path.rsplit('/',1)[-1]),'success':result[0]==200,'status':result[0],'elapsedMs':round(elapsed*1000),'tokens':after-before}))
 return result
for attempt in range(15):
 try:
  assert call('/healthz')[0]==200
  break
 except (OSError,AssertionError):
  if attempt==14: raise
  time.sleep(1)
print('health ready');assert call('/api/v1/me')[0]==401
# 家庭与设备：服务端只管状态机、不解钥匙包，所以公钥、钥匙包与恢复包都用合成随机字节。
b64url=lambda n:base64.urlsafe_b64encode(os.urandom(n)).decode().rstrip('=')
sha=lambda text:hashlib.sha256(text.encode()).hexdigest()
proof=os.urandom(32).hex();key_id='0123456789abcdef'
status,state=call('/api/v1/status');assert status==200
if state['initialized']:
 # 复跑：已有家庭时直接在容器里给第一位管理者登记一台验证设备（令牌只进本进程，不打印）。
 script="import{Store}from'./src/store.ts';const s=new Store('/data/ai.sqlite');const a=s.admins()[0];process.stdout.write(JSON.stringify(s.attach(a.id,'deployment-verification')));s.close();"
 owner=json.loads(subprocess.check_output(['docker','exec',args.container,'node','--input-type=module','-e',script],text=True))
else:
 printed=subprocess.check_output(['docker','exec',args.container,'node','src/manage.ts','activation'],text=True)
 code=re.search(r'[0-9A-Z]{5}(?:-[0-9A-Z]{5}){4}',printed).group(0)
 family={'familyId':str(uuid.uuid4()),'keyId':key_id,'recovery':{'envelope':base64.b64encode(os.urandom(57)).decode(),'verifier':sha(proof)}}
 body={'activationCode':code,'memberId':str(uuid.uuid4()),'memberName':'deployment-owner','deviceName':'deployment-verification','publicKey':b64url(32),**family}
 assert call('/api/v1/family/activate',{**body,'activationCode':'00000-00000-00000-00000-00000'})[0]==403
 status,owner=call('/api/v1/family/activate',body);assert status==201,status
 assert call('/api/v1/family/activate',body)[0]==409
 assert call('/api/v1/status')[1]=={'initialized':True,'family':True}
assert owner['member']['role']=='admin'
token=owner['token']
status,config=call('/api/v1/ai/config',token=token);assert status==200
assert config['defaultModel']=='mimo-v2.6-pro' and config['reasoningEffort']=='per-mode'
assert config['enabledModels']==['mimo-v2.6-pro']
for gone in ('/api/v1/setup','/api/v1/login'):assert call(gone,{})[0]==404
def pair(member,device_name):
 """新手机登记申请 → 管理者批准 → 新手机凭领取凭据领令牌 → 确认。"""
 claim=os.urandom(16).hex();public_key=b64url(32)
 status,created=call('/api/v1/pair/requests',{'publicKey':public_key,'deviceName':device_name,'claimHash':sha(claim)});assert status==201,status
 request_id=created['requestId']
 status,seen=call('/api/v1/pair/requests/'+request_id,token=token);assert status==200 and seen['publicKey']==public_key and seen['status']=='pending'
 assert call('/api/v1/pair/requests/'+request_id+'/collect',{'claim':claim})[0]==202
 status,approved=call('/api/v1/pair/requests/'+request_id+'/approve',{'member':member,'enc':b64url(32),'ct':b64url(80)},token);assert status==200,status
 assert approved['binding']['deviceId']==seen['deviceId'] and approved['binding']['approverDeviceId']==owner['member']['deviceId']
 assert call('/api/v1/pair/requests/'+request_id+'/collect',{'claim':'00'*16})[0]==404
 status,got=call('/api/v1/pair/requests/'+request_id+'/collect',{'claim':claim});assert status==200 and got['binding']==approved['binding']
 assert call('/api/v1/pair/requests/'+request_id+'/confirm',{},got['token'])[0]==200
 assert call('/api/v1/pair/requests/'+request_id+'/collect',{'claim':claim})[0]==410
 return got
member_id=str(uuid.uuid4())
member=pair({'id':member_id,'name':'verification-member','role':'member'},'synthetic-test')
assert member['member']['role']=='member'
if not state['initialized']:
 assert call('/api/v1/recovery/claim',{'proof':os.urandom(32).hex()})[0]==403
 status,admins=call('/api/v1/recovery/claim',{'proof':proof});assert status==200 and [a['name'] for a in admins['admins']]==['deployment-owner']
print('family activation, pairing and recovery check passed')
assert call('/api/v1/admin/overview',token=member['token'])[0]==403
image='data:image/jpeg;base64,'+base64.b64encode((Path(__file__).parent.parent/'tests/fixtures/shapes.jpg').read_bytes()).decode()
# 合成文本验证五种模式：只记录状态、耗时和用量，不打印设备凭证或正文。
if not args.skip_text:
 contexts={
  'ask':'落款：爸爸。月龄：4 个月。正文：今天她笑了。已标第一次：否。',
  'question':'月龄：4 个月。今天：2026-09-05。最近标题：窗边、翻过去了。近七天问过：[]。',
  'polish':'落款：妈妈。标题：窗边。正文：今天我我抱她站在窗边。',
  'recap':'年份：2026。标题：窗边的风、翻过去了。第一次：第一次翻身。她说的话：无。已写寄语：无。',
 }
 for writing_mode,context in contexts.items():
  body={'requestId':str(uuid.uuid4()),'writingMode':writing_mode,'context':context,'photos':[]}
  status,result=call('/api/v1/ai/write',body,member['token']);assert status==200,(writing_mode,status)
  if writing_mode=='question':assert isinstance(result.get('question'),str)
  elif writing_mode=='ask':
   questions=result.get('questions');assert isinstance(questions,list) and 1<=len(questions)<=3
   assert all(isinstance(question,str) for question in questions)
   assert isinstance(result.get('first'),bool)
  else:assert isinstance(result.get('title'),str) and isinstance(result.get('text'),str)
  if writing_mode=='polish':
   before=call('/api/v1/me',token=member['token'])[1]['usage']
   status,replayed=call('/api/v1/ai/write',body,member['token']);assert status==200 and replayed==result
   after=call('/api/v1/me',token=member['token'])[1]['usage']
   assert after==before
   print('polish replay verified without extra tokens or quota')
  print(writing_mode,'text passed')
 records=[
  {'id':'r1','date':'2026-09-01','by':'爸爸','title':'清早的窗','text':'我抱她站在窗边，楼下有人扫地。','first':False,'quote':False,'photos':True},
  {'id':'r2','date':'2026-09-10','by':'妈妈','title':'翻过去了','text':'她第一次翻过去，我正在叠毛巾。','first':True,'quote':False,'photos':False},
  {'id':'r3','date':'2026-10-02','by':'外婆','title':'午后的歌','text':'我唱到第二句，她又咿呀了一声。','first':False,'quote':True,'photos':False},
  {'id':'r4','date':'2026-10-12','by':'爸爸','title':'雨声','text':'雨落在窗台上，她停下来听。','first':False,'quote':False,'photos':True},
 ]
 body={'requestId':str(uuid.uuid4()),'writingMode':'editor','photos':[],'context':json.dumps({'year':'2026','records':records},ensure_ascii=False)}
 status,result=call('/api/v1/ai/write',body,member['token']);assert status==200,('editor',status)
 chapters=result.get('chapters');assert isinstance(chapters,list) and chapters
 ids={record['id'] for record in records}
 for chapter in chapters:
  picks=chapter.get('picks');assert isinstance(picks,list) and 1<=len(picks)<=3 and set(picks)<=ids
 print('editor text passed')
# 便宜的负例不调用上游，跳过文本生成时也验证。
body={'requestId':str(uuid.uuid4()),'writingMode':'ask','context':'今天她笑了。','photos':[{'id':'shapes','image':image}]}
assert call('/api/v1/ai/write',body,member['token'])[0]==400
print('ask photos rejected')
body={'requestId':str(uuid.uuid4()),'writingMode':'generate','context':'合成文字','photos':[]}
status,rejected=call('/api/v1/ai/write',body,member['token']);assert status==400 and rejected['code']=='INVALID_INPUT'
assert call('/api/v1/ai/group',body,member['token'])[0]==404
print('removed modes and route rejected')
# 家庭远端空间（Build 72）：上传 → 重传幂等 → have → 读回逐字节一致 → 坏哈希拒收 → 这台设备发布清单（登记对象）
# → 全家清单列表里有它 → 同一成员的另一台设备 GET 拿到成员名下最新的一份（Build 71 换机恢复路径）
# → 空 keep 拒绝、prune 不动新对象 → 成员删自己的清单（对象是全家的，一小时内的新对象留着）。不清空家庭空间。
import hashlib,os
def raw(path,data,token,method='PUT',headers=None):
 tracked=path=='/api/v1/ai/transcribe';before=call('/api/v1/me',token=token)[1]['usage']['tokens'] if tracked and token else 0
 started=time.monotonic()
 req=urllib.request.Request(args.base+path,data=data,headers={**({'Authorization':'Bearer '+token} if token else {}),**(headers or {})},method=method)
 try:
  with urllib.request.urlopen(req,timeout=115) as r:result=(r.status,r.read(),r.headers.get('Content-Type',''))
 except urllib.error.HTTPError as e:result=(e.code,e.read(),e.headers.get('Content-Type',''))
 if tracked:
  elapsed=time.monotonic()-started;after=call('/api/v1/me',token=token)[1]['usage']['tokens'] if token else before
  print(json.dumps({'model':'mimo-v2.5-asr','mode':'transcribe','success':result[0]==200,'status':result[0],'elapsedMs':round(elapsed*1000),'tokens':after-before,'audioSeconds':(headers or {}).get('X-Audio-Seconds')}))
 return result
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
object_id=hashlib.sha256(b'verification-object'+blob).hexdigest();object_path='/api/v1/backup/objects/'+object_id
status,before=call('/api/v1/backup/status',token=member['token']);assert status==200
status,body,_=raw(object_path,blob,member['token'],headers=octet);assert status in(200,201),status
status,body,_=raw(object_path,blob,member['token'],headers=octet);assert status==200,status
status,have=call('/api/v1/backup/objects/have',{'ids':[object_id,'f'*64]},member['token']);assert status==200 and have['missing']==['f'*64],have
status,body,ctype=raw(object_path,None,member['token'],method='GET');assert status==200 and body==blob and ctype.startswith('application/octet-stream'),(status,ctype)
status,body,_=raw(object_path,blob,member['token'],headers={**octet,'X-Object-Sha256':'0'*64});assert status==400,status
index=base64.b64encode(b'verification-index').decode()
status,_=call('/api/v1/backup/manifest',{'keyId':'0123456789abcdef','index':index,'objects':[object_id]},member['token'],method='PUT');assert status==200
status,manifest=call('/api/v1/backup/manifest',token=member['token']);assert status==200 and manifest['keyId']=='0123456789abcdef' and manifest['deviceId']==member['member']['deviceId']
status,manifests=call('/api/v1/backup/manifests',token=member['token']);assert status==200 and any(m['deviceId']==member['member']['deviceId'] and m['index']==index and m['deviceName']=='synthetic-test' for m in manifests)
second=pair({'id':member_id},'synthetic-second')
status,fallback=call('/api/v1/backup/manifest',token=second['token']);assert status==200 and fallback['deviceId']==member['member']['deviceId'] and fallback['index']==index
status,state=call('/api/v1/backup/status',token=member['token']);assert status==200 and state['objects']>=1 and state['bytes']>=len(blob) and state['keyId']=='0123456789abcdef' and state['manifests']>=1 and state['limitBytes']>0
status,refused=call('/api/v1/backup/prune',{'keep':[]},member['token']);assert status==400 and refused['code']=='INVALID_INPUT'
status,pruned=call('/api/v1/backup/prune',{'keep':[object_id]},member['token']);assert status==200 and pruned['removed']==0
assert call('/api/v1/admin/backup',token=member['token'],method='DELETE')[0]==403
status,deleted=call('/api/v1/backup',token=member['token'],method='DELETE');assert status==200 and deleted['ok'] is True and 'pruned' in deleted,deleted
status,state=call('/api/v1/backup/status',token=member['token']);assert state['manifests']==before['manifests'] and state['objects']>=1
assert call('/api/v1/backup/manifest',token=member['token'])[0]==404
print('backup object store passed')
status,overview=call('/api/v1/admin/overview',token=token);assert status==200
assert all('manifests' in m for m in overview['members']) and overview['backup']['objects']>=1 and overview['backup']['limitBytes']>0 and overview['backupFreeBytes']>0
for device in overview['devices']:
 if device['member_id']==member['member']['id']:
  assert call('/api/v1/admin/devices/'+device['id'],token=token,method='DELETE')[0]==200
assert call('/api/v1/me',token=member['token'])[0]==401
# Revoke the temporary owner device through the local administrator, leaving no test access active.
subprocess.run(['docker','exec',args.container,'node','--input-type=module','-e',"import{Store}from'./src/store.ts';const s=new Store('/data/ai.sqlite');s.db.prepare('UPDATE devices SET revoked=1 WHERE id=?').run(process.argv[1]);s.close();",owner['member']['deviceId']],check=True,stdout=subprocess.DEVNULL)
print('Family activation, device pairing, recovery, admin isolation, model results, idempotency, family backup space and revocation verified.')
