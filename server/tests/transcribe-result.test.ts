import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cpaTranscriber } from '../src/transcribe.ts';
import { Problem } from '../src/store.ts';

test('转写拒绝已截断、过滤或异常结束的上游结果，不能静默丢失口述',async t=>{
 let finishReason:unknown='length';
 t.mock.method(globalThis,'fetch',async()=>Response.json({
  choices:[{finish_reason:finishReason,message:{content:'今天我想说的是'}}],
  usage:{total_tokens:7},
 }));
 const transcriber=cpaTranscriber('https://gateway.invalid/v1','unused','test-asr',()=> 'synthetic-test-key');
 for(finishReason of ['length','content_filter','tool_calls','unknown',null,7]) {
  await assert.rejects(transcriber(Buffer.from('synthetic-audio')),
   (error:unknown)=>error instanceof Problem&&error.code==='INVALID_RESULT'&&error.status===502);
 }
 finishReason='stop';
 assert.deepEqual(await transcriber(Buffer.from('synthetic-audio')),{text:'今天我想说的是',tokens:7});
 // 保留原有兼容性：没有返回结束标记的网关仍按内容契约校验。
 finishReason=undefined;
 assert.deepEqual(await transcriber(Buffer.from('synthetic-audio')),{text:'今天我想说的是',tokens:7});
});
