import type {ArchivedParcelScan} from "./parcelScanArchive";
import type {Parcels} from "./parcels";
import type {ParcelRisk} from "./parcelRisk";

export const GRANT_PROGRAM="CAL FIRE Fire Prevention Grants Program";
export const PROGRAM_SOURCE="https://www.fire.ca.gov/what-we-do/grants/wildfire-prevention-grants";
export const METHOD_NOTE="Risk from satellite moisture and NASA FIRMS fire detections. Ground cover measured from dated phone scans. Vines and trees not counted.";
export const TREATMENTS=["mowing","grazing","brush removal","other"] as const;
export type Treatment=typeof TREATMENTS[number];
export class GrantReportError extends Error {constructor(message:string,public status=400){super(message);}}
export type Photo={bytes:Buffer;content_type:"image/jpeg"|"image/png"};
export type ProofInput={scan_id:string;photo?:Photo};
export type Publication={manifest_file_id:string;manifest_sha256:string;manifest_bytes:number};
export type GrantBlockInput={block_id:string;apn:string;acres:number;treatment_type:Treatment;date_treated:string;
  location:{lat:number;lon:number};before_scan?:ProofInput;after_scan?:ProofInput};
export type GrantReportInput={project_name:string;county:string;program:string;report_date:string;prepared_by:string;
  applicant_name:string|null;project_description:string|null;community_benefit:string|null;implementation_plan:string|null;
  requested_funding:number|null;before_publication?:Publication;blocks:GrantBlockInput[]};
export type Proof={scan:ArchivedParcelScan;photo?:Photo};
export type GrantBlock=Omit<GrantBlockInput,"before_scan"|"after_scan">&{parcel:Parcels["features"][number];
  risk_before:ParcelRisk|null;risk_after:ParcelRisk;risk_current:ParcelRisk;before:Proof|null;after:Proof|null;scan_status:"cleared"|"still dry"|"not scanned"};
export type GrantFacts=Omit<GrantReportInput,"blocks"|"before_publication">&{report_id:string;generated_at:string;
  total_acres:number;acres_by_treatment:Record<Treatment,number>;date_start:string;date_end:string;blocks:GrantBlock[];
  risk_sources:{before:Publication|null;after_manifest_ids:string[]};method_note:string};

