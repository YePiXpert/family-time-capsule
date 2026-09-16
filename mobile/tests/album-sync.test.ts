import {randomUUID} from "node:crypto";
import {beforeEach,expect,it,vi} from "vitest";
vi.mock("expo-crypto",()=>({randomUUID}));
vi.mock("expo-sqlite",async()=>await import("../../tests/mocks/expo-sqlite"));
const mocks=vi.hoisted(()=>({send:vi.fn(),fetch:vi.fn()}));
vi.mock("../src/collections/api",()=>({sendAlbumCommand:mocks.send}));
vi.mock("../src/api/client",async original=>({...await original<object>(),fetchCollection:mocks.fetch}));
const {ApiError}=await import("../src/api/client");
const {initializeLocalStore,getDatabase,setActiveDestination}=await import("../src/storage/database");
const {createLocalDraft,saveLocalDraft,listLocalDrafts}=await import("../src/drafts/store");
const {newLocalAlbum,saveLocalAlbum,getLocalAlbum,albumUploadAuthorized,appendAlbumItems}=await import("../src/collections/local");
const {syncLocalAlbums,authorizeAlbumSync}=await import("../src/collections/sync");
const credentials={serverUrl:"https://family.invalid",instanceId:"instance",token:"owner-token"},scope=JSON.stringify([credentials.serverUrl,credentials.instanceId,"owner","family"]);
beforeEach(async()=>{vi.clearAllMocks();await initializeLocalStore();const db=await getDatabase();await db.execAsync("DELETE FROM local_album;DELETE FROM local_work_session;DELETE FROM local_draft;");await setActiveDestination(scope);});
async function local(){let draft=await createLocalDraft("local",randomUUID(),randomUUID());draft={...draft,status:"queued",revision:2,content:{...draft.content,title:"私密日记",text:"不能自动分享",visibility:"private"}};await saveLocalDraft(draft,1);const album=newLocalAlbum("local","私密相册名称",[{kind:"localDraft",scope:"local",id:draft.id}]);await saveLocalAlbum(album,0);return {draft,album};}
it("never sends local metadata before explicit consent and waits for confirmed memory IDs",async()=>{
  const {album,draft}=await local();await syncLocalAlbums(credentials);expect(mocks.send).not.toHaveBeenCalled();
  const bound=await authorizeAlbumSync(album,scope);expect(bound.scope).toBe(scope);expect(await albumUploadAuthorized(scope,draft.id)).toBe(true);expect((await listLocalDrafts(scope))[0]?.content.visibility).toBe("private");
  await syncLocalAlbums(credentials);expect(mocks.send).not.toHaveBeenCalled();expect((await getLocalAlbum(scope,bound.id))?.pending).not.toBeNull();
});
it("reuses a durable immutable request after a lost response and maps the source exactly once",async()=>{
  const {album}=await local(),bound=await authorizeAlbumSync(album,scope),draft=(await listLocalDrafts(scope))[0]!;
  await saveLocalDraft({...draft,status:"published",memoryEventId:"remote-memory",revision:draft.revision+1},draft.revision);
  mocks.send.mockRejectedValueOnce(new ApiError("offline",0));await syncLocalAlbums(credentials);
  const first=mocks.send.mock.lastCall![1];expect(first.target.title).toBe("私密相册名称");
  mocks.send.mockImplementation(async(_credentials,command)=>({id:"remote-album",revision:2,items:command.items.map((i:{clientItemId:string;memoryEventId:string})=>({...i,itemId:"server-item"}))}));
  await syncLocalAlbums(credentials);expect(mocks.send.mock.lastCall![1]).toEqual(first);
  const saved=await getLocalAlbum(scope,bound.id);expect(saved?.remoteId).toBe("remote-album");expect(saved?.items).toHaveLength(1);expect(saved?.items[0]?.ref).toEqual({kind:"memory",scope,id:"remote-memory"});expect(saved?.pending).toBeNull();
});
it("does not accept an old-account response or convert an authorization denial to offline success",async()=>{
  const album={...newLocalAlbum(scope,"相册",[{kind:"memory" as const,scope,id:"memory"}]),consent:{scope,at:"now",draftIds:[]}};
  album.pending={mutationId:randomUUID(),itemIds:album.items.map(i=>i.id)};await saveLocalAlbum(album,0);
  mocks.send.mockImplementation(async()=>{await setActiveDestination("different-account");return {id:"server",revision:2,items:[{clientItemId:album.items[0]!.id,itemId:"item",memoryEventId:"memory"}]};});
  await syncLocalAlbums(credentials);expect((await getLocalAlbum(scope,album.id))?.remoteId).toBeNull();expect(await getLocalAlbum("different-account",album.id)).toBeNull();
  await setActiveDestination(scope);mocks.send.mockRejectedValue(new ApiError("权限已撤回",403));await syncLocalAlbums(credentials);const saved=await getLocalAlbum(scope,album.id);expect(saved?.remoteId).toBeNull();expect(saved?.pending).not.toBeNull();expect(saved?.error).toBe("权限已撤回");
});
it("retains later offline batches through an earlier acknowledgement, then syncs them on the next pass",async()=>{
  const initial={...newLocalAlbum(scope),remoteId:"server-album",remoteRevision:4,consent:{scope,at:"now",draftIds:[]}};
  const first=appendAlbumItems(initial,[{kind:"memory",scope,id:"first"}]);const both=appendAlbumItems(first,[{kind:"memory",scope,id:"second"}]);await saveLocalAlbum(both,0);
  mocks.send.mockImplementation(async(_credentials,command)=>({id:"server-album",revision:command.target.baseRevision+1,items:command.items.map((i:{clientItemId:string;memoryEventId:string})=>({...i,itemId:`item-${i.memoryEventId}`}))}));
  await syncLocalAlbums(credentials);expect((await getLocalAlbum(scope,both.id))?.pending?.itemIds).toEqual([both.items[1]!.id]);await syncLocalAlbums(credentials);const saved=await getLocalAlbum(scope,both.id);expect(saved?.pending).toBeNull();expect(saved?.items.map(i=>i.remoteItemId)).toEqual(["item-first","item-second"]);
});
it("deduplicates a published local draft and its server alias without losing the selected cover",async()=>{
  let draft=await createLocalDraft(scope,"published-alias","mutation");draft={...draft,status:"published",memoryEventId:"same-memory",revision:2};await saveLocalDraft(draft,1);
  const album=newLocalAlbum(scope,"相册",[{kind:"localDraft",scope,id:draft.id},{kind:"memory",scope,id:"same-memory"}]);await saveLocalAlbum(album,0);const bound=await authorizeAlbumSync(album,scope);
  mocks.send.mockImplementation(async(_credentials,command)=>{expect(command.items).toHaveLength(1);return {id:"remote-alias-album",revision:2,items:command.items.map((i:{clientItemId:string;memoryEventId:string})=>({...i,itemId:"one-item"}))};});
  await syncLocalAlbums(credentials);const saved=await getLocalAlbum(scope,bound.id);expect(saved?.pending).toBeNull();expect(saved?.items).toHaveLength(1);expect(saved?.items[0]?.ref).toEqual({kind:"memory",scope,id:"same-memory"});
});
it("allows local repair only when the server proves the rejected operation was not applied",async()=>{
  const album={...newLocalAlbum(scope,"待整理相册",[{kind:"memory" as const,scope,id:"gone"}]),consent:{scope,at:"now",draftIds:[]}};album.pending={mutationId:randomUUID(),itemIds:album.items.map(i=>i.id)};await saveLocalAlbum(album,0);
  mocks.send.mockRejectedValue(new ApiError("素材不可用",403,"source_unavailable_not_applied"));await syncLocalAlbums(credentials);expect((await getLocalAlbum(scope,album.id))?.syncRejected).toBe(true);
  mocks.send.mockRejectedValue(new ApiError("无法核对旧回执",403,"source_unavailable"));await syncLocalAlbums(credentials);expect((await getLocalAlbum(scope,album.id))?.syncRejected).toBe(false);expect((await getLocalAlbum(scope,album.id))?.pending).not.toBeNull();
});
