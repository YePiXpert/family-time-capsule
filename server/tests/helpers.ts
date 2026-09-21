import type { Transcoder, Transcriber } from '../src/transcribe.ts';
export const unusedTranscribe:{transcoder:Transcoder;transcriber:Transcriber}={
 transcoder:async()=>{throw new Error('本测试不转码');},
 transcriber:async()=>{throw new Error('本测试不转写');},
};
// 合成资料，只用于文本契约验证。
export const editorContext={year:'2026',records:[
 {id:'r1',date:'2026-09-05',by:'爸爸',title:'桌边的积木',text:'她说再搭一层。家人写下温馨。'+'字'.repeat(41),first:false,quote:true,photos:true},
 {id:'r2',date:'2026-09-10',by:'妈妈',title:'门口的鞋',text:'她把鞋放在门边。',first:false,quote:false,photos:true},
 {id:'r3',date:'2026-10-02',by:'爸爸',title:'窗边的风',text:'窗边有风。',first:false,quote:false,photos:false},
 {id:'r4',date:'2026-09-11',by:'外婆',title:'厨房的碗',text:'她拿了一只碗。',first:false,quote:false,photos:false},
 {id:'r5',date:'2026-09-12',by:'妈妈',title:'蓝色的杯',text:'她选了蓝色杯子。',first:false,quote:false,photos:true},
]};
export const editorResult={title:'桌边到窗边',chapters:[
 {month:'2026-09',picks:['r1','r2'],quote:{recordId:'r1',text:'再搭一层'}},
 {month:'2026-10',picks:['r3'],quote:{recordId:'r3',text:'窗边有风。'}},
],notes:'每月选了有字的记录。'};
