import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { cpaProvider } from '../src/provider.ts';
const provider=cpaProvider(process.env.CPA_BASE_URL??'http://10.66.66.2:8317/v1','/opt/xiaomei-ai/secrets/cpa-key');
const image='data:image/jpeg;base64,'+readFileSync(new URL('../tests/fixtures/shapes.jpg',import.meta.url)).toString('base64');
for(const model of ['deepseek-flash'] as const){
 try{
 const result=await provider('group',{requestId:randomUUID(),model,mode:'photos',context:'这是几何图形测试图片，不是家庭照片。请描述颜色和形状。',photos:[{id:'shapes',date:'2020-01-01T12:00:00',image}]});
 console.log(JSON.stringify({model,kind:'group',...result}));
 const writing=await provider('write',{requestId:randomUUID(),model,mode:'photos',context:'这是几何图形测试。请客观描述可见图形。',photos:[{id:'shapes',image}]});
 console.log(JSON.stringify({model,kind:'write',...writing}));
 }catch(e){console.log(JSON.stringify({model,error:e instanceof Error?e.message:'failed'}));process.exitCode=1;}
}
