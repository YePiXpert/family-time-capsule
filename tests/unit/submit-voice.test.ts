import { expect, it } from 'vitest';
import { submitVoice, type VoiceReceipt } from '@/mobile/src/contributions/submit-voice';
function fixture(failAt?:string) {
  const receipt:VoiceReceipt={id:'voice',originalId:'original',assetId:null,memoryId:'memory',authorPersonId:'dad',authorName:'爸爸',visibility:'family',text:''};
  let remote: { id: string; revision: number; status: string; memoryEventId: string | null; items: { id: string; assetId: string | null }[] } | null=null, uploads=0, posts=0, failed=false, active=true;
  const guard=()=>{if(!active)throw Error('scope_changed');};
  const request=async(path:string,init?:RequestInit)=>{
    if (!init) {if(!remote)throw {status:404};return structuredClone(remote);}
    if(init.method==='PUT') {
      const value=JSON.parse(init.body as string);
      remote={id:receipt.id,revision:(remote?.revision??0)+1,status:'editing',memoryEventId:null,items:value.content.items};
      if(!failed&&failAt===(remote.revision===1?'create':'attach')){failed=true;throw Error('lost_response');}
      return structuredClone(remote);
    }
    posts++;if(!remote)throw Error('missing_draft');remote.status='published';remote.memoryEventId=receipt.memoryId;
    if(!failed&&failAt==='post'){failed=true;throw Error('lost_response');}
    return {id:receipt.id};
  };
  const run=()=>submitVoice(receipt,request,async()=>{uploads++;if(failAt==='scope')active=false;return 'audio';},async id=>{receipt.assetId=id;},guard);
  return {run,receipt,get:()=>({remote,uploads,posts})};
}
for(const phase of ['create','attach','post'])it(`recovers a lost ${phase} response without duplicate audio or contribution`,async()=>{
  const f=fixture(phase);
  await expect(f.run()).rejects.toThrow('lost_response');
  await f.run();
  expect(f.get().uploads).toBe(1);expect(f.get().posts).toBe(1);
  expect(f.get().remote?.memoryEventId).toBe('memory');
});
it('stops before attachment when account scope changes during upload',async()=>{
  const f=fixture('scope');await expect(f.run()).rejects.toThrow('scope_changed');
  expect(f.get().posts).toBe(0);expect(f.receipt.assetId).toBeNull();
});
