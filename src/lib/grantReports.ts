import {createHash,randomUUID} from "node:crypto";
import {area} from "@turf/area";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import {point} from "@turf/helpers";
import {CloudStorage,cloudRiskGrid,cloudRiskMosaic} from "./cloudStorage";
import {findParcels,type Parcels} from "./parcels";
import {ParcelScanArchive} from "./parcelScanArchive";
import {projectGridToParcels,type RiskGrid} from "./parcelRisk";
import type {RiskBounds} from "./riskMosaic";
import {renderGrantPdf} from "./grantReportPdf";
import {writeGrantNarrative} from "./grantNarrative";
import {GrantReportError,METHOD_NOTE,PROGRAM_SOURCE,TREATMENTS,parseGrantReport,type GrantFacts,type GrantBlock,type Proof,type ProofInput} from "./grantReportData";

type Receipt=Awaited<ReturnType<CloudStorage["uploadJson"]>>;
type Storage=Pick<CloudStorage,"uploadJson"|"uploadBytes"|"listPage"|"requirePrivateBucket">&{
  readVersion:(id:string,limit?:number)=>Promise<{value:Awaited<ReturnType<CloudStorage["readVersion"]>>["value"];bytes:Buffer}>;
  readBytes:(id:string,limit?:number)=>Promise<{bytes:Buffer}>};
type Deps={storage:Storage;lookup:typeof findParcels;scan:Pick<ParcelScanArchive,"get">;
  current:(bbox:RiskBounds)=>Promise<{grid:RiskGrid;manifest_file_ids?:string[];manifest_file_id?:string}>;baseline:(pin:NonNullable<Parameters<typeof cloudRiskGrid>[1]>)=>ReturnType<typeof cloudRiskGrid>;
  narrative:typeof writeGrantNarrative;render:typeof renderGrantPdf;clock:()=>Date};
