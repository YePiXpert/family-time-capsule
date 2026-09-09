import { createElement, useCallback, useState } from 'react';
import { Pressable, Text } from 'react-native';
import type { VoiceReceipt } from '../src/contributions/submit-voice';
import { act,create,type ReactTestRenderer } from 'react-test-renderer';
import { afterEach,beforeEach,expect,it,vi } from 'vitest';
const mocks=vi.hoisted(()=>({rows:new Map<string,any>(),permission:vi.fn(),mode:vi.fn(),preserve:vi.fn(),upload:vi.fn(),request:vi.fn(),saved:vi.fn(),stop:vi.fn(),release:vi.fn(),app:{credentials:{serverUrl:'https://fixture.invalid',instanceId:'instance',token:'fixture'},family:{id:'family'},viewer:{id:'dad'}}}));
vi.mock('react-native',()=>({Platform:{OS:'ios'},Pressable:'Pressable',View:'View',Text:'Text',StyleSheet:{create:(s:unknown)=>s}}));
vi.mock('../src/components/RecordingMeter',()=>({RecordingMeter:()=>null}));
vi.mock('../src/media/NativeMediaReader',()=>({NativeMediaReader:()=>null}));
vi.mock('../src/state/AppContext',()=>({useApp:()=>mocks.app}));
vi.mock('../src/api/client',()=>({requestMobileJson:mocks.request}));
vi.mock('expo-crypto',()=>({randomUUID:()=>crypto.randomUUID()}));
vi.mock('expo-audio',()=>({AudioModule:{AudioRecorder:class {uri='file:///temporary.m4a';prepareToRecordAsync=async()=>{};record=()=>{};stop=mocks.stop;release=mocks.release;getStatus=()=>({});}},RecordingPresets:{HIGH_QUALITY:{ios:{}}},requestRecordingPermissionsAsync:mocks.permission,setAudioModeAsync:mocks.mode}));
vi.mock('../src/storage/files',()=>({preserveRecordedAudio:mocks.preserve,uploadMediaCaptureReceipt:mocks.upload}));
vi.mock('../src/drafts/store',()=>({listLocalDrafts:async(scope:string)=>[...mocks.rows.values()].filter(r=>r.scope===scope),saveLocalDraft:async(row:any,expected:number)=>{expect(mocks.rows.get(row.id)?.revision??0).toBe(expected);mocks.rows.set(row.id,structuredClone(row));}}));
const {NativeVoiceContribution}=await import('../src/contributions/VoiceContribution');
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
let tree:ReactTestRenderer|undefined;
type Selection = Pick<VoiceReceipt, 'authorPersonId' | 'authorName' | 'visibility'>;
const defaultSelection: Selection = { authorPersonId:'dad-person', authorName:'爸爸', visibility:'family' };
function Form({initialSelection=defaultSelection}:{initialSelection?:Selection}) {
  const [selection,setSelection]=useState(initialSelection);
  const restore=useCallback((voice:VoiceReceipt)=>setSelection({authorPersonId:voice.authorPersonId,authorName:voice.authorName,visibility:voice.visibility}),[]);
  return createElement('Form',null,
    createElement(NativeVoiceContribution,{memoryId:'memory',...selection,onSaved:mocks.saved,onRestoreSelection:restore}),
    createElement(Pressable,{onPress:()=>setSelection(defaultSelection)},createElement(Text,null,'选择爸爸与全家')));
}
async function mount(initialSelection?:Selection){await act(async()=>{tree=create(createElement(Form,{initialSelection}));});}
function visibleText(){return tree!.root.findAllByType('Text' as any).map(t=>t.children.join(''));}
function button(label:string){return tree!.root.findAllByType('Pressable' as any).find(b=>b.findAllByType('Text' as any).some(t=>t.children.join('')===label))!;}
async function tap(label:string){expect(button(label)).toBeTruthy();await act(async()=>{await button(label).props.onPress();});}
beforeEach(()=>{mocks.rows.clear();vi.clearAllMocks();mocks.permission.mockResolvedValue({granted:true});mocks.mode.mockResolvedValue(undefined);mocks.stop.mockResolvedValue(undefined);mocks.preserve.mockResolvedValue({localUri:'file:///permanent.m4a',mimeType:'audio/mp4',mediaType:'audio',fileName:'声音.m4a',lastModified:null});mocks.upload.mockResolvedValue({assetId:'audio'});mocks.saved.mockResolvedValue(undefined);});
afterEach(async()=>{if(tree)await act(async()=>tree!.unmount());tree=undefined;});
it('permission denial creates no recorder or empty draft',async()=>{mocks.permission.mockResolvedValue({granted:false});await mount();await tap('留段声音');expect(mocks.rows.size).toBe(0);expect(mocks.preserve).not.toHaveBeenCalled();expect(JSON.stringify(tree!.toJSON())).toContain('需要麦克风权限');});
it('finishes and durably scopes a recording when leaving the screen, then restores it',async()=>{await mount();await tap('留段声音');await act(async()=>tree!.unmount());tree=undefined;expect(mocks.stop).toHaveBeenCalledOnce();expect(mocks.release).toHaveBeenCalledOnce();const row=[...mocks.rows.values()][0];expect(row.voicePayload.localUri).toBe('file:///permanent.m4a');expect(JSON.parse(row.scope)).toEqual(['https://fixture.invalid','instance','dad','family','voice','memory']);await mount();expect(button('保存声音')).toBeTruthy();expect(mocks.request).not.toHaveBeenCalled();});
it('keeps the recorded original after offline failure and recovers a lost server response once',async()=>{
  await mount();await tap('留段声音');await tap('完成录音');
  mocks.request.mockRejectedValueOnce(Error('offline'));
  await tap('保存声音');expect(button('重试保存声音')).toBeTruthy();expect([...mocks.rows.values()][0].status).toBe('queued');
  let remote:any=null,posts=0;
  mocks.request.mockImplementation(async(_credentials:any,_path:string,init?:RequestInit)=>{
    if(!init){if(!remote)throw {status:404};return structuredClone(remote);}
    if(init.method==='PUT'){const body=JSON.parse(init.body as string);remote={id:'remote',revision:(remote?.revision??0)+1,status:'editing',memoryEventId:null,items:body.content.items};return structuredClone(remote);}
    posts++;remote.status='published';remote.memoryEventId='memory';throw Error('lost_reply');
  });
  await tap('重试保存声音');expect(button('重试保存声音')).toBeTruthy();
  await tap('重试保存声音');expect(posts).toBe(1);expect(mocks.upload).toHaveBeenCalledOnce();expect(mocks.preserve).toHaveBeenCalledOnce();expect([...mocks.rows.values()][0].status).toBe('published');expect(mocks.saved).toHaveBeenCalledOnce();
});

