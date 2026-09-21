import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { liveProbe } from './probe-common.ts';
import { MODEL_ID } from '../src/ai-model.ts';
const probe=liveProbe();
const image='data:image/jpeg;base64,'+readFileSync(new URL('../tests/fixtures/shapes.jpg',import.meta.url)).toString('base64');
// Exactly two calls, synthetic image, no retry or full-result output.
await probe('group',{requestId:randomUUID(),model:MODEL_ID,mode:'photos',context:'这是几何图形测试图片，不是家庭照片。请描述颜色和形状。',photos:[{id:'shapes',date:'2020-01-01T12:00:00',image}]});
await probe('write',{requestId:randomUUID(),model:MODEL_ID,mode:'photos',context:'这是几何图形测试。请客观描述可见图形。',photos:[{id:'shapes',image}]});
