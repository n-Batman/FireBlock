import {afterEach,describe,expect,it,vi} from "vitest";
import {createHash} from "node:crypto";
import {ParcelScanArchive,type ArchivedParcelScan} from "./parcelScanArchive";
import {DEFAULT_PARCEL_LAYER,type Parcels} from "./parcels";

afterEach(()=>vi.unstubAllEnvs());
const box=(w=0,s=0,e=1,n=1)=>[[[w,s],[e,s],[e,n],[w,n],[w,s]]];
const observation={location:{lat:.5,lon:.5,accuracy_m:5},scanned_at:"2026-11-15T10:00:00Z",score:70,model_id:"headline-estimate-v1",
  findings:[{label:"Dry grass",severity:"risk",action:"Clear the dry growth"}]};
function parcels():Parcels{return {type:"FeatureCollection",features:[{type:"Feature",geometry:{type:"Polygon",coordinates:box()},
  properties:{parcelId:"123-456-789",source:DEFAULT_PARCEL_LAYER,fetchedAt:"2026-11-15T12:00:00Z"}}],
  metadata:{source:DEFAULT_PARCEL_LAYER,truncated:false,limit:500,fetchedAt:"2026-11-15T12:00:00Z",note:"GIS boundaries"}};}
function setup(){
  const values=new Map<string,{key:string;value:ArchivedParcelScan}>();
  const storage={
    uploadJson:vi.fn(async(key:string,value:unknown)=>{
      const file_id="cloud-"+(values.size+1),bytes=Buffer.from(JSON.stringify(value));
      values.set(file_id,{key,value:JSON.parse(bytes.toString())});
      return {key,file_id,bytes:bytes.length,sha256:createHash("sha256").update(bytes).digest("hex")};
    }),
    readVersion:vi.fn(async(id:string)=>({value:values.get(id)!.value,bytes:Buffer.from(JSON.stringify(values.get(id)!.value))})),
    listPage:vi.fn(async(prefix:string,start?:string,limit=50)=>{
      const all=[...values].map(([fileId,item])=>({fileId,fileName:item.key}))
        .filter(file=>file.fileName.startsWith(prefix)&&(!start||file.fileName>=start)).sort((a,b)=>a.fileName.localeCompare(b.fileName));
      return {files:all.slice(0,limit),nextFileName:all[limit]?.fileName??null};
    }),
  };
  const lookup=vi.fn(async(_query:URLSearchParams)=>parcels()),clock=vi.fn(()=>new Date("2026-11-15T12:00:00Z"));
  const archive=new ParcelScanArchive(storage,lookup,clock);
  return {archive,storage,lookup,clock,values};
}