function captureSubmissions() {
  let remote:any=null;
  const submitted:any[]=[];
  mocks.request.mockImplementation(async(_credentials:any,_path:string,init?:RequestInit)=>{
    if(!init){if(!remote)throw {status:404};return structuredClone(remote);}
    const body=JSON.parse(init.body as string);
    if(init.method==='PUT'){remote={id:'remote',revision:(remote?.revision??0)+1,status:'editing',memoryEventId:null,items:body.content.items};return structuredClone(remote);}
    submitted.push(body);remote.status='published';remote.memoryEventId='memory';return {id:'voice'};
  });
  return submitted;
}
for(const [visibility,label] of [['private','仅自己'],['parents','父母可见'],['child_later','留给孩子将来']] as const) {
  it(`restores the recorded author and ${visibility} audience before saving`,async()=>{
    await mount({authorPersonId:'grandma-person',authorName:'外婆',visibility});
    await tap('留段声音');await tap('完成录音');
    await act(async()=>tree!.unmount());tree=undefined;
    await mount();
    expect(visibleText()).toContain(`外婆 · ${label} · 本机录音`);
    const submitted=captureSubmissions();
    await tap('保存声音');
    expect(submitted).toHaveLength(1);
    expect(submitted[0]).toMatchObject({authorPersonId:'grandma-person',visibility});
  });
}
it('previews an explicit change to restored draft authorship and audience before submitting it',async()=>{
  await mount({authorPersonId:'grandma-person',authorName:'外婆',visibility:'private'});
  await tap('留段声音');await tap('完成录音');
  await act(async()=>tree!.unmount());tree=undefined;
  await mount();await tap('选择爸爸与全家');
  expect(visibleText()).toContain('爸爸 · 全家可见 · 本机录音');
  const submitted=captureSubmissions();await tap('保存声音');
  expect(submitted[0]).toMatchObject({authorPersonId:'dad-person',visibility:'family'});
});
it('keeps the queued receipt audience when form controls change before a retry',async()=>{
  await mount({authorPersonId:'grandma-person',authorName:'外婆',visibility:'private'});
  await tap('留段声音');await tap('完成录音');
  mocks.request.mockRejectedValueOnce(Error('offline'));await tap('保存声音');
  await act(async()=>tree!.unmount());tree=undefined;
  await mount();await tap('选择爸爸与全家');
  expect(visibleText()).toContain('外婆 · 仅自己 · 本机录音');
  const submitted=captureSubmissions();await tap('重试保存声音');
  expect(submitted[0]).toMatchObject({authorPersonId:'grandma-person',visibility:'private'});
});
