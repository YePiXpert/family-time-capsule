import {randomUUID} from "node:crypto";
import {beforeEach,expect,it,vi} from "vitest";
vi.mock("expo-crypto",()=>({randomUUID}));
vi.mock("expo-sqlite",async()=>await import("../../tests/mocks/expo-sqlite"));
const {initializeLocalStore,getDatabase,setActiveDestination}=await import("../src/storage/database");
const {createLocalDraft,saveLocalDraft,listLocalDrafts,bindLocalDraft}=await import("../src/drafts/store");
const {newLocalAlbum,saveLocalAlbum,getLocalAlbum,appendAlbumItems,albumUploadAuthorized}=await import("../src/collections/local");
const {createWorkSession,getWorkSession,saveWorkSession,toggleWorkSelection}=await import("../src/worksession/store");
const {createCoverPager}=await import("../src/collections/shelf");
beforeEach(async()=>{await initializeLocalStore();const db=await getDatabase();await db.execAsync("DELETE FROM local_album;DELETE FROM local_work_session;DELETE FROM local_draft;");});
it("keeps local title, cover, order and removals across restart without upload consent",async()=>{
  const refs=["one","two","three"].map(id=>({kind:"localDraft" as const,scope:"local",id}));
  let album=newLocalAlbum("local","第一本",refs);await saveLocalAlbum(album,0);
  album={...album,title:"周末",coverItemId:album.items[2]!.id,items:[album.items[2]!,album.items[0]!],revision:2};await saveLocalAlbum(album,1);
  await initializeLocalStore();expect(await getLocalAlbum("local",album.id)).toEqual(album);expect(await getLocalAlbum("other-account",album.id)).toBeNull();expect(await albumUploadAuthorized("local","one")).toBe(false);
  await expect(saveLocalAlbum({...album,title:"旧副本"},1)).rejects.toThrow("另一处");
});
it("binding a shared source updates both references without binding or publishing either private album",async()=>{
  await setActiveDestination("family-scope");let d=await createLocalDraft("local","local-source","mutation");d={...d,status:"queued",revision:2,content:{...d.content,text:"私密原话",visibility:"private"}};await saveLocalDraft(d,1);
  const a=newLocalAlbum("local","私密名称",[{kind:"localDraft",scope:"local",id:d.id}]),b=newLocalAlbum("local","另一相册",[{kind:"localDraft",scope:"local",id:d.id}]);await saveLocalAlbum(a,0);await saveLocalAlbum(b,0);
  await bindLocalDraft(d.id,"family-scope");
  for(const id of [a.id,b.id]){const saved=await getLocalAlbum("local",id);expect(saved?.scope).toBe("local");expect(saved?.consent).toBeNull();expect(saved?.items[0]?.ref.scope).toBe("family-scope");expect(await getLocalAlbum("family-scope",id)).toBeNull();}
  expect((await listLocalDrafts("family-scope"))[0]?.content.visibility).toBe("private");
});
it("retains three additions and an in-flight immutable command while appending a later offline batch",async()=>{
  let album:import("../src/collections/local").LocalAlbum={...newLocalAlbum("family"),remoteId:"server-album",remoteRevision:4};
  for(let n=0;n<3;n++)album=appendAlbumItems(album,[{kind:"memory",scope:"family",id:`memory-${n}`}]);
  await saveLocalAlbum(album,0);expect((await getLocalAlbum("family",album.id))?.items).toHaveLength(3);
  const command={mutationId:album.pending!.mutationId,target:{collectionId:"server-album",baseRevision:4},items:[{clientItemId:album.items[0]!.id,memoryEventId:"memory-0"}]};
  album={...album,pending:{...album.pending!,command}};const later=appendAlbumItems(album,[{kind:"localDraft",scope:"family",id:"offline-four"}]);expect(later.pending?.command).toEqual(command);expect(later.items).toHaveLength(4);
});
it("persists exact cross-month choices and reading settings independently of loaded pages",async()=>{
  let session=await createWorkSession("family",{mode:"create",kind:"book"},[{kind:"memory",scope:"family",id:"outside-first-page"}]);
  session=toggleWorkSelection(session,{kind:"memory",scope:"family",id:"older-month"});session={...session,month:"2020-01",template:"photos",coverRefKey:"cover",positions:{"memory:2020-01":{offset:900,pages:3}}};await saveWorkSession(session);await initializeLocalStore();expect(await getWorkSession("family",session.id)).toEqual(session);expect(await getWorkSession("other",session.id)).toBeNull();expect(session.audience).toBe("personal");
});
it("merges two paginated streams before exposing older covers, without dropping either cursor",async()=>{
  const item=(id:string,day:number,kind:"book"|"collection")=>({id,kind,title:id,updatedAt:`2026-09-${String(day).padStart(2,"0")}`,coverAssetId:null,revision:1});
  const books=vi.fn(async(c:string)=>c?{entries:[item("b2",8,"book")],nextCursor:null}:{entries:[item("b1",10,"book")],nextCursor:"b-next"});
  const albums=vi.fn(async(c:string)=>c?{entries:[item("a2",7,"collection")],nextCursor:null}:{entries:[item("a1",9,"collection")],nextCursor:"a-next"});
  const pager=createCoverPager(books,albums);expect((await pager.next(3)).map(i=>i.id)).toEqual(["b1","a1","b2"]);expect((await pager.next()).map(i=>i.id)).toEqual(["a2"]);expect(pager.hasMore()).toBe(false);
});
