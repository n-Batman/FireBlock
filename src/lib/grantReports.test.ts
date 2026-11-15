// @vitest-environment node
import {afterEach,describe,expect,it,vi} from "vitest";
import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import {PDFDocument} from "pdf-lib";
import {GrantReports} from "./grantReports";
import {METHOD_NOTE,parseGrantReport,type GrantFacts} from "./grantReportData";
import {writeGrantNarrative} from "./grantNarrative";
import {renderGrantPdf} from "./grantReportPdf";
import {DEFAULT_PARCEL_LAYER,type Parcels} from "./parcels";
import type {ArchivedParcelScan} from "./parcelScanArchive";
import type {RiskGrid} from "./parcelRisk";

afterEach(()=>vi.unstubAllEnvs());
const ids=["1794729600000-11111111-1111-4111-8111-111111111111","1794733200000-22222222-2222-4222-8222-222222222222"];
const ring=[[-120.66,35.26],[-120.65,35.26],[-120.65,35.27],[-120.66,35.27],[-120.66,35.26]];
const request={project_name:"Evidence test property",county:"San Luis Obispo",program:"CAL FIRE Fire Prevention Grants Program",report_date:"2026-11-15",prepared_by:"Example preparer",
  blocks:[{block_id:"South block",apn:"123-456-789",acres:2.5,treatment_type:"mowing",date_treated:"2026-11-14",location:{lat:35.265,lon:-120.655}}]};
const narrative={project_summary:"Recorded treatment evidence for the project.",community_benefit:"The applicant must supply the community benefit.",implementation:"Treatment dates are preparer supplied.",monitoring:"Phone scans sample views; they do not certify safety.",missing_information:["Confirm eligibility and budget."]};
function setup(){
  const parcels:Parcels={type:"FeatureCollection",features:[{type:"Feature",geometry:{type:"Polygon",coordinates:[ring]},properties:{parcelId:"123-456-789",source:DEFAULT_PARCEL_LAYER,fetchedAt:"2026-11-15T12:00:00Z"}}],metadata:{source:DEFAULT_PARCEL_LAYER,truncated:false,limit:20,fetchedAt:"2026-11-15T12:00:00Z",note:"county"}};
  const grid:RiskGrid={type:"FeatureCollection",features:[{type:"Feature",geometry:{type:"Polygon",coordinates:[ring]},properties:{layer:"relative_risk",cell_id:"c1",model_id:"fireblock-relative-risk-v2",as_of:"2026-11-15T10:00:00Z",risk_score:42}}]};
  const stored=new Map<string,{key:string;bytes:Buffer}>(),keys:string[]=[];
  const upload=async(key:string,bytes:Buffer)=>{keys.push(key);const file_id="file-"+keys.length;stored.set(file_id,{key,bytes});return {file_id,key,bytes:bytes.length,sha256:createHash("sha256").update(bytes).digest("hex")};};
  const storage={requirePrivateBucket:vi.fn(async()=>{}),uploadBytes:vi.fn((key:string,bytes:Buffer,type:string)=>{void type;return upload(key,bytes);}),uploadJson:vi.fn((key:string,value:unknown)=>upload(key,Buffer.from(JSON.stringify(value)))),
    readVersion:vi.fn(async(id:string)=>({value:JSON.parse(stored.get(id)!.bytes.toString()),bytes:stored.get(id)!.bytes})),readBytes:vi.fn(async(id:string)=>({bytes:stored.get(id)!.bytes})),
    listPage:vi.fn(async(prefix:string)=>({files:[...stored].filter(([,v])=>v.key.startsWith(prefix)).map(([fileId,v])=>({fileName:v.key,fileId})),nextFileName:null}))};
  const scans:ArchivedParcelScan[]=ids.map((id,i)=>({kind:"fireblock.parcel-scan",schema_version:1,metric:"dry-fuel-percent-v1",scan_id:id,
    location:{lat:35.265,lon:-120.655,accuracy_m:5},scanned_at:i?"2026-11-15T09:00:00Z":"2026-11-13T09:00:00Z",recorded_at:"2026-11-15T10:00:00Z",score:i?0:70,
    model_id:"headline-estimate-v1",baseline_id:i?ids[0]:null,findings:[],parcel:{id:"123-456-789",source:DEFAULT_PARCEL_LAYER,matched_at:"2026-11-15T10:00:00Z"},
    comparison:i?{baseline_score:70,improvement_points:70,distance_m:0,outcome:"improved"}:null}));
  const scan={get:vi.fn(async(_apn:string,id:string)=>scans.find(s=>s.scan_id===id)!)},lookup=vi.fn(async()=>parcels),current=vi.fn(async()=>({grid,manifest_file_ids:["current-manifest"]}));
  const baseline=vi.fn(async():Promise<{grid:RiskGrid;manifest_file_id:string;grid_file_id:string}>=>({grid:{...grid,features:grid.features.map(f=>({...f,properties:{...f.properties,as_of:"2026-11-13T10:00:00Z",risk_score:60}}))},manifest_file_id:"baseline-manifest",grid_file_id:"baseline-grid"}));
  const writer=vi.fn(async(facts:GrantFacts)=>{void facts;return {narrative,model:"test-model",response_id:"response-1"};});
  const render=vi.fn(async()=>Buffer.from("%PDF-FAKE-FOR-STORAGE-TEST"));
  const service=new GrantReports({storage,lookup,scan,current,baseline,narrative:writer,render,clock:()=>new Date("2026-11-15T12:00:00Z")});
  return {service,storage,stored,keys,scans,scan,lookup,current,baseline,writer,render,grid};
}
const paired=()=>({...request,blocks:[{...request.blocks[0],before_scan:{scan_id:ids[0]},after_scan:{scan_id:ids[1]}}]});

