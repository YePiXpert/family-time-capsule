import { loadAIConfig } from '../src/ai-config.ts';
import { textProvider } from '../src/provider.ts';
import { MODEL_ID, MAX_COMPLETION_TOKENS, REASONING_POLICY } from '../src/ai-model.ts';
import { Problem } from '../src/store.ts';
import type { AIInput } from '../src/contracts.ts';

export function liveProbe() {
 if(!process.argv.includes('--allow-live'))throw new Error('Real calls disabled. Obtain App usage/billing authorization and configure a configured upstream credential before passing --allow-live.');
 const provider=textProvider(loadAIConfig('AI'));
 return async(input:AIInput)=>{
  const mode=input.writingMode,start=performance.now();
  const metadata={model:MODEL_ID,mode,reasoningEffort:REASONING_POLICY[mode],maxCompletionTokens:MAX_COMPLETION_TOKENS};
  try {
   const {tokens}=await provider(input);
   console.log(JSON.stringify({...metadata,success:true,elapsedMs:Math.round(performance.now()-start),tokens}));
  } catch(error) {
   console.log(JSON.stringify({...metadata,success:false,elapsedMs:Math.round(performance.now()-start),tokens:null,errorCode:error instanceof Problem?error.code:'PROBE_FAILED'}));
   process.exitCode=1;
   throw new Error('Probe stopped after a failed request; no retry or fallback.');
  }
 };
}
