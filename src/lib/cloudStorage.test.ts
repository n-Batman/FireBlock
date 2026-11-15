import {afterEach,describe,expect,it,vi} from "vitest";
import {createHash} from "node:crypto";
import {CloudStorage,archiveParcelDisplay,cloudRiskGrid,cloudRiskMosaic} from "./cloudStorage";
import {POST} from "@/app/api/parcel-display/route";
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
function backend(failAt=0){
  vi.stubEnv("B2_APPLICATION_KEY_ID","key-id");vi.stubEnv("B2_APPLICATION_KEY","private-key");vi.stubEnv("B2_BUCKET_NAME","bucket");
  const stored=new Map<string,Buffer>(),keys:string[]=[];
  const fetcher=vi.fn<typeof fetch>().mockImplementation(async(input,init)=>{
    const url=String(input);
    if(url.includes("b2_authorize_account"))return Response.json({accountId:"account",authorizationToken:"secret",apiInfo:{storageApi:{apiUrl:"https://api.test",downloadUrl:"https://download.test",allowed:{buckets:[{id:"bucket-id",name:"bucket"}]}}}});
    if(url.endsWith("b2_get_upload_url"))return Response.json({uploadUrl:"https://upload.test",authorizationToken:"upload-secret"});
    if(url.endsWith("b2_list_file_names")){
      const {prefix,maxFileCount}=JSON.parse(String(init!.body));const files=[];
      for(const [id] of stored){const index=Number(id.replace("id-",""))-1;if(keys[index].startsWith(prefix))files.push({fileId:id,fileName:keys[index]});}
      return Response.json({files:files.sort((a,b)=>a.fileName.localeCompare(b.fileName)).slice(0,maxFileCount)});
    }
    if(url==="https://upload.test"){
      const bytes=Buffer.from(init!.body as Uint8Array);const key=decodeURIComponent(new Headers(init!.headers).get("X-Bz-File-Name")!);keys.push(key);
      if(keys.length===failAt)return new Response("failure",{status:500});
      const id="id-"+keys.length;stored.set(id,bytes);
      return Response.json({fileId:id,contentLength:bytes.length,contentSha1:createHash("sha1").update(bytes).digest("hex")});
    }
    if(url.endsWith("b2_get_file_info")){
      const id=JSON.parse(String(init!.body)).fileId;const bytes=stored.get(id)!;
      return Response.json({fileId:id,contentLength:bytes.length,contentSha1:createHash("sha1").update(bytes).digest("hex")});
    }
    const bytes=stored.get(new URL(url).searchParams.get("fileId")!);return new Response(bytes&&new Uint8Array(bytes));
  });
  return {storage:new CloudStorage(fetcher),stored,keys,fetcher};
}
describe("verified cloud storage",()=>{
  it("uploads and downloads JSON by immutable ID without disk caches",async()=>{
    const {storage}=backend();const receipt=await storage.uploadJson("risk/run/grid.json",{value:42});
    expect((await storage.readVersion(receipt.file_id)).value).toEqual({value:42});
    expect(JSON.stringify(receipt)).not.toContain("secret");
  });
  it("pages a private archive with scoped cursors and a bounded provider request",async()=>{
    const {storage,fetcher}=backend();await storage.uploadJson("parcel-scans/test/a.json",{});
    fetcher.mockResolvedValueOnce(Response.json({files:[{fileName:"parcel-scans/test/b.json",fileId:"b"}],nextFileName:"parcel-scans/test/c.json"}));
    const page=await storage.listPage("parcel-scans/test/","parcel-scans/test/b.json",1);
    expect(page.nextFileName).toBe("parcel-scans/test/c.json");
    expect(JSON.parse(String(fetcher.mock.calls.at(-1)?.[1]?.body))).toMatchObject({prefix:"parcel-scans/test/",startFileName:"parcel-scans/test/b.json",maxFileCount:1});
    await expect(storage.listPage("parcel-scans/test/","another-parcel/a.json",1)).rejects.toThrow(/Invalid/);
    fetcher.mockResolvedValueOnce(Response.json({files:[{fileName:"another-parcel/a.json",fileId:"x"}]}));
    await expect(storage.listPage("parcel-scans/test/")).rejects.toThrow(/Invalid/);
    fetcher.mockResolvedValueOnce(Response.json({files:[{fileName:"parcel-scans/test/b.json",fileId:"b"}],nextFileName:"parcel-scans/test/b.json"}));
    await expect(storage.listPage("parcel-scans/test/")).rejects.toThrow(/cursor/);
  });
  it("rejects oversized scan objects from metadata before downloading them",async()=>{
    const {storage,fetcher}=backend();const receipt=await storage.uploadJson("parcel-scans/test/scan.json",{value:"x".repeat(100)});
    await expect(storage.readVersion(receipt.file_id,16)).rejects.toThrow(/metadata/);
    expect(fetcher.mock.calls.some(([url])=>String(url).includes("b2_download_file_by_id"))).toBe(false);
  });
  it("archives boundaries and projections before publishing the ready manifest",async()=>{
    vi.stubEnv("PARCEL_CLOUD_CACHE_ALLOWED","true");const {storage,keys,stored}=backend();
    const receipt=await archiveParcelDisplay({boundaries:true},{score:70},{grid_file_id:"source-id"},storage);
    expect(keys[0]).toMatch(/boundaries.geojson$/);expect(keys[1]).toMatch(/risk.geojson$/);expect(keys[2]).toMatch(/manifest.json$/);
    const manifest=JSON.parse(stored.get(receipt.manifest_file_id)!.toString());expect(manifest.status).toBe("complete");expect(manifest.source.grid_file_id).toBe("source-id");
  });
  it("does not publish a ready manifest after a failed artifact upload",async()=>{
    vi.stubEnv("PARCEL_CLOUD_CACHE_ALLOWED","true");const {storage,keys}=backend(2);
    await expect(archiveParcelDisplay({}, {}, {},storage)).rejects.toThrow();expect(keys.some(k=>k.endsWith("manifest.json"))).toBe(false);
  });
  it("requires parcel caching license confirmation and blocks foreign writes",async()=>{
    vi.stubEnv("PARCEL_CLOUD_CACHE_ALLOWED","");await expect(archiveParcelDisplay({}, {}, {})).rejects.toThrow(/license/);
    expect((await POST(new Request("https://app.test/api/parcel-display",{method:"POST",headers:{origin:"https://evil.test"}}))).status).toBe(403);
    vi.stubEnv("PARCEL_CLOUD_CACHE_ALLOWED","true");vi.stubEnv("CLOUD_WRITE_TOKEN","");
    expect((await POST(new Request("https://app.test/api/parcel-display",{method:"POST",headers:{origin:"https://app.test"}}))).status).toBe(401);
  });
  it("loads only the verified grid referenced by a completed cloud analysis",async()=>{
    const {storage}=backend();
    const grid={type:"FeatureCollection",features:[{type:"Feature",geometry:{type:"Polygon",coordinates:[[[0,0],[1,0],[1,1],[0,1],[0,0]]]},properties:{layer:"relative_risk",cell_id:"a",risk_score:70,model_id:"model",as_of:"2026-11-14T00:00:00Z"}}]};
    const artifact=await storage.uploadJson("risk/run/risk/risk_map.geojson",grid);
    const manifest=await storage.uploadJson("risk/run/manifest.json",{status:"complete",artifacts:[{path:"risk/risk_map.geojson",storage:artifact,sha256:artifact.sha256,bytes:artifact.bytes}]});
    vi.stubEnv("B2_RISK_MANIFEST_FILE_ID",manifest.file_id);
    const result=await cloudRiskGrid(storage);expect(result.grid.features[0].properties.risk_score).toBe(70);expect(result.grid_file_id).toBe(artifact.file_id);
  });
  it("follows a verified latest pointer without requiring a manually pinned manifest",async()=>{
    const {storage}=backend();
    const grid={type:"FeatureCollection",features:[{type:"Feature",geometry:{type:"Polygon",coordinates:[[[0,0],[1,0],[1,1],[0,1],[0,0]]]},properties:{layer:"relative_risk",cell_id:"a",risk_score:70,model_id:"model",as_of:"2026-11-14T00:00:00Z"}}]};
    const artifact=await storage.uploadJson("risk/run/risk/risk_map.geojson",grid);
    const manifest=await storage.uploadJson("risk/run/manifest.json",{status:"complete",artifacts:[{path:"risk/risk_map.geojson",storage:artifact,sha256:artifact.sha256,bytes:artifact.bytes}]});
    await storage.uploadJson("risk/latest.json",{kind:"fireblock.risk-pointer",schema_version:1,manifest_file_id:manifest.file_id,manifest_sha256:manifest.sha256,manifest_bytes:manifest.bytes});
    vi.stubEnv("B2_RISK_MANIFEST_FILE_ID","");vi.stubEnv("B2_RISK_POINTER_KEY","risk/latest.json");
    expect((await cloudRiskGrid(storage)).grid_file_id).toBe(artifact.file_id);
  });
  it("discovers regional publications, skips remote grids, and notices newly registered runs",async()=>{
    const {storage,fetcher}=backend();
    async function publish(name:string,w:number){
      const grid={type:"FeatureCollection",features:[{type:"Feature",geometry:{type:"Polygon",coordinates:[[[w,0],[w+1,0],[w+1,1],[w,1],[w,0]]]},properties:{layer:"relative_risk",cell_id:"a",risk_score:70,model_id:"model",as_of:"2026-11-14T00:00:00Z"}}]};
      const artifact=await storage.uploadJson(`risk/${name}/risk/risk_map.geojson`,grid);
      const manifest=await storage.uploadJson(`risk/${name}/manifest.json`,{status:"complete",artifacts:[{path:"risk/risk_map.geojson",storage:artifact,sha256:artifact.sha256,bytes:artifact.bytes}]});
      await storage.uploadJson(`risk/catalog/${name}.json`,{kind:"fireblock.risk-pointer",schema_version:1,manifest_file_id:manifest.file_id,manifest_sha256:manifest.sha256,manifest_bytes:manifest.bytes,bbox:[w,0,w+1,1]});
      return artifact;
    }
    const first=await publish("first",0);const remote=await publish("remote",10);
    fetcher.mockClear();
    const concurrent=await Promise.all([cloudRiskMosaic(storage,[0,0,2,1]),cloudRiskMosaic(storage,[0,0,2,1])]);
    expect(concurrent[0].grid.features).toHaveLength(1);
    expect(fetcher.mock.calls.filter(([url])=>String(url).includes(`fileId=${first.file_id}`))).toHaveLength(1);
    expect(fetcher.mock.calls.some(([url])=>String(url).includes(`fileId=${remote.file_id}`))).toBe(false);
    await publish("second",1);
    expect((await cloudRiskMosaic(storage,[0,0,2,1])).grid.features).toHaveLength(2);
  });
});
