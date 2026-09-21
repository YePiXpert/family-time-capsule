#!/usr/bin/env python3
"""探反代的请求体上限：往备份对象端点 PUT 若干 MB → 看应答是我们的 JSON 还是反代的拦截页。

不带账号（默认）：反代按 Content-Length 先于我们拦截，所以匿名 PUT 就够——只要应答是我们的 JSON（401），说明反代放行了这个体积。
带 --username/--password：登录后真上传，期望 4 MB → 201（我们收下了）、9 MB → 我们的 JSON 413（TOO_LARGE），结束只撤销探测设备；无清单引用的探测对象留给服务端回收。
若小体积就被非 JSON 的 413 拦下，是反代（nginx 默认 1 MB）在拦：加 client_max_body_size 16m; proxy_request_buffering off; proxy_read_timeout 130s; 后重探。
"""
import argparse,hashlib,json,os,subprocess,sys,urllib.error,urllib.request
p=argparse.ArgumentParser();p.add_argument('--base',default='https://capsule.yep.li/api/v1');p.add_argument('--username');p.add_argument('--password')
p.add_argument('--mb',type=float,nargs='+',default=[4,9]);p.add_argument('--container',help='本机 docker 容器名：结束后撤销这台探测设备');args=p.parse_args()
def request(path,data=None,token=None,method=None,headers=None):
 h=dict(headers or {})
 if token:h['Authorization']='Bearer '+token
 req=urllib.request.Request(args.base+path,data=data,headers=h,method=method or ('POST' if data is not None else 'GET'))
 try:
  with urllib.request.urlopen(req,timeout=180) as r:return r.status,r.read(),r.headers.get('Content-Type','')
 except urllib.error.HTTPError as e:return e.code,e.read(),e.headers.get('Content-Type','')
login=None;token=None
if args.username:
 status,body,_=request('/login',json.dumps({'username':args.username,'password':args.password or '','deviceName':'upload-limit-probe'}).encode(),headers={'Content-Type':'application/json'})
 assert status==200,(status,body[:200]);login=json.loads(body);token=login['token']
ok=True
try:
 for mb in args.mb:
  blob=os.urandom(int(mb*1048576));object_id=hashlib.sha256(f'probe-{mb}'.encode()).hexdigest()
  status,body,ctype=request('/backup/objects/'+object_id,blob,token,'PUT',{'Content-Type':'application/octet-stream','X-Object-Sha256':hashlib.sha256(blob).hexdigest()})
  ours=ctype.startswith('application/json')
  code=json.loads(body).get('code') if ours else None
  print(f'{mb:g} MB → HTTP {status} · '+(f'我们的 JSON（{code}）' if ours else f'非 JSON 应答（{ctype or "无类型"}，多半是反代拦截）'))
  if not token:ok=ok and ours and status==401
  elif mb<=8:ok=ok and status in (200,201)
  else:ok=ok and ours and status==413
finally:
 # 从未发布清单，绝不能用删除清单的接口收尾；对象等占位和宽限过期后自然回收。
 if token and args.container:
  subprocess.run(['docker','exec',args.container,'node','--input-type=module','-e',"import{Store}from'./src/store.ts';const s=new Store('/data/ai.sqlite');s.db.prepare('UPDATE devices SET revoked=1 WHERE id=?').run(process.argv[1]);s.close();",login['member']['deviceId']],check=True,stdout=subprocess.DEVNULL)
print('PASS' if ok else 'FAIL: 反代或服务端未按期望应答，见上')
sys.exit(0 if ok else 1)
