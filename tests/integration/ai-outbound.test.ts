import { describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import { isPublicAiAddress, prepareAiFetch } from "@/lib/ai/outbound";

describe("AI recipient boundary",()=>{
  it("refuses private, reserved and transition address forms",async()=>{
    for(const address of ["127.0.0.1","10.1.2.3","169.254.169.254","100.64.0.1","192.0.2.1","::1","::ffff:8.8.8.8","2001::1","2001:0:1234::1","2001:db8::1","2002:0808:0808::1","3fff::1"]){expect(isPublicAiAddress(address),address).toBe(false);}
    for(const address of ["8.8.8.8","2606:4700::1111","2001:4860:4860::8888"]){expect(isPublicAiAddress(address),address).toBe(true);}
    const resolve=vi.fn(async()=>[{address:"8.8.8.8",family:4},{address:"10.0.0.1",family:4}]);
    await expect(prepareAiFetch("https://provider.example/v1/responses",{method:"POST",body:"{}"},"https://provider.example/v1",{},resolve as never)).rejects.toMatchObject({code:"ai_configuration_invalid"});
    await expect(prepareAiFetch("https://provider.example/other/responses",{},"https://provider.example/v1",{})).rejects.toMatchObject({code:"ai_configuration_invalid"});
  });
  it("pins the approved address, preserves the recipient and refuses redirects without forwarding its key",async()=>{
    const requests: {host:string|undefined;authorization:string|undefined}[]=[];
    const server=createServer((req,res)=>{requests.push({host:req.headers.host,authorization:req.headers.authorization});res.writeHead(307,{location:"http://127.0.0.1:1/stolen"});res.end();});
    await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
    const port=(server.address() as {port:number}).port;
    try {
      const base=`http://gateway.localhost:${port}/v1`;
      const resolve=vi.fn(async()=>[{address:"127.0.0.1",family:4}]);
      const send=await prepareAiFetch(`${base}/responses`,{method:"POST",headers:{authorization:"Bearer synthetic-key"},body:"{}"},base,{},resolve as never);
      await expect(prepareAiFetch(`${base}/responses`,{method:"POST",body:"{}"},base,{},(async()=>[{address:"10.0.0.1",family:4}]) as never)).rejects.toMatchObject({code:"ai_configuration_invalid"});
      expect(requests).toHaveLength(0);
      await expect(send()).rejects.toThrow("redirects are forbidden");
      expect(resolve).toHaveBeenCalledTimes(1);expect(requests).toEqual([{host:`gateway.localhost:${port}`,authorization:"Bearer synthetic-key"}]);
      const cancelled=await prepareAiFetch(`${base}/responses`,{method:"POST",body:"{}",signal:AbortSignal.abort()},base,{},resolve as never);
      await expect(cancelled()).rejects.toThrow(); expect(requests).toHaveLength(1);
    } finally {server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
  });
});

it("a nonstandard upstream status rejects the call without crashing the server process", async()=>{
  const {spawnSync}=await import("node:child_process");
  const source=`import {createServer} from 'node:http';import {prepareAiFetch} from './lib/ai/outbound.ts';const server=createServer((req,res)=>{res.writeHead(600);res.end('bad upstream');});await new Promise(r=>server.listen(0,'127.0.0.1',r));try {const base='http://127.0.0.1:'+server.address().port+'/v1';const send=await prepareAiFetch(base+'/responses',{method:'POST',body:'{}'},base,{});try {await send();process.exitCode=2;}catch{process.stdout.write('rejected safely');}}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}`;
  const child=spawnSync(process.execPath,["--import","tsx","--conditions=react-server","--input-type=module","-e",source],{cwd:process.cwd(),env:{...process.env},encoding:"utf8",timeout:10000});
  expect(child.status,child.stderr).toBe(0);expect(child.stdout).toBe("rejected safely");
});
