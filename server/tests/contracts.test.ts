import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { checkQuestion, inputSchema, parseEditorContext, parseResult, type WritingMode } from '../src/contracts.ts';
import { Problem } from '../src/store.ts';
import { editorContext, editorResult } from './helpers.ts';
const input=(writingMode:WritingMode)=>inputSchema.parse({requestId:randomUUID(),writingMode,context:JSON.stringify(editorContext)});
const invalid=(fn:()=>unknown,message='AI 问得不合规矩，请重试。')=>assert.throws(fn,(error:unknown)=>error instanceof Problem&&error.status===502&&error.code==='INVALID_RESULT'&&error.message===message);
for(const [name,q] of Object.entries({empty:'  ',long:'字'.repeat(31),exclamation:'说了什么！',ascii:'说了什么!',emoji:'她笑了😀',banned:'温馨吗？',hashtag:'#说了什么？'}))test(`question rejects ${name}`,()=>invalid(()=>checkQuestion(q)));
test('questions trim whitespace and count Unicode code points',()=>{
 assert.equal(checkQuestion('  谁在旁边？  '),'谁在旁边？');
 assert.equal(checkQuestion('字'.repeat(30)),'字'.repeat(30));
 assert.equal(checkQuestion('𠮷'.repeat(30)),'𠮷'.repeat(30));
 invalid(()=>checkQuestion('𠮷'.repeat(31)));
});
for(const mode of ['generate','polish','recap'] as const)test(`${mode} retains title/text limits`,()=>{
 assert.deepEqual(parseResult({title:'标题',text:'正文'},'write',input(mode)),{title:'标题',text:'正文'});
 assert.throws(()=>parseResult({title:'字'.repeat(101),text:''},'write',input(mode)));
 assert.throws(()=>parseResult({title:'',text:'字'.repeat(2001)},'write',input(mode)));
});
test('ask accepts one through three questions and a boolean first',()=>{
 for(const n of [1,2,3])assert.deepEqual(parseResult({questions:Array(n).fill('谁在旁边？'),first:true},'write',input('ask')),{questions:Array(n).fill('谁在旁边？'),first:true});
});
for(const [name,value] of Object.entries({empty:{questions:[],first:false},four:{questions:Array(4).fill('谁在旁边？'),first:false},first:{questions:['谁在旁边？'],first:'false'},missing:{questions:['谁在旁边？']},extra:{questions:['谁在旁边？'],first:false,text:'正文'}}))test(`ask rejects ${name}`,()=>invalid(()=>parseResult(value,'write',input('ask'))));
test('question accepts only its single named field',()=>{
 assert.deepEqual(parseResult({question:'谁在旁边？'},'write',input('question')),{question:'谁在旁边？'});
 invalid(()=>parseResult({question:'谁在旁边？',text:'正文'},'write',input('question')));
 invalid(()=>parseResult({question:12},'write',input('question')));
});
test('letter accepts two or three questions and rejects one or four',()=>{
 for(const n of [2,3])assert.deepEqual(parseResult({questions:Array(n).fill('谁在旁边？')},'write',input('letter')),{questions:Array(n).fill('谁在旁边？')});
 for(const n of [1,4])invalid(()=>parseResult({questions:Array(n).fill('谁在旁边？')},'write',input('letter')));
});
for(const mode of ['ask','question','letter'] as const)test(`${mode} applies question content validation`,()=>{
 const value=mode==='ask'?{questions:['温馨吗？'],first:false}:mode==='question'?{question:'温馨吗？'}:{questions:['谁在旁边？','温馨吗？']};
 invalid(()=>parseResult(value,'write',input(mode)));
});
test('editor accepts grounded picks and verbatim quotes including family banned words',()=>{
 assert.deepEqual(parseResult(editorResult,'write',input('editor')),editorResult);
 const value=structuredClone(editorResult);value.chapters[0]!.quote={recordId:'r1',text:' 温馨 '};
 const result=parseResult(value,'write',input('editor')) as typeof editorResult;
 assert.equal(result.chapters[0]!.quote.text,'温馨');
 value.chapters[0]!.quote.text=editorContext.records[0]!.title;
 assert.doesNotThrow(()=>parseResult(value,'write',input('editor')));
});
const badEditors:Record<string,(value:typeof editorResult)=>void>={
 unknown:v=>{v.chapters[0]!.picks=['missing'];},
 duplicate:v=>{v.chapters[0]!.picks=['r1','r1'];},
 crossChapterDuplicate:v=>{v.chapters[1]!.picks=['r1'];},
 crossMonth:v=>{v.chapters[0]!.picks=['r3'];},
 fourPicks:v=>{v.chapters[0]!.picks=['r1','r2','r4','r5'];},
 emptyPicks:v=>{v.chapters[0]!.picks=[];},
 inventedQuote:v=>{v.chapters[0]!.quote.text='不在原文里';},
 longQuote:v=>{v.chapters[0]!.quote.text='字'.repeat(41);},
 blankQuote:v=>{v.chapters[0]!.quote.text=' ';},
 unknownQuote:v=>{v.chapters[0]!.quote.recordId='missing';},
 crossMonthQuote:v=>{v.chapters[0]!.quote={recordId:'r3',text:'窗边有风。'};},
 shortTitle:v=>{v.title='三个字';},
 longTitle:v=>{v.title='字'.repeat(9);},
 bannedTitle:v=>{v.title='温馨的一年';},
 bannedNotes:v=>{v.notes='这些很珍贵';},
 longNotes:v=>{v.notes='字'.repeat(201);},
 wrongYear:v=>{v.chapters[0]!.month='2025-09';},
 invalidMonth:v=>{v.chapters[0]!.month='2026-13';},
 repeatedMonth:v=>{v.chapters.push(structuredClone(v.chapters[0]!));},
 noChapters:v=>{v.chapters=[];},
};
for(const [name,mutate] of Object.entries(badEditors))test(`editor rejects ${name}`,()=>{
 const value=structuredClone(editorResult);mutate(value);
 invalid(()=>parseResult(value,'write',input('editor')),'AI 的目录建议不合规矩，请重试。');
});
test('editor accepts optional quote and Unicode limits',()=>{
 const value={title:'𠮷'.repeat(4),chapters:[{month:'2026-09',picks:['r1']}],notes:'字'.repeat(200)};
 assert.deepEqual(parseResult(value,'write',input('editor')),value);
});
test('editor input rejects malformed, oversized and ambiguous record tables',()=>{
 const record=editorContext.records[0]!;
 for(const value of ['not json',JSON.stringify({...editorContext,records:[]}),JSON.stringify({...editorContext,records:Array(401).fill(record)}),JSON.stringify({...editorContext,records:[record,record]}),JSON.stringify({...editorContext,year:'2025'}),JSON.stringify({...editorContext,records:[{...record,text:'字'.repeat(4001)}]}),JSON.stringify({...editorContext,records:[{...record,first:'false'}]})]){
  assert.throws(()=>parseEditorContext(value),(e:unknown)=>e instanceof Problem&&e.status===400&&e.code==='INVALID_INPUT');
 }
});
test('editor quote can come from an unpicked record in the same month and be 40 code points',()=>{
 const value=structuredClone(editorResult);value.chapters[0]!.picks=['r2'];value.chapters[0]!.quote.text='字'.repeat(40);
 assert.deepEqual(parseResult(value,'write',input('editor')),value);
});
test('editor record fields enforce their bounds and unknown keys are rejected',()=>{
 const record=editorContext.records[0]!;
 for(const change of [{id:''},{id:'字'.repeat(101)},{date:'2026-13-01'},{title:'字'.repeat(101)},{by:'字'.repeat(21)},{photos:'true'},{quote:null},{extra:1}]){
  assert.throws(()=>parseEditorContext(JSON.stringify({...editorContext,records:[{...record,...change}]})),(e:unknown)=>e instanceof Problem&&e.status===400);
 }
 const {by,...withoutBy}=record;
 assert.equal(parseEditorContext(JSON.stringify({...editorContext,records:[withoutBy]})).records.length,1);
});
