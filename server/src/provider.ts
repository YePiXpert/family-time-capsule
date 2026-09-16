import { readFileSync } from 'node:fs';
import { MODEL_ID } from './ai-model.ts';
import { GROUP_PROMPT, WRITE_PROMPT, POLISH_PROMPT } from './prompts.ts';
import { Problem } from './store.ts';
import { parseResult, type AIInput } from './contracts.ts';
export type ProviderResult={result:ReturnType<typeof parseResult>;tokens:number|null};
export type Provider=(kind:'group'|'write',input:AIInput)=>Promise<ProviderResult>;
export function cpaProvider(baseUrl:string,keyFile:string):Provider {
 const endpoint=new URL(baseUrl.replace(/\/$/,'')+'/chat/completions');
 return async (kind,input) => {
  const instructions=kind==='write'?(input.writingMode==='polish'?POLISH_PROMPT:WRITE_PROMPT):GROUP_PROMPT;
  const content:unknown[]=[{type:'text',text:JSON.stringify({task:input.writingMode==='polish'?'润色用户原文，保留原意与事实':input.mode==='merge'?'合并属于同一天同一件事情的分组摘要，保留全部照片ID':'分析所选照片',userContext:input.context,groups:input.groups})}];
  for(const photo of input.photos) content.push({type:'text',text:JSON.stringify({photoId:photo.id,capturedAt:photo.date??null,localPlaceGroup:photo.place??null})},{type:'image_url',image_url:{url:photo.image,detail:'low'}});
  // High thinking shares max_tokens with the final JSON; reserve room for both.
  // https://api-docs.deepseek.com/guides/thinking_mode/
  let response:Response;
  try {
   response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${readFileSync(keyFile,'utf8').trim()}`},body:JSON.stringify({model:MODEL_ID,messages:[{role:'system',content:instructions},{role:'user',content}],max_tokens:16384,stream:false,response_format:{type:'json_object'},thinking:{type:'enabled'},reasoning_effort:'high'}),signal:AbortSignal.timeout(100000)});
  } catch { throw new Problem(502,'UPSTREAM_UNAVAILABLE','AI 连接中断或超时，草稿仍已保留。'); }
  if(!response.ok) { await response.body?.cancel(); throw new Problem(response.status===429?429:502,'UPSTREAM_UNAVAILABLE',response.status===429?'模型当前额度或并发受限，请稍后再试。':'AI 暂时不可用，请稍后重试。'); }
  const raw=await response.text();
  if(raw.length>250000) throw new Problem(502,'INVALID_RESULT','AI 返回内容过大，请重试。');
  try {
   const data=JSON.parse(raw), text=data.choices?.[0]?.message?.content;
   if(typeof text!=='string') throw new Error('missing result');
   const clean=text.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'');
   return {result:parseResult(JSON.parse(clean),kind,input),tokens:Number.isSafeInteger(data.usage?.total_tokens)&&data.usage.total_tokens>=0?data.usage.total_tokens:null};
  } catch { throw new Problem(502,'INVALID_RESULT','AI 返回格式不完整，请重试或手动整理。'); }
 };
}
