import type { Transcoder, Transcriber } from '../src/transcribe.ts';
export const unusedTranscribe:{transcoder:Transcoder;transcriber:Transcriber}={
 transcoder:async()=>{throw new Error('本测试不转码');},
 transcriber:async()=>{throw new Error('本测试不转写');},
};
