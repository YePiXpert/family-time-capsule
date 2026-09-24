import { MODEL_ID, REASONING_POLICY, MAX_COMPLETION_TOKENS } from './ai-model.ts';
import { readAIKey, validateAIConfig, type AIConfig } from './ai-config.ts';
import { PROMPTS } from './prompts.ts';
import { Problem } from './store.ts';
import { parseResult, type AIInput } from './contracts.ts';
export type ProviderResult={result:ReturnType<typeof parseResult>;tokens:number|null};
export type Provider=(input:AIInput)=>Promise<ProviderResult>;
export function textProvider(config:AIConfig):Provider {
 validateAIConfig(config,MODEL_ID);
 const endpoint=new URL(config.baseUrl+'/chat/completions');
 return async (input) => {
  const mode=input.writingMode;
  const instructions=PROMPTS[mode];
  const task=mode==='ask'?'像访谈者追问一到三个问题，不写正文':mode==='question'?'给今天一个小问题':mode==='editor'?'提一个目录建议，不改原文':mode==='polish'?'润色家人原文，保留原意与事实':'根据这一年的记录标题与第一次清单写年度寄语草稿';
  const content:unknown[]=[{type:'text',text:JSON.stringify({task,userContext:input.context})}];
  let response:Response,raw:string;
  try {
   response=await fetch(endpoint,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json',Authorization:`Bearer ${readAIKey(config)}`},body:JSON.stringify({model:config.model,messages:[{role:'system',content:instructions},{role:'user',content}],max_completion_tokens:MAX_COMPLETION_TOKENS,stream:false,response_format:{type:'json_object'},reasoning_effort:REASONING_POLICY[mode]}),signal:AbortSignal.timeout(100000)});
   if(!response.ok) { await response.body?.cancel(); throw new Problem(response.status===429?429:502,'UPSTREAM_UNAVAILABLE',response.status===429?'模型当前额度或并发受限，请稍后再试。':'AI 暂时不可用，请稍后重试。'); }
   const chunks:Uint8Array[]=[];let bytes=0;
   for await(const chunk of response.body??[]){bytes+=chunk.length;if(bytes>250000)throw new Problem(502,'INVALID_RESULT','AI 返回内容过大，请重试。');chunks.push(chunk);}
   raw=Buffer.concat(chunks).toString('utf8');
  } catch(error) { if(error instanceof Problem)throw error;throw new Problem(502,'UPSTREAM_UNAVAILABLE','AI 连接中断或超时，草稿仍已保留。'); }
  try {
   const data=JSON.parse(raw),choice=data.choices?.[0],text=choice?.message?.content;
   if(choice?.finish_reason!=='stop'||typeof text!=='string'||!text.trim())throw new Error('incomplete result');
   return {result:parseResult(JSON.parse(text),input),tokens:Number.isSafeInteger(data.usage?.total_tokens)&&data.usage.total_tokens>=0?data.usage.total_tokens:null};
  } catch(e) { if(e instanceof Problem)throw e;throw new Problem(502,'INVALID_RESULT','AI 返回格式不完整，请重试或手动整理。'); }
 };
}
