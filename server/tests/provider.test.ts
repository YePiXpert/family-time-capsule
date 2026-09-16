import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { cpaProvider } from '../src/provider.ts';

test('CPA receives Flash with High thinking for grouping and writing', async () => {
 const dir=mkdtempSync(join(tmpdir(),'xiaomei-provider-'));
 const keyFile=join(dir,'key');writeFileSync(keyFile,'test-only-key');
 const sent:Record<string,unknown>[]=[];
 const server=createServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk;
  const body=JSON.parse(raw);sent.push(body);
  assert.equal(req.url,'/v1/chat/completions');
  assert.equal(req.headers.authorization,'Bearer test-only-key');
  const result=sent.length===1?{groups:[{photoIds:['photo'],title:'图形',summary:'红色方块'}]}:{title:'图形',text:'一块红色方块。'};
  res.setHeader('Content-Type','application/json');
  res.end(JSON.stringify({choices:[{message:{reasoning_content:'private reasoning',content:JSON.stringify(result)}}],usage:{total_tokens:42}}));
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 try {
  const port=(server.address() as {port:number}).port;
  const provider=cpaProvider(`http://127.0.0.1:${port}/v1`,keyFile);
  for(const kind of ['group','write'] as const){
   const output=await provider(kind,{requestId:randomUUID(),model:'deepseek-flash',photos:[{id:'photo',image:'data:image/jpeg;base64,/9j/2Q=='}],mode:'photos',context:''});
   assert.equal(output.tokens,42);
   assert.ok(!JSON.stringify(output).includes('private reasoning'));
  }
  for(const body of sent){
   assert.equal(body.model,'deepseek-flash');
   assert.equal(body.reasoning_effort,'high');
   assert.deepEqual(body.thinking,{type:'enabled'});
   assert.ok(Number(body.max_tokens)>=8192,'Thinking and final JSON need a shared output budget');
  }
 } finally {
  await new Promise<void>((resolve,reject)=>server.close(err=>err?reject(err):resolve()));
  rmSync(dir,{recursive:true,force:true});
 }
});
