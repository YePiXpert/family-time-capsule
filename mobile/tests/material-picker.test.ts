import {randomUUID} from "node:crypto";
import {createElement,useEffect} from "react";
import {act,create,type ReactTestRenderer} from "react-test-renderer";
import {afterEach,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({navigate:vi.fn(),goBack:vi.fn(),dispatch:vi.fn()}));
vi.mock("expo-crypto",()=>({randomUUID}));
vi.mock("expo-sqlite",async()=>await import("../../tests/mocks/expo-sqlite"));
vi.mock("react-native",()=>({Image:"Image",Pressable:"Pressable",ScrollView:"ScrollView",View:"View",Text:"Text",TextInput:"TextInput",StyleSheet:{create:(v:unknown)=>v},FlatList:(props:{data:unknown[];renderItem:(p:{item:unknown;index:number})=>unknown;ListHeaderComponent?:unknown;ListFooterComponent?:unknown})=>createElement("FlatList",props,[props.ListHeaderComponent,...props.data.map((item,index)=>createElement("Row",{key:index},props.renderItem({item,index}) as never)),props.ListFooterComponent] as never)}));
vi.mock("react-native-svg",()=>({default:"Svg",Path:"Path",Rect:"Rect",Circle:"Circle"}));
vi.mock("react-native-safe-area-context",()=>({useSafeAreaInsets:()=>({top:0,bottom:0,left:0,right:0})}));
vi.mock("@react-navigation/native",()=>({useFocusEffect:(fn:()=>void|(()=>void))=>useEffect(fn,[fn]),useNavigation:()=>({navigate:mocks.navigate,dispatch:mocks.dispatch}),usePreventRemove:()=>{}}));
vi.mock("../src/components/MonthPicker",()=>({MonthPicker:(props:object)=>createElement("MonthPicker",props)}));
vi.mock("../src/components/GlassSheet",()=>({useConfirmSheet:()=>async()=>true}));
vi.mock("../src/state/AppContext",()=>({useAppData:()=>({credentials:null,userId:null,viewer:null,family:null,online:false,events:[]}),useAppActions:()=>({runSync:vi.fn()})}));
const {initializeLocalStore}=await import("../src/storage/database");
const {createLocalDraft,saveLocalDraft}=await import("../src/drafts/store");
const {newLocalAlbum,saveLocalAlbum,getLocalAlbum}=await import("../src/collections/local");
const {createWorkSession,getWorkSession}=await import("../src/worksession/store");
const {LocalAlbumScreen}=await import("../src/screens/LocalAlbumScreen");
const {MaterialPickerScreen}=await import("../src/screens/MaterialPickerScreen");
(globalThis as typeof globalThis&{IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
let tree:ReactTestRenderer|undefined;
afterEach(async()=>{if(tree)await act(()=>tree!.unmount());tree=undefined;vi.clearAllMocks();});
async function draft(title:string,month:string){const d=await createLocalDraft("local",randomUUID(),randomUUID());await saveLocalDraft({...d,status:"queued",revision:2,content:{...d.content,title,text:title,occurredAt:`${month}-01T08:00:00Z`}},1);return d.id;}
async function press(label:string){const node=tree!.root.findAll(n=>String(n.type)==="Pressable"&&(n.props.accessibilityLabel===label||Boolean(n.findAll(c=>String(c.type)==="Text"&&c.props.children===label).length)))[0]!;expect(node).toBeTruthy();expect(node.props.disabled).not.toBe(true);await act(async()=>node.props.onPress());}
it("adds a local record to the open album in three actions and commits it durably",async()=>{
  await initializeLocalStore();const id=await draft("三次操作的记录","2026-09"),album=newLocalAlbum("local","周末相册");await saveLocalAlbum(album,0);
  await act(async()=>{tree=create(createElement(LocalAlbumScreen,{route:{params:{scope:"local",id:album.id}},navigation:{navigate:mocks.navigate,replace:vi.fn(),setParams:vi.fn()}} as never));});
  await press("添加记录");const params=mocks.navigate.mock.lastCall![1];expect(mocks.navigate.mock.lastCall![0]).toBe("MaterialPicker");
  await act(()=>tree!.unmount());await act(async()=>{tree=create(createElement(MaterialPickerScreen,{route:{params},navigation:{goBack:mocks.goBack,navigate:mocks.navigate}} as never));});
  await press("三次操作的记录");await press("加入此相册");
  expect(mocks.goBack).toHaveBeenCalledOnce();expect((await getLocalAlbum("local",album.id))?.items.map(i=>i.ref)).toEqual([{kind:"localDraft",scope:"local",id}]);
});
it("keeps choices and scroll state after changing months and reopening the same picker",async()=>{
  await initializeLocalStore();const september=await draft("九月选择","2026-09"),august=await draft("八月选择","2026-08");const session=await createWorkSession("local",{mode:"create",kind:"album"});
  const props={route:{params:{scope:"local",sessionId:session.id}},navigation:{goBack:mocks.goBack,navigate:mocks.navigate}} as never;
  await act(async()=>{tree=create(createElement(MaterialPickerScreen,props));});await press("九月选择");
  await act(async()=>tree!.root.findByType("MonthPicker" as never).props.onChange("2026-08"));await press("八月选择");
  await act(async()=>tree!.root.findByType("FlatList" as never).props.onScrollEndDrag({nativeEvent:{contentOffset:{y:320}}}));
  await act(()=>tree!.unmount());await act(async()=>{tree=create(createElement(MaterialPickerScreen,props));});
  const saved=await getWorkSession("local",session.id);expect(saved?.selected.map(r=>r.id)).toEqual([september,august]);expect(saved?.month).toBe("2026-08");expect(saved?.positions?.["localDraft:2026-08"]?.offset).toBe(320);expect(tree!.root.findAll(n=>String(n.type)==="Pressable"&&n.props.accessibilityLabel==="八月选择")).toHaveLength(1);
});
