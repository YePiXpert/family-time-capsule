import { createElement, useEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({get:vi.fn(),play:vi.fn(),pause:vi.fn(),seek:vi.fn(),rate:vi.fn(),active:0}));
vi.mock('react-native',()=>({ActivityIndicator:'ActivityIndicator',Image:'Image',Modal:'Modal',Pressable:'Pressable',ScrollView:'ScrollView',Text:'Text',TextInput:'TextInput',View:'View',useWindowDimensions:()=>({width:375,height:800}),StyleSheet:{create:(s:unknown)=>s}}));
vi.mock('react-native-safe-area-context',()=>({SafeAreaView:'SafeAreaView'}));
vi.mock('expo',()=>({useEvent:()=>({status:'readyToPlay',error:null})}));
vi.mock('expo-video',()=>({VideoView:'VideoView',useVideoPlayer:()=>{useEffect(()=>{mocks.active++;return()=>{mocks.active--;};},[]);return {};}}));
vi.mock('expo-audio',()=>({useAudioPlayer:()=>{useEffect(()=>{mocks.active++;return()=>{mocks.active--;};},[]);return {play:mocks.play,pause:mocks.pause,seekTo:mocks.seek,setPlaybackRate:mocks.rate};},useAudioPlayerStatus:()=>({duration:60,currentTime:12,isLoaded:true,playing:false,isBuffering:false,didJustFinish:false,error:null})}));
vi.mock('../src/media/export-original',()=>({exportOriginalCopy:vi.fn()}));
vi.mock('../src/api/client',()=>({fetchMediaDerivations:mocks.get}));
const {NativeMediaReader}=await import('../src/media/NativeMediaReader');
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
let tree:ReactTestRenderer|undefined;
afterEach(async()=>{if(tree)await act(()=>tree!.unmount());tree=undefined;expect(mocks.active).toBe(0);vi.clearAllMocks();});
async function press(title:string){const button=tree!.root.findAll(n=>String(n.type)==='Pressable'&&(n.props.accessibilityLabel===title||n.findAll(c=>String(c.type)==='Text'&&c.props.children===title).length>0))[0]!;expect(button,title).toBeTruthy();await act(async()=>button.props.onPress());}
it('creates only the active player, controls real audio UI and releases it on image navigation and closing',async()=>{
  mocks.get.mockResolvedValue({jobs:[],transcript:{text:'妈妈的原话',edited:false,segments:[{startSeconds:10,endSeconds:15,text:'十秒处的原话'}]}});
  await act(async()=>{tree=create(createElement(NativeMediaReader,{credentials:{serverUrl:'https://fictional.example.test',token:'fictional-test-token'},assets:[{id:'audio-one',type:'audio',filename:'妈妈的声音',mimeType:'audio/wav'},{id:'photo-one',type:'image',filename:'虚构合照',mimeType:'image/jpeg'},{id:'audio-two',type:'audio',filename:'爸爸的声音',mimeType:'audio/wav'}]}));});
  expect(mocks.active).toBe(0);await press('打开阅读器：妈妈的声音');expect(mocks.active).toBe(1);expect(mocks.play).not.toHaveBeenCalled();
  await press('播放声音');expect(mocks.play).toHaveBeenCalledOnce();await press('播放速度 1×');expect(mocks.rate).toHaveBeenCalledWith(1.25);
  await press('10.0 秒 · 十秒处的原话');expect(mocks.seek).toHaveBeenCalledWith(10);
  await press('下一份');expect(mocks.active).toBe(0);await press('放大');const photo=tree!.root.findAll(n=>String(n.type)==='Image'&&n.props.accessibilityLabel==='虚构合照').at(-1)!;expect(photo.props.style.width).toBeGreaterThan(375);
  await press('下一份');expect(mocks.active).toBe(1);await press('关闭阅读器');expect(mocks.active).toBe(0);
});
it('distinguishes revoked access from network failure, preserves local reading, and never invents transcript seeking',async()=>{
  mocks.get.mockRejectedValue(Object.assign(new Error('revoked'),{status:403}));
  await act(async()=>{tree=create(createElement(NativeMediaReader,{credentials:{serverUrl:'https://fictional.example.test',token:'fictional-test-token'},assets:[{id:'remote',type:'audio',filename:'服务器声音',mimeType:'audio/wav'},{id:'local',type:'audio',filename:'本机声音',mimeType:'audio/wav',localUri:'file:///fictional-original.wav'}]}));});
  await press('打开阅读器：服务器声音');expect(JSON.stringify(tree!.toJSON())).toContain('当前没有阅读权限');expect(mocks.active).toBe(0);
  mocks.get.mockRejectedValue(Object.assign(new Error('offline'),{status:0}));await press('重新加载');expect(JSON.stringify(tree!.toJSON())).toContain('检查网络后重试');
  await press('下一份');expect(mocks.active).toBe(1);expect(tree!.root.findAll(n=>String(n.type)==='Text'&&String(n.props.children).includes('带真实时间段'))).toHaveLength(0);
});
