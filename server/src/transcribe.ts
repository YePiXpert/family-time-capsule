import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { open, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Problem } from './store.ts';
import { transcribeResultSchema } from './contracts.ts';

export type Transcoder=(input:Buffer,opts:{maxSeconds:number;signal?:AbortSignal})=>Promise<{wav:Buffer;seconds:number}>;
export type Transcriber=(wav:Buffer,signal?:AbortSignal)=>Promise<{text:string;tokens:number|null}>;
export const audioTooLong=()=>new Problem(413,'AUDIO_TOO_LONG','这段录音太长了，转文字最多 3 分钟。');
const invalidAudio=()=>new Problem(400,'INVALID_AUDIO','这段录音读不出来，换一段试试。');
const unavailable=()=>new Problem(502,'UPSTREAM_UNAVAILABLE','转文字暂时不可用，请稍后重试。');
const invalidResult=()=>new Problem(502,'INVALID_RESULT','转文字返回内容无效，请重试。');

export function wavHeader(pcmBytes:number,sampleRate=16000,channels=1,bitsPerSample=16):Buffer {
 const header=Buffer.alloc(44),align=channels*bitsPerSample/8;
 header.write('RIFF',0);header.writeUInt32LE(36+pcmBytes,4);header.write('WAVE',8);header.write('fmt ',12);
 header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(channels,22);
 header.writeUInt32LE(sampleRate,24);header.writeUInt32LE(sampleRate*align,28);header.writeUInt16LE(align,32);
 header.writeUInt16LE(bitsPerSample,34);header.write('data',36);header.writeUInt32LE(pcmBytes,40);
 return header;
}
export function ffmpegTranscoder(opts:{ffmpegPath?:string;tmpDir?:string;timeoutMs?:number}={}):Transcoder {
 return async(input,{maxSeconds,signal})=>{
  signal?.throwIfAborted();
  const file=join(opts.tmpDir??tmpdir(),`anan-audio-${randomUUID()}.m4a`);
  // m4a 的 moov 在末尾，输入必须可 seek；生产 /tmp 是内存 tmpfs。
  const handle=await open(file,'wx',0o600);
  try {
   try {await handle.writeFile(input);} finally {await handle.close();}
   signal?.throwIfAborted();
   const pcm=await new Promise<Buffer>((resolve,reject)=>{
    const child=spawn(opts.ffmpegPath??'ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-i',file,'-vn','-ac','1','-ar','16000','-t',String(maxSeconds+1),'-f','s16le','pipe:1'],{stdio:['ignore','pipe','pipe']});
    const chunks:Buffer[]=[];let bytes=0,stderr=Buffer.alloc(0),failure:unknown;
    const stop=(error:unknown)=>{failure??=error;child.kill('SIGKILL');};
    const abort=()=>stop(invalidAudio());
    const timer=setTimeout(()=>stop(invalidAudio()),opts.timeoutMs??30000);
    signal?.addEventListener('abort',abort,{once:true});
    if(signal?.aborted)abort();
    child.stdout.on('data',(chunk:Buffer)=>{
     if(failure)return;
     bytes+=chunk.length;
     if(bytes>(maxSeconds+1)*32000){stop(audioTooLong());return;}
     chunks.push(chunk);
    });
    child.stderr.on('data',(chunk:Buffer)=>{if(stderr.length<200)stderr=Buffer.concat([stderr,chunk.subarray(0,200-stderr.length)]);});
    child.on('error',error=>{failure??=error;});
    // 等 close 再删输入：超时和取消也要先等子进程退出、管道关闭。
    child.on('close',code=>{
     clearTimeout(timer);signal?.removeEventListener('abort',abort);
     if(failure){reject(failure);return;}
     if(code!==0||!bytes){reject(Object.assign(invalidAudio(),{cause:stderr.toString('utf8')}));return;}
     resolve(Buffer.concat(chunks,bytes));
    });
   });
   const seconds=pcm.length/32000;
   if(seconds>maxSeconds)throw audioTooLong();
   return {wav:Buffer.concat([wavHeader(pcm.length),pcm]),seconds};
  } finally {await unlink(file);}
 };
}
export function cpaTranscriber(baseUrl:string,keyFile:string,model='mimo-v2.5-asr',readKey=()=>readFileSync(keyFile,'utf8').trim()):Transcriber {
 const endpoint=new URL(baseUrl.replace(/\/$/,'')+'/chat/completions');
 return async(wav,signal)=>{
  let response:Response,raw:string;
  try {
   response=await fetch(endpoint,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json',Authorization:`Bearer ${readKey()}`},body:JSON.stringify({model,messages:[{role:'system',content:'中文口语，保留昵称与口头语，标点按停顿。'},{role:'user',content:[{type:'input_audio',input_audio:{data:wav.toString('base64'),format:'wav'}}]}]}),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(100000)]):AbortSignal.timeout(100000)});
   if(!response.ok){await response.body?.cancel();throw unavailable();}
   // 流式限长，异常网关不能把整个响应无限读进内存；从不打印响应体。
   const chunks:Uint8Array[]=[];let bytes=0;
   for await(const chunk of response.body??[]){bytes+=chunk.length;if(bytes>100000)throw invalidResult();chunks.push(chunk);}
   raw=Buffer.concat(chunks).toString('utf8');
  } catch(error) {if(error instanceof Problem)throw error;throw unavailable();}
  try {
   const data=JSON.parse(raw),choice=data.choices?.[0];
   // 部分兼容网关省略结束原因；有标记时，只接受完整结束，不能把截断的口述当成转写成功。
   if(choice?.finish_reason!==undefined&&choice.finish_reason!=='stop')throw invalidResult();
   const result=transcribeResultSchema.parse({text:choice?.message?.content});
   return {...result,tokens:Number.isSafeInteger(data.usage?.total_tokens)&&data.usage.total_tokens>=0?data.usage.total_tokens:null};
  } catch {throw invalidResult();}
 };
}
