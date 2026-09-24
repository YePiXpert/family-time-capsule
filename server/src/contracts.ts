import { z } from 'zod';
import { Problem } from './store.ts';
import { MODEL_ID } from './ai-model.ts';
import { BANNED_WORDS } from './prompts.ts';
export { promptIsWellFormed } from './prompts.ts';
export const inputSchema=z.object({
 requestId:z.string().uuid(),model:z.literal(MODEL_ID).default(MODEL_ID),
 // 1.0.3 手机仍发送 photos: []；保留字段，严格解析只接受空数组。
 photos:z.array(z.unknown()).max(0).default([]),
 context:z.string().max(60000).default(''),
 writingMode:z.enum(['polish','recap','ask','question','editor']),
}).strict();
export type AIInput=z.infer<typeof inputSchema>;
export type WritingMode=AIInput['writingMode'];
/** 润色的长度上限只约束正文：客户端把标题和正文放在同一个 context 里。 */
export const POLISH_BODY_LIMIT=2000;
const POLISH_BODY_MARK='正文：\n';
export function polishBody(context:string) {
 const at=context.indexOf(POLISH_BODY_MARK);
 return at<0?context:context.slice(at+POLISH_BODY_MARK.length);
}
const hasBannedWord=(text:string)=>BANNED_WORDS.some(word=>text.includes(word));
const questionError=()=>new Problem(502,'INVALID_RESULT','AI 问得不合规矩，请重试。');
export function checkQuestion(q:string) {
 const text=q.trim();
 if(!text||[...text].length>30||/[!！#]|\p{Extended_Pictographic}/u.test(text)||hasBannedWord(text))throw questionError();
 return text;
}
const questionSchema=z.string().transform(checkQuestion);
const editorError=()=>new Problem(502,'INVALID_RESULT','AI 的目录建议不合规矩，请重试。');
const editorContextSchema=z.object({year:z.string().regex(/^\d{4}$/),records:z.array(z.object({
 id:z.string().min(1).max(100),date:z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/),by:z.string().max(20).optional(),
 title:z.string().max(100),text:z.string().max(4000),first:z.boolean(),quote:z.boolean(),photos:z.boolean(),
}).strict()).min(1).max(400)}).strict();
export function parseEditorContext(context:string) {
 try {
  const data=editorContextSchema.parse(JSON.parse(context));
  if(new Set(data.records.map(record=>record.id)).size!==data.records.length||data.records.some(record=>!record.date.startsWith(data.year+'-')))throw new Problem(400,'INVALID_INPUT','这一年的记录清单格式不对，请检查后重试。');
  return data;
 } catch {throw new Problem(400,'INVALID_INPUT','这一年的记录清单格式不对，请检查后重试。');}
}
const editorResultSchema=z.object({title:z.string(),chapters:z.array(z.object({
 month:z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),picks:z.array(z.string()).min(1).max(3),
 quote:z.object({recordId:z.string(),text:z.string().trim()}).strict().optional(),
}).strict()).min(1).max(12),notes:z.string()}).strict();
function parseEditorResult(value:unknown,input:AIInput) {
 try {
  const result=editorResultSchema.parse(value),context=parseEditorContext(input.context);
  const records=new Map(context.records.map(record=>[record.id,record])),months=new Set<string>(),picks=new Set<string>();
  if([...result.title].length<4||[...result.title].length>8||hasBannedWord(result.title)||[...result.notes].length>200||hasBannedWord(result.notes))throw editorError();
  for(const chapter of result.chapters) {
   if(!chapter.month.startsWith(context.year+'-')||months.has(chapter.month))throw editorError();
   months.add(chapter.month);
   for(const id of chapter.picks) {
    if(picks.has(id)||records.get(id)?.date.slice(0,7)!==chapter.month)throw editorError();
    picks.add(id);
   }
   if(chapter.quote) {
    const {recordId,text}=chapter.quote,record=records.get(recordId);
    if(!record||record.date.slice(0,7)!==chapter.month||!text||[...text].length>40||(!record.text.includes(text)&&!record.title.includes(text)))throw editorError();
   }
  }
  return result;
 } catch {throw editorError();}
}
export function parseResult(value:unknown,input:AIInput) {
 if(input.writingMode==='editor')return parseEditorResult(value,input);
 try {
  if(input.writingMode==='ask')return z.object({questions:z.array(questionSchema).min(1).max(3),first:z.boolean()}).strict().parse(value);
  if(input.writingMode==='question')return z.object({question:questionSchema}).strict().parse(value);
 } catch {throw questionError();}
 return z.object({title:z.string().max(100),text:z.string().max(2000)}).strict().parse(value);
}

export const transcribeResultSchema=z.object({text:z.string().trim().max(5000)}).strict();