describe("cloud parcel scan archive",()=>{
  it("matches GPS to the county parcel and saves only the scan observation",async()=>{
    const {archive,storage,lookup}=setup();const result=await archive.save(observation);
    expect(lookup.mock.calls[0][0].get("radius")).toBe("0");
    expect(result.scan.parcel.id).toBe("123-456-789");
    expect(result.scan.baseline_id).toBeNull();expect(result.scan.comparison).toBeNull();
    expect(result.scan.score).toBe(70);expect(result.scan.findings).toEqual(observation.findings);
    expect(result.receipt.key).toMatch(/^parcel-scans\/v1\/[a-f0-9]{64}\/\d{13}-[a-f0-9-]+\.json$/);
    expect(JSON.stringify(storage.uploadJson.mock.calls)).not.toContain("coordinates");
    expect(JSON.stringify(result)).not.toContain("authorization");
  });
  it.each([[30,40,"improved"],[70,0,"unchanged"],[90,-20,"worsened"]])("compares a follow-up score of %s without assuming improvement",async(score,points,outcome)=>{
    const {archive}=setup(),baseline=await archive.save(observation);
    const result=await archive.save({...observation,score,baseline_id:baseline.scan.scan_id,scanned_at:"2026-11-15T11:00:00Z"});
    expect(result.scan.comparison).toEqual({baseline_score:70,improvement_points:points,outcome,distance_m:0});
    const history=await archive.history("123-456-789");
    expect(history.scans).toHaveLength(2);
    expect(history.scans.find(scan=>scan.scan_id===baseline.scan.scan_id)?.score).toBe(70);
  });
  it("handles a zero baseline and complete clearing without relative-percentage math",async()=>{
    const {archive}=setup(),baseline=await archive.save({...observation,score:0});
    const result=await archive.save({...observation,score:0,baseline_id:baseline.scan.scan_id,scanned_at:"2026-11-15T11:00:00Z"});
    expect(result.scan.comparison?.improvement_points).toBe(0);
    expect(result.scan.comparison?.outcome).toBe("unchanged");
  });
  it("does not compare different methods, earlier scans, distant locations or follow-up chains",async()=>{
    const {archive,storage}=setup(),baseline=await archive.save(observation);
    const follow={...observation,baseline_id:baseline.scan.scan_id,scanned_at:"2026-11-15T11:00:00Z"};
    for(const change of [{model_id:"sam-share-v1"},{scanned_at:observation.scanned_at},{location:{lat:.501,lon:.5}}]){
      await expect(archive.save({...follow,...change})).rejects.toMatchObject({status:409});
    }
    const second=await archive.save(follow);
    await expect(archive.save({...follow,baseline_id:second.scan.scan_id})).rejects.toMatchObject({status:409});
    expect(storage.uploadJson).toHaveBeenCalledTimes(2);
  });
  it("will not pair a baseline belonging to another parcel",async()=>{
    const {archive,lookup,storage}=setup(),baseline=await archive.save(observation);
    const other=parcels();other.features[0].properties.parcelId="different-parcel";lookup.mockResolvedValue(other);
    await expect(archive.save({...observation,baseline_id:baseline.scan.scan_id,scanned_at:"2026-11-15T11:00:00Z"})).rejects.toMatchObject({status:404});
    expect(storage.uploadJson).toHaveBeenCalledTimes(1);
    expect((await archive.history("different-parcel")).scans).toEqual([]);
  });
  it("rejects locations outside parcels, in holes, and on ambiguous boundaries",async()=>{
    const {archive,lookup,storage}=setup();
    const hole=parcels();hole.features[0].geometry={type:"Polygon",coordinates:[...box(),...box(.4,.4,.6,.6)]};
    lookup.mockResolvedValueOnce(hole);
    await expect(archive.save(observation)).rejects.toMatchObject({status:422});
    const ambiguous=parcels();ambiguous.features.push({...ambiguous.features[0],properties:{...ambiguous.features[0].properties,parcelId:"overlap"}});
    lookup.mockResolvedValueOnce(ambiguous);
    await expect(archive.save(observation)).rejects.toMatchObject({status:409});
    await expect(archive.save({...observation,location:{lat:2,lon:2}})).rejects.toMatchObject({status:422});
    expect(storage.uploadJson).not.toHaveBeenCalled();
  });
  it("matches a point inside the second part of a multipart parcel",async()=>{
    const {archive,lookup}=setup(),multi=parcels();
    multi.features[0].geometry={type:"MultiPolygon",coordinates:[box(),box(2,2,3,3)]};lookup.mockResolvedValue(multi);
    expect((await archive.save({...observation,location:{lat:2.5,lon:2.5}})).scan.parcel.id).toBe("123-456-789");
  });
  it("does not accept a truncated or failed parcel lookup",async()=>{
    const {archive,lookup,storage}=setup(),incomplete=parcels();incomplete.metadata.truncated=true;
    lookup.mockResolvedValueOnce(incomplete);
    await expect(archive.save(observation)).rejects.toThrow(/Incomplete/);
    lookup.mockRejectedValueOnce(new Error("Provider unavailable"));
    await expect(archive.save(observation)).rejects.toThrow(/Provider/);
    expect(storage.uploadJson).not.toHaveBeenCalled();
  });
  it("validates scores, GPS, method versions, dates, findings and extra payload fields before lookup",async()=>{
    const {archive,lookup}=setup();
    for(const change of [{score:-1},{score:101},{score:NaN},{location:{lat:91,lon:0}},
      {location:{lat:.5,lon:.5,accuracy_m:101}},{model_id:""},{scanned_at:"2026-11-15"},
      {scanned_at:"2026-02-30T10:00:00Z"},{scanned_at:"2026-11-16T10:00:00Z"},
      {findings:new Array(21).fill(observation.findings[0])},{findings:[{label:"Dry",severity:"unknown",action:"Clear"}]},
      {image:"private-photo"},{parcel_id:"forged-parcel"}]){
      await expect(archive.save({...observation,...change})).rejects.toMatchObject({status:400});
    }
    expect(lookup).not.toHaveBeenCalled();
  });
  it("preserves concurrent scans as independent objects and pages their parcel history",async()=>{
    const {archive,storage}=setup();
    const results=await Promise.all([70,60,50].map(score=>archive.save({...observation,score})));
    expect(new Set(results.map(result=>result.scan.scan_id)).size).toBe(3);
    const first=await archive.history("123-456-789",undefined,2);
    expect(first.scans).toHaveLength(2);expect(first.next_cursor).not.toBeNull();
    const second=await archive.history("123-456-789",first.next_cursor!,2);
    expect(second.scans).toHaveLength(1);expect(second.next_cursor).toBeNull();
    expect(new Set([...first.scans,...second.scans].map(scan=>scan.scan_id)).size).toBe(3);
    expect(storage.readVersion).toHaveBeenCalledWith(expect.any(String),64*1024);
    await expect(archive.history("other",first.next_cursor!)).rejects.toMatchObject({status:400});
    await expect(archive.history("123",undefined,101)).rejects.toMatchObject({status:400});
  });
  it("fails instead of returning corrupt records or acknowledging failed uploads",async()=>{
    const {archive,values,storage}=setup();await archive.save(observation);
    [...values.values()][0].value.score=101;
    await expect(archive.history("123-456-789")).rejects.toThrow(/Invalid cloud/);
    storage.uploadJson.mockRejectedValueOnce(new Error("Cloud checksum mismatch"));
    await expect(archive.save(observation)).rejects.toThrow(/checksum/);
  });
});
