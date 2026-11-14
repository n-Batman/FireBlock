import {afterEach,describe,expect,it,vi} from "vitest";
import {createHash} from "node:crypto";
import {CloudStorage,archiveParcelDisplay,cloudRiskGrid} from "./cloudStorage";
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
      const prefix=JSON.parse(String(init!.body)).prefix;let found;
      for(const [id,bytes] of stored){const index=Number(id.replace("id-",""))-1;if(keys[index]===prefix)found={fileId:id,fileName:prefix};void bytes;}
      return Response.json({files:found?[found]:[]});
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
});
