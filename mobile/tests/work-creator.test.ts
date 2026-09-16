import {createElement,useEffect} from "react";
import {act,create,type ReactTestRenderer} from "react-test-renderer";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import type {WorkSession} from "../src/worksession/store";
const mocks=vi.hoisted(()=>({materials:vi.fn(),commit:vi.fn(),get:vi.fn(),save:vi.fn(),create:vi.fn(),navigate:vi.fn(),replace:vi.fn(),popTo:vi.fn(),dispatch:vi.fn(),prevent:vi.fn(),context:{credentials:{serverUrl:"https://fixture.invalid",instanceId:"instance",token:"token"},userId:"owner",viewer:{id:"owner"},family:{id:"family"}}}));
vi.mock("react-native",()=>({Image:"Image",Pressable:"Pressable",ScrollView:"ScrollView",View:"View",Text:"Text",TextInput:"TextInput",StyleSheet:{create:(v:unknown)=>v}}));
vi.mock("react-native-svg",()=>({default:"Svg",Path:"Path",Rect:"Rect",Circle:"Circle"}));
vi.mock("react-native-safe-area-context",()=>({useSafeAreaInsets:()=>({top:0,bottom:0,left:0,right:0})}));
vi.mock("@react-navigation/native",()=>({useFocusEffect:(fn:()=>void|(()=>void))=>useEffect(fn,[fn]),useNavigation:()=>({navigate:mocks.navigate,dispatch:mocks.dispatch}),usePreventRemove:mocks.prevent}));
vi.mock("../src/state/AppContext",()=>({useAppData:()=>mocks.context}));
vi.mock("../src/api/client",()=>({fetchBookMaterials:mocks.materials}));
vi.mock("../src/collections/local",()=>({materialKey:(r:{scope:string;kind:string;id:string})=>JSON.stringify([r.scope,r.kind,r.id]),localMaterialDetails:vi.fn()}));
vi.mock("../src/worksession/store",()=>({getWorkSession:mocks.get,saveWorkSession:mocks.save,createWorkSession:mocks.create}));
vi.mock("../src/worksession/commit",()=>({commitWorkSession:mocks.commit}));
const {WorkPreviewScreen}=await import("../src/screens/WorkPreviewScreen");
const {BookCreateScreen}=await import("../src/screens/BookCreateScreen");
(globalThis as typeof globalThis&{IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const scope=JSON.stringify(["https://fixture.invalid","instance","owner","family"]);
let tree:ReactTestRenderer|undefined,session:WorkSession;
beforeEach(()=>{mocks.context.userId="owner";mocks.context.viewer.id="owner";session={id:"session",scope,target:{mode:"create",kind:"book"},selected:[{kind:"memory",scope,id:"old-off-page"},{kind:"memory",scope,id:"private"}],source:"memory",month:"",audience:"personal",template:"growth",title:"",updatedAt:"now"};mocks.get.mockImplementation(async()=>session);mocks.save.mockImplementation(async(row)=>{session=row;});mocks.materials.mockImplementation(async(_c,_k,a,_cursor,_month,ids:string[])=>({entries:ids.filter(id=>a==="personal"||id!=="private").map(id=>({id,kind:"memory",title:`故事 ${id}`,occurredAt:"2026-09-01T00:00:00Z",occurredAtPrecision:"month",images:[]})),nextCursor:null}));mocks.commit.mockResolvedValue({kind:"book",id:"created"});});
afterEach(async()=>{if(tree)await act(()=>tree!.unmount());tree=undefined;vi.clearAllMocks();});
function control(label:string){return tree!.root.findAll(n=>String(n.type)==="Pressable"&&(n.props.accessibilityLabel===label||Boolean(n.findAll(c=>String(c.type)==="Text"&&c.props.children===label).length)))[0]!;}
async function press(label:string){const node=control(label);expect(node).toBeTruthy();expect(node.props.disabled).not.toBe(true);await act(async()=>node.props.onPress());}
async function mount(){await act(async()=>{tree=create(createElement(WorkPreviewScreen,{route:{params:{scope,sessionId:"session"}},navigation:{navigate:mocks.navigate,replace:mocks.replace,popTo:mocks.popTo}} as never));});}
it("resolves exact off-page IDs and preserves them through style changes",async()=>{
  await mount();expect(mocks.materials).toHaveBeenCalledWith(mocks.context.credentials,"memory","personal","","",["old-off-page","private"]);expect(JSON.stringify(tree!.toJSON())).toContain("2026年9月");expect(JSON.stringify(tree!.toJSON())).not.toContain("2026年9月1日");await press("照片集");await press("生成成长册");expect(mocks.commit.mock.lastCall?.[0]).toMatchObject({audience:"personal",template:"photos",selected:session.selected});expect(mocks.navigate).toHaveBeenCalledWith("BookDetail",{id:"created"});
});
it("keeps denied choices while changing readers and restores them on returning to personal",async()=>{
  await mount();await press("全家可见");expect(control("生成成长册").props.disabled).toBe(true);expect(session.selected).toHaveLength(2);expect(JSON.stringify(tree!.toJSON())).not.toContain("故事 private");await press("仅自己");await press("生成成长册");expect(mocks.commit.mock.lastCall?.[0].selected.map((r:{id:string})=>r.id)).toEqual(["old-off-page","private"]);
});
it("blocks creation and leaving when SQLite rejects the last edit, retaining the typed name",async()=>{
  await mount();mocks.save.mockRejectedValueOnce(new Error("disk full"));const input=tree!.root.findAll(n=>String(n.type)==="TextInput")[0]!;await act(()=>input.props.onChangeText("不能丢掉的名字"));await press("生成成长册");expect(mocks.commit).not.toHaveBeenCalled();expect(JSON.stringify(tree!.toJSON())).toContain("不能丢掉的名字");expect(JSON.stringify(tree!.toJSON())).toContain("disk full");const blocked=mocks.prevent.mock.calls.findLast(args=>args[0]===true);expect(blocked).toBeTruthy();await act(async()=>blocked![1]({data:{action:{type:"BACK"}}}));expect(mocks.dispatch).not.toHaveBeenCalled();
});
it("does not read old route contents while current account and cached viewer disagree",async()=>{
  mocks.context.userId="new-owner";await act(async()=>{tree=create(createElement(BookCreateScreen,{route:{params:{scope,eventIds:["old-account"]}},navigation:{goBack:vi.fn(),replace:mocks.replace}} as never));});expect(mocks.create).not.toHaveBeenCalled();expect(JSON.stringify(tree!.toJSON())).toContain("之前的选择没有带入");expect(mocks.materials).not.toHaveBeenCalled();
});
