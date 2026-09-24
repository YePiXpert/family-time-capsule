import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { MODEL_ID, TRANSCRIBE_MODEL_ID } from './ai-model.ts';

export type AIConfig = Readonly<{
 model:typeof MODEL_ID|typeof TRANSCRIBE_MODEL_ID;
 baseUrl:string; keyFile:string;
}>;
const invalid=()=>new Error('Invalid AI configuration: check model, HTTPS base URL and secret file.');

export function validateAIConfig(config:AIConfig,model:AIConfig['model']) {
 if(config.model!==model||!isAbsolute(config.keyFile))throw invalid();
 let endpoint:URL;
 try {endpoint=new URL(config.baseUrl);} catch {throw invalid();}
 if(endpoint.protocol!=='https:'||!endpoint.hostname||endpoint.username||endpoint.password||endpoint.search||endpoint.hash)throw invalid();
}

export function readAIKey(config:AIConfig) {
 let key:string;
 try {key=readFileSync(config.keyFile,'utf8').trim();} catch {throw invalid();}
 if(!key||/\s/.test(key))throw invalid();
 return key;
}

// The owner configures one compatible upstream for text and dedicated ASR.
// Legacy vendor environment variables are never used as fallbacks.
export function loadAIConfig(kind:'AI'|'TRANSCRIBE',env:NodeJS.ProcessEnv=process.env):AIConfig {
 const model=kind==='AI'?MODEL_ID:TRANSCRIBE_MODEL_ID;
 const config={model:env[`${kind}_MODEL`],
  baseUrl:(env.UPSTREAM_BASE_URL??'').replace(/\/$/,''),keyFile:env.UPSTREAM_KEY_FILE??''} as AIConfig;
 validateAIConfig(config,model);
 readAIKey(config); // Fail before opening the database or accepting requests.
 return Object.freeze(config);
}
