import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { MODEL_ID, TRANSCRIBE_MODEL_ID } from './ai-model.ts';

export type MiMoConfig = Readonly<{
 provider:'mimo'; model:typeof MODEL_ID|typeof TRANSCRIBE_MODEL_ID;
 baseUrl:string; keyFile:string; access:'payg-approved'|'token-plan-authorized';
}>;
const tokenPlanUrls = new Set([
 'https://token-plan-cn.xiaomimimo.com/v1',
 'https://token-plan-sgp.xiaomimimo.com/v1',
 'https://token-plan-ams.xiaomimimo.com/v1',
]);
const invalid=()=>new Error('Invalid MiMo configuration: check provider, model, endpoint, secret file and usage authorization.');

export function validateMiMoConfig(config:MiMoConfig,model:MiMoConfig['model']) {
 if(config.provider!=='mimo'||config.model!==model||!isAbsolute(config.keyFile))throw invalid();
 // No vendor fallback or arbitrary proxy. Token Plan requires an independently verified
 // official exception for this App; the flag records the operator's authorization only.
 if(config.access==='payg-approved') {
  if(config.baseUrl!=='https://api.xiaomimimo.com/v1')throw invalid();
 } else if(config.access==='token-plan-authorized') {
  if(!tokenPlanUrls.has(config.baseUrl))throw invalid();
 } else throw invalid();
}

export function readMiMoKey(config:MiMoConfig) {
 let key:string;
 try {key=readFileSync(config.keyFile,'utf8').trim();} catch {throw invalid();}
 if(!key||/\s/.test(key)||(key.startsWith('tp-')!==(config.access==='token-plan-authorized')))throw invalid();
 return key;
}

// Content and ASR are always independent. No CPA_* aliases or text-to-ASR defaults.
export function loadMiMoConfig(kind:'AI'|'TRANSCRIBE',env:NodeJS.ProcessEnv=process.env):MiMoConfig {
 const model=kind==='AI'?MODEL_ID:TRANSCRIBE_MODEL_ID;
 const config={provider:env[`${kind}_PROVIDER`],model:env[`${kind}_MODEL`],
  baseUrl:(env[`${kind}_BASE_URL`]??'').replace(/\/$/,''),keyFile:env[`${kind}_KEY_FILE`]??'',
  access:env[`${kind}_ACCESS`]} as MiMoConfig;
 validateMiMoConfig(config,model);
 readMiMoKey(config); // Fail before opening the database or accepting requests.
 return Object.freeze(config);
}
