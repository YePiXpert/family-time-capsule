import { z } from 'zod';
import { MODEL_IDS, Problem } from './store.ts';
export const photoSchema=z.object({id:z.string().min(1).max(100),date:z.string().max(40).optional(),place:z.string().max(50).optional(),image:z.string().max(710000).regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/)}).strict();
export const groupSchema=z.object({photoIds:z.array(z.string().min(1).max(100)).min(1).max(100),title:z.string().max(100),summary:z.string().max(600)}).strict();
export const inputSchema=z.object({
 requestId:z.string().uuid(),model:z.enum(MODEL_IDS),
 photos:z.array(photoSchema).max(20).default([]),
 context:z.string().max(4000).default(''),
 groups:z.array(groupSchema).max(100).optional(),
 mode:z.enum(['photos','merge']).default('photos'),
}).strict();
export type AIInput=z.infer<typeof inputSchema>;
export type Group=z.infer<typeof groupSchema>;
export function parseResult(value:unknown,kind:'group'|'write',input:AIInput) {
 if(kind==='write') return z.object({title:z.string().max(100),text:z.string().max(2000)}).strict().parse(value);
 const result=z.object({groups:z.array(groupSchema).min(1).max(100)}).strict().parse(value);
 const expected=input.mode==='merge'?input.groups!.flatMap(g=>g.photoIds):input.photos.map(p=>p.id);
 const actual=result.groups.flatMap(g=>g.photoIds);
 if(actual.length!==expected.length || new Set(actual).size!==actual.length || actual.some(id=>!expected.includes(id)))
  throw new Problem(502,'INVALID_RESULT','AI 分组不完整，请重试或手动整理。');
 // A model can merge groups within a date, but cannot silently combine known different days.
 const dates=new Map(input.photos.map(p=>[p.id,p.date?.slice(0,10)]));
 if(result.groups.some(g=>new Set(g.photoIds.map(id=>dates.get(id)).filter(Boolean)).size>1))
  throw new Problem(502,'INVALID_RESULT','AI 混合了不同日期，请重试或手动整理。');
 return result;
}