describe("private grant report workflow",()=>{
  it("keeps acres, satellite risk and stored scan percentages separate; publishes manifest last",async()=>{
    const s=setup(),result=await s.service.create(paired()),facts=s.writer.mock.calls[0][0];
    expect(facts.total_acres).toBe(2.5);expect(facts.acres_by_treatment).toEqual({mowing:2.5,grazing:0,"brush removal":0,other:0});
    expect(facts.blocks[0].risk_before).toBeNull();expect(facts.blocks[0].risk_after.risk_score).toBeCloseTo(42);
    expect(facts.blocks[0].before?.scan.score).toBe(70);expect(facts.blocks[0].after?.scan.score).toBe(0);expect(facts.blocks[0].scan_status).toBe("cleared");
    expect(s.keys.map(k=>k.split("/").at(-1))).toEqual(["evidence.json","application.pdf","manifest.json"]);
    expect(s.storage.uploadBytes.mock.calls[0][2]).toBe("application/pdf");
    expect((await s.service.download(result.report_id)).toString()).toBe("%PDF-FAKE-FOR-STORAGE-TEST");
    expect(result.download_url).toContain(result.report_id);
  });
  it("preserves unknown before risk and not-scanned status instead of inventing improvement",async()=>{
    const s=setup();await s.service.create(request);const facts=s.writer.mock.calls[0][0];
    expect(facts.blocks[0]).toMatchObject({before:null,after:null,risk_before:null,scan_status:"not scanned"});expect(s.scan.get).not.toHaveBeenCalled();
    const s2=setup();s2.scans[1].score=17;await s2.service.create(paired());expect(s2.writer.mock.calls[0][0].blocks[0].scan_status).toBe("still dry");
  });
  it("resolves pinned baseline risk and refuses risk dated after treatment as a baseline",async()=>{
    const input={...request,before_publication:{manifest_file_id:"m",manifest_sha256:"a".repeat(64),manifest_bytes:10}},s=setup();
    await s.service.create(input);expect(s.writer.mock.calls[0][0].blocks[0].risk_before?.risk_score).toBeCloseTo(60);
    const bad=setup();bad.baseline.mockResolvedValue({grid:bad.grid,manifest_file_id:"m",grid_file_id:"g"});
    await expect(bad.service.create(input)).rejects.toThrow(/Baseline risk/);expect(bad.storage.uploadJson).not.toHaveBeenCalled();
  });
  it("retains current map risk but leaves after-treatment risk unknown when the model is older",async()=>{
    const s=setup();s.grid.features[0].properties.as_of="2026-11-13T12:00:00Z";
    await s.service.create(request);const b=s.writer.mock.calls[0][0].blocks[0];expect(b.risk_current.risk_score).toBeCloseTo(42);expect(b.risk_after.risk_score).toBeNull();
  });
  it("rejects mismatched APNs, excessive acres, and invalid stored scan pairs before AI/upload",async()=>{
    for(const change of [{apn:"other-apn"},{acres:1000000}]){
      const s=setup();await expect(s.service.create({...request,blocks:[{...request.blocks[0],...change}]})).rejects.toMatchObject({status:422});expect(s.writer).not.toHaveBeenCalled();
    }
    const s=setup();s.scans[1].baseline_id=null;await expect(s.service.create(paired())).rejects.toThrow(/baseline\/follow-up/);expect(s.writer).not.toHaveBeenCalled();
    const other=setup();other.scans[1].location.lon=-121;await expect(other.service.create(paired())).rejects.toThrow(/GPS\/APN/);
    const future=setup();future.scans[1].scanned_at="2026-11-16T09:00:00Z";await expect(future.service.create(paired())).rejects.toThrow(/dates/);
  });
  it("does not publish a completion marker when AI, PDF or artifact storage fails",async()=>{
    for(const stage of ["writer","render","storage"]){
      const s=setup();if(stage==="writer")s.writer.mockRejectedValue(new Error("AI failed"));if(stage==="render")s.render.mockRejectedValue(new Error("PDF failed"));if(stage==="storage")s.storage.uploadBytes.mockRejectedValue(new Error("upload failed"));
      await expect(s.service.create(request)).rejects.toThrow();expect(s.keys.some(k=>k.endsWith("manifest.json"))).toBe(false);
    }
  });
  it("refuses reports in a public bucket before sending any facts to AI",async()=>{
    const s=setup();s.storage.requirePrivateBucket.mockRejectedValue(new Error("Private bucket required"));
    await expect(s.service.create(request)).rejects.toThrow(/Private/);expect(s.writer).not.toHaveBeenCalled();expect(s.keys).toEqual([]);
  });
  it("rejects malformed report IDs and altered PDFs on private retrieval",async()=>{
    const s=setup();await expect(s.service.download("../../risk/latest.json")).rejects.toMatchObject({status:400});
    const result=await s.service.create(request);s.storage.readBytes.mockResolvedValue({bytes:Buffer.from("%PDF-tampered")});await expect(s.service.download(result.report_id)).rejects.toThrow(/manifest/);
  });
  it("renders a real PDF with proof placeholders and a parcel map",async()=>{
    const s=setup();await s.service.create(paired());const facts=s.writer.mock.calls[0][0];
    const bytes=await renderGrantPdf(facts,narrative),pdf=await PDFDocument.load(bytes);expect(pdf.getPageCount()).toBeGreaterThanOrEqual(4);expect(pdf.getTitle()).toContain("Evidence test property");
    expect(facts.method_note).toBe(METHOD_NOTE);
  });
  it("archives attached photos with scan metadata and renders actual image bytes",async()=>{
    const s=setup(),input=paired(),photo=await readFile("public/demo/sample-hillside.jpg");
    const withPhoto={...input,blocks:[{...input.blocks[0],before_scan:{scan_id:ids[0],photo:"data:image/jpeg;base64,"+photo.toString("base64")}}]};
    await s.service.create(withPhoto);expect(s.keys[0]).toMatch(/photos\/0-before.jpg$/);
    const evidence=JSON.parse([...s.stored.values()].find(v=>v.key.endsWith("evidence.json"))!.bytes.toString());
    expect(evidence.blocks[0].before.photo.file_id).toBeDefined();expect(evidence.blocks[0].before.photo_metadata).toContain("not verified");
    expect(evidence.blocks[0].before.scan.scanned_at).toBe("2026-11-13T09:00:00Z");expect(JSON.stringify(evidence)).not.toContain('"type":"Buffer"');
    const pdf=await renderGrantPdf(s.writer.mock.calls[0][0],narrative);expect((await PDFDocument.load(pdf)).getPageCount()).toBeGreaterThanOrEqual(4);
  });
  it("does not double-count a stored scan across blocks or accept dates before work as follow-up",async()=>{
    const s=setup();await expect(s.service.create({...request,blocks:[{...request.blocks[0],after_scan:{scan_id:ids[0]}}]})).rejects.toThrow(/dates/);
    const reused=setup(),input=paired();await expect(reused.service.create({...input,blocks:[input.blocks[0],{...input.blocks[0],block_id:"Second"}]})).rejects.toThrow(/only one block/);
  });
});
describe("report validation and OpenAI boundaries",()=>{
  it("rejects forged score fields, future/invalid dates, duplicate blocks and remote photos",()=>{
    const now=new Date("2026-11-15T12:00:00Z");
    for(const input of [{...request,risk_score:1},{...request,report_date:"2026-02-30"},{...request,report_date:"2026-11-16"},{...request,blocks:[request.blocks[0],request.blocks[0]]},
      {...request,blocks:[{...request.blocks[0],before_scan:{scan_id:ids[0],photo:"https://private.example/photo.jpg"}}]},
      {...request,blocks:[{...request.blocks[0],acres:NaN}]}])expect(()=>parseGrantReport(input,now)).toThrow();
  });
  it("sends redacted facts with store:false and a strict schema; never sends photos or GPS",async()=>{
    vi.stubEnv("OPENAI_API_KEY","test-secret");const s=setup();await s.service.create(paired());
    const fetcher=vi.fn<typeof fetch>().mockResolvedValue(Response.json({id:"response",output:[{content:[{type:"output_text",text:JSON.stringify(narrative)}]}]}));
    const result=await writeGrantNarrative(s.writer.mock.calls[0][0],fetcher),body=JSON.parse(String(fetcher.mock.calls[0][1]!.body));
    expect(result.narrative).toEqual(narrative);expect(body.store).toBe(false);expect(body.text.format.strict).toBe(true);
    expect(body.input).not.toContain("-120.655");expect(body.input).not.toContain(ids[0]);expect(body.input).not.toContain("photo");expect(body.input).not.toContain("123-456-789");
  });
  it("reports missing OpenAI keys and hides upstream errors and malformed narrative",async()=>{
    const s=setup();await s.service.create(request);const facts=s.writer.mock.calls[0][0];vi.stubEnv("OPENAI_API_KEY","");await expect(writeGrantNarrative(facts)).rejects.toMatchObject({status:503});
    vi.stubEnv("OPENAI_API_KEY","test-secret");
    await expect(writeGrantNarrative(facts,vi.fn().mockResolvedValue(new Response("test-secret",{status:500})))).rejects.toThrow("OpenAI grant narrative request failed");
    await expect(writeGrantNarrative(facts,vi.fn().mockResolvedValue(Response.json({output:[]})))).rejects.toThrow(/invalid/);
  });
});
