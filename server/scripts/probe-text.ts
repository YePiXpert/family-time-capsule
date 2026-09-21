import { randomUUID } from 'node:crypto';
import { liveProbe } from './probe-common.ts';
import { MODEL_ID } from '../src/ai-model.ts';
import type { WritingMode } from '../src/contracts.ts';
// 全部为手写合成样例，不使用家庭照片、正文或真实姓名。
const probe=liveProbe();
const records=[
 {id:'r1',date:'2026-09-01',by:'爸爸',title:'清早的窗',text:'我抱她站在窗边，楼下有人扫地。',first:false,quote:false,photos:true},
 {id:'r2',date:'2026-09-10',by:'妈妈',title:'翻过去了',text:'她第一次自己翻过去，我正在叠毛巾。',first:true,quote:false,photos:false},
 {id:'r3',date:'2026-09-20',by:'外婆',title:'蓝色的碗',text:'她拍了两下蓝色的碗，我又把碗往里挪了挪。',first:false,quote:false,photos:true},
 {id:'r4',date:'2026-10-02',by:'爸爸',title:'雨声',text:'雨落在窗台上，她停下来听。',first:false,quote:false,photos:true},
 {id:'r5',date:'2026-10-12',by:'妈妈',title:'门口的鞋',text:'我回家时，她伸手抓住了我的袖子。',first:false,quote:false,photos:false},
 {id:'r6',date:'2026-10-21',by:'外婆',title:'午后的歌',text:'我唱到第二句，她又咿呀了一声。',first:false,quote:true,photos:false},
];
const samples:{mode:WritingMode;summary:string;context:string}[]=[
 {mode:'ask',summary:'短句：今天她笑了',context:'落款：爸爸\n月龄：4 个月\n日期：2026-09-05\n正文：今天她笑了\n已标第一次：否'},
 {mode:'ask',summary:'长段、合成名字与她的原话',context:'落款：妈妈\n月龄：36 个月\n日期：2026-09-06\n正文：小禾午睡醒来，抱着布兔坐在门口。我问她要不要出去，她说「等兔兔穿鞋」。她找了两片纸放在兔子的脚下，又把我拉过去看。我们等雨小了一点才出门，她一路抱着兔子，没再提鞋的事。\n已标第一次：否'},
 {mode:'ask',summary:'第一次翻身但未标记',context:'落款：妈妈\n月龄：4 个月\n日期：2026-09-07\n正文：今天她第一次翻身，我刚把毛巾放下就看见了。\n已标第一次：否'},
 {mode:'ask',summary:'主题：出生那天',context:'落款：爸爸\n主题：出生那天\n日期：2026-05-01\n正文：早上六点到医院，我一直拿着水杯。见到她时，我只顾着看她的手。\n已标第一次：否'},
 {mode:'ask',summary:'只有五个字',context:'她抓我袖子'},
 {mode:'question',summary:'最近标题与近七天问题',context:'月龄：4 个月\n今天：2026-09-08\n最近标题：2026-09-01 窗边；2026-09-05 翻过去了\n近七天问过：她醒来时发出什么声音？今天谁抱她出门了？'},
 {mode:'question',summary:'空标题与已问清单',context:'月龄：2 个月\n今天：2026-09-08\n最近标题：[]\n近七天问过：[]'},
 {mode:'letter',summary:'空草稿',context:'落款：爸爸\n月龄：4 个月\n拆封日期：2044-05-01\n草稿：'},
 {mode:'letter',summary:'已有一段草稿',context:'落款：妈妈\n月龄：4 个月\n拆封日期：2044-05-01\n草稿：今天下班回来，你还没有睡。我把包放下就抱起你，饭是在你睡着后吃的。'},
 {mode:'editor',summary:'两个月、六条合成记录',context:JSON.stringify({year:'2026',records})},
 {mode:'polish',summary:'保留昵称与她的原话',context:'落款：妈妈\n标题：兔兔的鞋\n正文：\n小禾把纸放兔兔脚下，说「等兔兔穿鞋」。我我等她摆好，一起出了门。'},
 {mode:'recap',summary:'年度标题、第一次与她说的话',context:'落款：爸爸\n年份：2026\n标题：窗边的风、兔兔的鞋、门口的书包\n第一次：第一次自己背书包\n她说的话：「等兔兔穿鞋」\n已写寄语：无'},
];
// One synthetic example per mode: six calls maximum, no retry or output text.
const seen=new Set<WritingMode>();
for(const {mode,context} of samples){
 if(seen.has(mode))continue;seen.add(mode);
 await probe('write',{requestId:randomUUID(),model:MODEL_ID,mode:'photos',writingMode:mode,photos:[],context});
}
