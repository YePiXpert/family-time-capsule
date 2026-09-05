import { createElement, useEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import type { CollectionDetail } from '../src/collections/types';
vi.mock("../src/reading/DownloadButton", () => ({ ReadingDownloadButton: () => null }));
const mocks=vi.hoisted(()=>({get:vi.fn(),list:vi.fn(),mutate:vi.fn(),navigate:vi.fn(),credentials:{serverUrl:'https://fictional.example.test',token:'fictional-component-token'}}));
vi.mock('react-native',()=>({ActivityIndicator:'ActivityIndicator',Image:'Image',Pressable:'Pressable',ScrollView:'ScrollView',Text:'Text',TextInput:'TextInput',View:'View',StyleSheet:{create:(s:unknown)=>s},Alert:{alert:vi.fn()}}));
vi.mock('@react-navigation/native',()=>({useFocusEffect:(fn:()=>void|(()=>void))=>useEffect(fn,[fn])}));
vi.mock('expo-crypto',()=>({randomUUID:()=> 'fictional-new-section'}));
vi.mock('../src/state/AppContext',()=>({useApp:()=>({credentials:mocks.credentials})}));
vi.mock('../src/api/client',async(original)=>({...await original<object>(),fetchCollection:mocks.get,fetchCollections:mocks.list,mutateCollection:mocks.mutate}));
const {CollectionDetailScreen,CollectionsScreen}=await import('../src/screens/CollectionScreens');
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
let tree:ReactTestRenderer|undefined;
afterEach(async()=>{if(tree)await act(()=>tree!.unmount());tree=undefined;vi.clearAllMocks();});
function detail():CollectionDetail{return {id:'collection',kind:'chapter',title:'出生第一周',description:'虚构家庭的记忆',timezone:'Asia/Shanghai',coverAssetId:null,startDate:null,endDate:null,revision:2,updatedAt:'2026-09-01T00:00:00Z',deletedAt:null,sortMode:'manual',canWrite:true,sections:[],items:['first','second'].map((id,i)=>({id,memoryEventId:`event-${id}`,sectionId:null,caption:`说明 ${i}`,source:{title:`记忆 ${i}`,occurredAt:'2026-09-01T00:00:00Z',coverAssetId:null,previewAssetId:null}}))};}
async function press(label:string,index=0){const button=tree!.root.findAll(n=>String(n.type)==='Pressable'&&n.findAll(c=>String(c.type)==='Text'&&c.props.children===label).length>0)[index]!;expect(button).toBeTruthy();await act(async()=>button.props.onPress());}
it('edits real native collection captions/order, preserves input after a conflict and opens the source',async()=>{
  mocks.get.mockResolvedValue(detail());mocks.mutate.mockRejectedValue(new Error('其他家人已修改相册'));
  await act(async()=>{tree=create(createElement(CollectionDetailScreen,{route:{params:{id:'collection'}},navigation:{navigate:mocks.navigate}} as unknown as Parameters<typeof CollectionDetailScreen>[0]));});
  const caption=tree!.root.findAll(n=>String(n.type)==='TextInput'&&n.props.accessibilityLabel==='图文说明')[0]!;
  await act(()=>caption.props.onChangeText('我手写的说明'));await press('下移');await press('保存排序与说明');
  expect(mocks.mutate.mock.lastCall?.[2].edit.items.map((i:{id:string})=>i.id)).toEqual(['second','first']);
  expect(JSON.stringify(tree!.toJSON())).toContain('其他家人已修改相册');expect(tree!.root.findAll(n=>String(n.type)==='TextInput'&&n.props.value==='我手写的说明')).toHaveLength(1);
  await press('记忆 0');expect(mocks.navigate).toHaveBeenCalledWith('Memory',{id:'event-first'});
  await press('添加小节');expect(tree!.root.findAll(n=>String(n.type)==='TextInput'&&n.props.accessibilityLabel==='小节 1 名称')).toHaveLength(1);
  await press('所属小节：未分小节（点按切换）');await press('阅读相册');expect(tree!.root.findAll(n=>String(n.type)==='TextInput')).toHaveLength(0);expect(JSON.stringify(tree!.toJSON())).toContain('我手写的说明');await press('继续编辑');await press('移除小节');expect(tree!.root.findAll(n=>String(n.type)==='TextInput'&&n.props.accessibilityLabel==='小节 1 名称')).toHaveLength(0);await press('保存相册');expect(mocks.mutate.mock.lastCall?.[2].edit.items.every((i:{sectionId:string|null})=>i.sectionId===null)).toBe(true);
});
it('adds selected timeline memories to an existing native collection using its revision',async()=>{
  mocks.list.mockResolvedValue({entries:[{id:'collection',title:'出生第一周',kind:'chapter',description:'',count:2,coverAssetId:null,revision:2,deletedAt:null}],nextCursor:null,canWrite:true});mocks.mutate.mockResolvedValue(detail());
  await act(async()=>{tree=create(createElement(CollectionsScreen,{route:{params:{eventIds:['event-new']}},navigation:{navigate:mocks.navigate}} as unknown as Parameters<typeof CollectionsScreen>[0]));});
  await press('出生第一周');expect(mocks.mutate).toHaveBeenCalledWith(mocks.credentials,'collection',{operation:'add',revision:2,eventIds:['event-new']});expect(mocks.navigate).toHaveBeenCalledWith('CollectionDetail',{id:'collection'});
});