export function record(value:unknown):Record<string,unknown>{
  if(!value||typeof value!=="object"||Array.isArray(value))throw new GrantReportError("Send a JSON object");
  return value as Record<string,unknown>;
}
export function only(value:Record<string,unknown>,keys:string[]){
  if(Object.keys(value).some(key=>!keys.includes(key)))throw new GrantReportError("Unexpected report fields");
}
export function text(value:unknown,limit=160):string{
  if(typeof value!=="string"||!value.trim()||value.length>limit||/[\u0000-\u001f]/.test(value))throw new GrantReportError("Invalid report text");
  return value.trim();
}
const finite=(v:unknown):v is number=>typeof v==="number"&&Number.isFinite(v);
export function dateOnly(value:unknown){
  if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value)throw new GrantReportError("Use a valid YYYY-MM-DD date");
  return value;
}
function photo(value:unknown):Photo{
  if(typeof value!=="string"||value.length>1_400_000)throw new GrantReportError("Photos must be JPEG/PNG data URLs up to 1 MiB each",413);
  const match=/^data:image\/(jpeg|png);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if(!match)throw new GrantReportError("Photos must be JPEG/PNG data URLs");
  const bytes=Buffer.from(match[2],"base64");
  if(!bytes.length||bytes.length>1024*1024||bytes.toString("base64")!==match[2])throw new GrantReportError("Invalid or oversized photo");
  if(match[1]==="png"){
    if(bytes.length<24||bytes.subarray(0,8).toString("hex")!=="89504e470d0a1a0a"||bytes.toString("ascii",12,16)!=="IHDR")throw new GrantReportError("Invalid PNG photo");
    const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
    if(!width||!height||width*height>8_000_000)throw new GrantReportError("Photo exceeds 8 million pixels");
  }else if(bytes.length<4||bytes[0]!==255||bytes[1]!==216||bytes[2]!==255)throw new GrantReportError("Invalid JPEG photo");
  return {bytes,content_type:match[1]==="png"?"image/png":"image/jpeg"};
}
function proof(value:unknown):ProofInput|undefined{
  if(value==null)return undefined;
  const raw=record(value);only(raw,["scan_id","photo"]);
  const scan_id=text(raw.scan_id,100);
  if(!/^\d{13}-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(scan_id))throw new GrantReportError("Invalid stored scan ID");
  return {scan_id,...(raw.photo!==undefined?{photo:photo(raw.photo)}:{})};
}
export function parseGrantReport(value:unknown,now=new Date()):GrantReportInput{
  const raw=record(value);only(raw,["project_name","county","program","report_date","prepared_by","applicant_name","project_description","community_benefit","implementation_plan","requested_funding","before_publication","blocks"]);
  const report_date=dateOnly(raw.report_date);
  if(report_date>now.toISOString().slice(0,10))throw new GrantReportError("Report date cannot be in the future");
  if(!Array.isArray(raw.blocks)||raw.blocks.length<1||raw.blocks.length>20)throw new GrantReportError("Include 1 to 20 blocks");
  const ids=new Set<string>();
  const blocks=raw.blocks.map(value=>{
    const b=record(value);only(b,["block_id","apn","acres","treatment_type","date_treated","location","before_scan","after_scan"]);
    const block_id=text(b.block_id,80),apn=text(b.apn,128),location=record(b.location);only(location,["lat","lon"]);
    if(ids.has(block_id))throw new GrantReportError("Block IDs must be unique");ids.add(block_id);
    if(!finite(b.acres)||b.acres<=0||b.acres>1_000_000)throw new GrantReportError("Treated acres must be greater than zero and at most 1000000");
    if(!TREATMENTS.includes(b.treatment_type as Treatment))throw new GrantReportError("Invalid treatment type");
    if(!finite(location.lat)||!finite(location.lon)||Math.abs(location.lat)>85||Math.abs(location.lon)>180)throw new GrantReportError("Invalid block GPS coordinates");
    const date_treated=dateOnly(b.date_treated);
    if(date_treated>report_date)throw new GrantReportError("Treatment cannot be after report date");
    return {block_id,apn,acres:b.acres,treatment_type:b.treatment_type as Treatment,date_treated,location:{lat:location.lat,lon:location.lon},before_scan:proof(b.before_scan),after_scan:proof(b.after_scan)};
  });
  let before_publication:Publication|undefined;
  if(raw.before_publication!=null){
    const p=record(raw.before_publication);only(p,["manifest_file_id","manifest_sha256","manifest_bytes"]);
    if(typeof p.manifest_sha256!=="string"||! /^[0-9a-f]{64}$/.test(p.manifest_sha256)||!Number.isSafeInteger(p.manifest_bytes)||(p.manifest_bytes as number)<1||(p.manifest_bytes as number)>25*1024*1024)throw new GrantReportError("Invalid baseline risk publication pin");
    before_publication={manifest_file_id:text(p.manifest_file_id,300),manifest_sha256:p.manifest_sha256,manifest_bytes:p.manifest_bytes as number};
  }
  const optional=(key:string)=>raw[key]==null?null:text(raw[key],key==="applicant_name"?160:2400);
  if(raw.requested_funding!=null&&(!finite(raw.requested_funding)||raw.requested_funding<0||raw.requested_funding>1_000_000_000))throw new GrantReportError("Invalid requested funding amount");
  return {project_name:text(raw.project_name),county:text(raw.county,80),program:text(raw.program,200),report_date,prepared_by:text(raw.prepared_by),
    applicant_name:optional("applicant_name"),project_description:optional("project_description"),community_benefit:optional("community_benefit"),implementation_plan:optional("implementation_plan"),
    requested_funding:raw.requested_funding as number??null,before_publication,blocks};
}