const REPORT_ID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export class GrantReports {
  private deps:Deps;
  constructor(overrides:Partial<Deps>={}){
    const storage=new CloudStorage();
    this.deps={storage,lookup:findParcels,scan:new ParcelScanArchive(),current:bbox=>cloudRiskMosaic(storage,bbox),
      baseline:pin=>cloudRiskGrid(storage,pin),narrative:writeGrantNarrative,render:renderGrantPdf,clock:()=>new Date(),...overrides};
  }
  async create(value:unknown){
    const d=this.deps,now=d.clock(),input=parseGrantReport(value,now);
    await d.storage.requirePrivateBucket();
    const apns=new Map<string,Parcels["features"][number]>();
    for(const block of input.blocks){
      if(apns.has(block.apn)){
        if(!booleanPointInPolygon(point([block.location.lon,block.location.lat]),apns.get(block.apn)!))throw new GrantReportError("Block point is outside its APN",422);
        continue;
      }
      const found=await d.lookup(new URLSearchParams({lat:String(block.location.lat),lon:String(block.location.lon),radius:"0"}));
      if(found.metadata.truncated)throw new GrantReportError("Incomplete parcel lookup; narrow the project",502);
      const matches=found.features.filter(f=>f.properties.parcelId===block.apn&&booleanPointInPolygon(point([block.location.lon,block.location.lat]),f));
      if(matches.length!==1)throw new GrantReportError("Block APN must match one county parcel at its GPS point",422);
      apns.set(block.apn,matches[0]);
    }
    for(const [apn,parcel] of apns){
      const acres=input.blocks.filter(b=>b.apn===apn).reduce((sum,b)=>sum+b.acres,0);
      if(acres>area(parcel)/4046.8564224*1.01)throw new GrantReportError("Declared treated acres exceed the parcel area",422);
    }
    const parcels:Parcels={type:"FeatureCollection",features:[...apns.values()],metadata:{source:"county lookup",truncated:false,limit:20,fetchedAt:now.toISOString(),note:"GIS parcel boundaries"}};
    const bounds:RiskBounds=[Infinity,Infinity,-Infinity,-Infinity];
    for(const parcel of parcels.features){
      const points=parcel.geometry.type==="Polygon"?parcel.geometry.coordinates.flat():parcel.geometry.coordinates.flat(2);
      for(const p of points){bounds[0]=Math.min(bounds[0],p[0]);bounds[1]=Math.min(bounds[1],p[1]);bounds[2]=Math.max(bounds[2],p[0]);bounds[3]=Math.max(bounds[3],p[1]);}
    }
    const current=await d.current(bounds),after=projectGridToParcels(parcels,current.grid);
    const baseline=input.before_publication?await d.baseline({kind:"fireblock.risk-pointer",schema_version:1,...input.before_publication}):null;
    const before=baseline?projectGridToParcels(parcels,baseline.grid):null;
    const usedScanIds=new Set<string>();
    const blocks:GrantBlock[]=[];
    for(const block of input.blocks){
      const parcel=apns.get(block.apn)!;
      async function read(proof:ProofInput|undefined,phase:"before"|"after"):Promise<Proof|null>{
        if(!proof)return null;
        if(usedScanIds.has(proof.scan_id))throw new GrantReportError("Each scan can support only one block and phase");
        usedScanIds.add(proof.scan_id);
        const scan=await d.scan.get(block.apn,proof.scan_id);
        if(scan.parcel.id!==block.apn||scan.parcel.source!==parcel.properties.source||!booleanPointInPolygon(point([scan.location.lon,scan.location.lat]),parcel))throw new GrantReportError("Scan GPS/APN does not match its report parcel",409);
        const date=scan.scanned_at.slice(0,10);
        if(date>input.report_date||(phase==="before"?date>block.date_treated:date<block.date_treated))throw new GrantReportError("Scan dates must bracket treatment and precede the report date",409);
        return {scan,...(proof.photo?{photo:proof.photo}:{})};
      }
      const pre=await read(block.before_scan,"before"),post=await read(block.after_scan,"after");
      if(pre&&post&&(post.scan.baseline_id!==pre.scan.scan_id||post.scan.model_id!==pre.scan.model_id||post.scan.scanned_at<=pre.scan.scanned_at))throw new GrantReportError("Before/after evidence must be a stored same-method baseline/follow-up pair",409);
      const risk_before=before?.features.find(f=>f.properties.parcelId===block.apn)?.properties??null;
      if(risk_before?.source_as_of.some(stamp=>stamp.slice(0,10)>block.date_treated))throw new GrantReportError("Baseline risk observation must precede treatment",409);
      const risk_current=after.features.find(f=>f.properties.parcelId===block.apn)!.properties;
      const validAfter=risk_current.source_as_of.length>0&&risk_current.source_as_of.every(stamp=>stamp.slice(0,10)>=block.date_treated&&stamp.slice(0,10)<=input.report_date);
      const {before_scan:unusedBefore,after_scan:unusedAfter,...treatment}=block;void unusedBefore;void unusedAfter;
      blocks.push({...treatment,parcel,risk_before,risk_current,
        risk_after:validAfter?risk_current:{...risk_current,risk_score:null,status:"unknown"},before:pre,after:post,
        scan_status:post?(post.scan.score===0?"cleared":"still dry"):"not scanned"});
    }
    const acres_by_treatment=Object.fromEntries(TREATMENTS.map(type=>[type,input.blocks.filter(b=>b.treatment_type===type).reduce((s,b)=>s+b.acres,0)])) as GrantFacts["acres_by_treatment"];
    const dates=input.blocks.map(b=>b.date_treated).sort(),report_id=randomUUID();
    const {before_publication:pin,blocks:ignored,...header}=input;void ignored;
    const facts:GrantFacts={...header,report_id,generated_at:now.toISOString(),total_acres:Object.values(acres_by_treatment).reduce((a,b)=>a+b,0),acres_by_treatment,
      date_start:dates[0],date_end:dates.at(-1)!,blocks,risk_sources:{before:pin??null,after_manifest_ids:current.manifest_file_ids??(current.manifest_file_id?[current.manifest_file_id]:[])},method_note:METHOD_NOTE};
    const generated=await d.narrative(facts),pdf=await d.render(facts,generated.narrative);
    if(pdf.length>20*1024*1024)throw new GrantReportError("Report exceeds 20 MiB; use fewer blocks/photos",413);
    const prefix=`grant-reports/v1/${report_id}/`,photos:Record<string,Receipt>={};
    // The manifest is the completion marker; failed artifacts never create a ready report.
    for(const [i,block] of blocks.entries())for(const phase of ["before","after"] as const){
      const photo=block[phase]?.photo;
      if(photo)photos[`${i}/${phase}`]=await d.storage.uploadBytes(`${prefix}photos/${i}-${phase}.${photo.content_type==="image/png"?"png":"jpg"}`,photo.bytes,photo.content_type);
    }
    const evidence={...facts,blocks:blocks.map((block,i)=>({...block,before:cleanProof(block.before,photos[`${i}/before`]),after:cleanProof(block.after,photos[`${i}/after`])})),
      narrative:generated.narrative,ai:{model:generated.model,response_id:generated.response_id},program_source:PROGRAM_SOURCE,
      limitations:["Application draft and evidence attachment; no submission or eligibility determination.","Treatment acres and photos supplied by preparer; attached photo capture metadata is not independently verified.",
        "Dry ground cover percent means dry share of visible ground vegetation, not percent of the parcel or whole camera frame.","Scan status describes the sampled view only. Scores do not establish safety or prove treatment caused a change.","After risk is unavailable when a model observation is outside treatment/report dates; source satellite imagery may predate treatment."]};
    const evidenceReceipt=await d.storage.uploadJson(prefix+"evidence.json",evidence);
    const pdfReceipt=await d.storage.uploadBytes(prefix+"application.pdf",pdf,"application/pdf");
    const manifest={kind:"fireblock.grant-report",schema_version:1,status:"complete",report_id,generated_at:now.toISOString(),project_name:input.project_name,
      program:input.program,prepared_by:input.prepared_by,pdf:pdfReceipt,evidence:evidenceReceipt,photos:Object.values(photos)};
    const receipt=await d.storage.uploadJson(prefix+"manifest.json",manifest);
    return {report_id,status:"complete",pdf:pdfReceipt,manifest:receipt,download_url:`/api/grant-reports?report_id=${report_id}`,summary:{total_acres:facts.total_acres,acres_by_treatment,blocks:blocks.length}};
  }
  async download(id:string){
    if(!REPORT_ID.test(id))throw new GrantReportError("Invalid report_id");
    const key=`grant-reports/v1/${id}/manifest.json`,page=await this.deps.storage.listPage(key,undefined,1),file=page.files.find(f=>f.fileName===key);
    if(!file)throw new GrantReportError("Completed report not found",404);
    const {value:m}=await this.deps.storage.readVersion(file.fileId,64*1024);
    if(m?.kind!=="fireblock.grant-report"||m.schema_version!==1||m.status!=="complete"||m.report_id!==id||m.pdf?.key!==`grant-reports/v1/${id}/application.pdf`||typeof m.pdf.file_id!=="string"||!/^[0-9a-f]{64}$/.test(m.pdf.sha256)||!Number.isSafeInteger(m.pdf.bytes)||m.pdf.bytes<1||m.pdf.bytes>20*1024*1024)throw new Error("Invalid grant report manifest");
    const {bytes}=await this.deps.storage.readBytes(m.pdf.file_id,20*1024*1024);
    if(bytes.length!==m.pdf.bytes||createHash("sha256").update(bytes).digest("hex")!==m.pdf.sha256||bytes.subarray(0,5).toString()!=="%PDF-")throw new Error("Report PDF does not match its manifest");
    return bytes;
  }
}
function cleanProof(proof:Proof|null,receipt?:Receipt){
  return proof?{scan:proof.scan,photo:receipt??null,photo_metadata:"Photo attached by preparer; date/time/GPS come from the stored scan, not verified photo EXIF"}:null;
}
