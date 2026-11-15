/** Backend-only scan history. Parcel boundaries are used for matching, never archived. */
import {createHash,randomUUID} from "node:crypto";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import {point} from "@turf/helpers";
import {CloudStorage} from "./cloudStorage";
import {DEFAULT_PARCEL_LAYER,findParcels} from "./parcels";

export class ScanArchiveError extends Error {
  constructor(message:string,public status=400){super(message);}
}
type Location={lat:number;lon:number;accuracy_m?:number};
type ScanFinding={label:string;severity:"risk"|"clear";action:string};
type Observation={location:Location;scanned_at:string;score:number;model_id:string;findings:ScanFinding[];baseline_id:string|null};
type Parcel={id:string;source:string;matched_at:string};
type Comparison={baseline_score:number;improvement_points:number;outcome:"improved"|"unchanged"|"worsened";distance_m:number};
export type ArchivedParcelScan=Observation&{kind:"fireblock.parcel-scan";schema_version:1;scan_id:string;
  recorded_at:string;metric:"dry-fuel-percent-v1";parcel:Parcel;comparison:Comparison|null};
type Storage=Pick<CloudStorage,"uploadJson"|"readVersion"|"listPage">;
const ID=/^\d{13}-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const finite=(value:unknown):value is number=>typeof value==="number"&&Number.isFinite(value);
function object(value:unknown):Record<string,unknown>{
  if(!value||typeof value!=="object"||Array.isArray(value))throw new ScanArchiveError("Send a JSON object");
  return value as Record<string,unknown>;
}
function only(value:Record<string,unknown>,keys:string[]){
  if(Object.keys(value).some(key=>!keys.includes(key)))throw new ScanArchiveError("Unexpected scan fields");
}
function text(value:unknown,limit:number){
  if(typeof value!=="string"||!value.trim()||value.length>limit||/[\u0000-\u001f]/.test(value))throw new ScanArchiveError("Invalid scan text");
  return value.trim();
}
function iso(value:unknown){
  if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)||!Number.isFinite(Date.parse(value)))throw new ScanArchiveError("Use a timezone-aware scan timestamp");
  const [year,month,day]=value.slice(0,10).split("-").map(Number),date=new Date(Date.UTC(year,month-1,day));
  if(date.getUTCFullYear()!==year||date.getUTCMonth()!==month-1||date.getUTCDate()!==day)throw new ScanArchiveError("Invalid scan date");
  return new Date(value).toISOString();
}
function observation(value:unknown,now:Date):Observation {
  const raw=object(value);
  only(raw,["location","scanned_at","score","model_id","findings","baseline_id"]);
  const location=object(raw.location);only(location,["lat","lon","accuracy_m"]);
  if(!finite(location.lat)||!finite(location.lon)||Math.abs(location.lat)>85||Math.abs(location.lon)>180||
      (location.accuracy_m!==undefined&&(!finite(location.accuracy_m)||location.accuracy_m<0||location.accuracy_m>100)))throw new ScanArchiveError("Provide valid GPS coordinates and accuracy within 100 metres");
  if(!finite(raw.score)||raw.score<0||raw.score>100)throw new ScanArchiveError("score must be a dry-fuel percentage from 0 to 100");
  const model_id=text(raw.model_id,100);
  if(!/^[A-Za-z0-9_.:-]+$/.test(model_id))throw new ScanArchiveError("Invalid scoring method version");
  const scanned_at=iso(raw.scanned_at);
  if(Date.parse(scanned_at)>now.getTime()+5*60_000)throw new ScanArchiveError("Scan time is in the future");
  const baseline_id=raw.baseline_id??null;
  if(baseline_id!==null&&(typeof baseline_id!=="string"||!ID.test(baseline_id)))throw new ScanArchiveError("Invalid baseline_id");
  const findings=raw.findings??[];
  if(!Array.isArray(findings)||findings.length>20)throw new ScanArchiveError("Include at most 20 findings");
  return {location:{lat:location.lat,lon:location.lon,...(location.accuracy_m!==undefined?{accuracy_m:location.accuracy_m as number}:{})},
    scanned_at,score:raw.score,model_id,baseline_id,findings:findings.map(value=>{
      const finding=object(value);only(finding,["label","severity","action"]);
      if(finding.severity!=="risk"&&finding.severity!=="clear")throw new ScanArchiveError("Invalid finding severity");
      return {label:text(finding.label,120),severity:finding.severity,action:text(finding.action,500)};
    })};
}
function prefix(id:string,source:string){
  return `parcel-scans/v1/${createHash("sha256").update(JSON.stringify([source,id])).digest("hex")}/`;
}
function distance(a:Location,b:Location){
  const radians=Math.PI/180,dlat=(b.lat-a.lat)*radians,dlon=(b.lon-a.lon)*radians;
  const h=Math.sin(dlat/2)**2+Math.cos(a.lat*radians)*Math.cos(b.lat*radians)*Math.sin(dlon/2)**2;
  return 6371000*2*Math.asin(Math.sqrt(Math.min(1,h)));
}
function stored(value:unknown,parcel:Pick<Parcel,"id"|"source">,id:string,now:Date):ArchivedParcelScan {
  try {
    const scan=value as ArchivedParcelScan;
    if(scan?.kind!=="fireblock.parcel-scan"||scan.schema_version!==1||scan.scan_id!==id||!ID.test(id)||
        scan.metric!=="dry-fuel-percent-v1"||scan.parcel?.id!==parcel.id||scan.parcel?.source!==parcel.source)throw new Error();
    const clean=observation({location:scan.location,scanned_at:scan.scanned_at,score:scan.score,model_id:scan.model_id,
      findings:scan.findings,baseline_id:scan.baseline_id},now);
    const recorded_at=iso(scan.recorded_at),matched_at=iso(scan.parcel.matched_at);
    if(!scan.baseline_id&&scan.comparison!==null)throw new Error();
    if(scan.baseline_id){
      const c=scan.comparison;
      if(!c||!finite(c.baseline_score)||c.baseline_score<0||c.baseline_score>100||
          c.improvement_points!==c.baseline_score-scan.score||!finite(c.distance_m)||c.distance_m<0||c.distance_m>25||
          c.outcome!==(c.improvement_points>0?"improved":c.improvement_points<0?"worsened":"unchanged"))throw new Error();
    }
    return {...clean,kind:"fireblock.parcel-scan",schema_version:1,scan_id:id,recorded_at,
      metric:"dry-fuel-percent-v1",parcel:{...parcel,matched_at},comparison:scan.comparison?{
        baseline_score:scan.comparison.baseline_score,improvement_points:scan.comparison.improvement_points,
        outcome:scan.comparison.outcome,distance_m:scan.comparison.distance_m}:null};
  }catch{throw new Error("Invalid cloud scan record");}
}

export class ParcelScanArchive {
  constructor(private storage:Storage=new CloudStorage(),private lookup:typeof findParcels=findParcels,
    private clock:()=>Date=()=>new Date()){}
  private async read(parcel:Pick<Parcel,"id"|"source">,id:string){
    const key=prefix(parcel.id,parcel.source)+id+".json";
    const page=await this.storage.listPage(key,undefined,1);
    const file=page.files.find(file=>file.fileName===key);
    if(!file)throw new ScanArchiveError("Baseline scan not found for this parcel",404);
    return stored((await this.storage.readVersion(file.fileId,64*1024)).value,parcel,id,this.clock());
  }
  async save(value:unknown){
    const now=this.clock(),scan=observation(value,now);
    const parcels=await this.lookup(new URLSearchParams({lat:String(scan.location.lat),lon:String(scan.location.lon),radius:"0"}));
    if(parcels.metadata.truncated)throw new Error("Incomplete parcel lookup");
    const matches=parcels.features.filter(parcel=>booleanPointInPolygon(point([scan.location.lon,scan.location.lat]),parcel));
    if(!matches.length)throw new ScanArchiveError("No land parcel contains this scan location",422);
    if(matches.length!==1)throw new ScanArchiveError("Scan location matches multiple parcels; use a point inside one parcel",409);
    const match=matches[0].properties;
    if(!match.parcelId||match.parcelId==="Unknown")throw new Error("Parcel has no stable APN");
    const parcel={id:text(match.parcelId,128),source:match.source,matched_at:iso(match.fetchedAt)};
    let comparison:Comparison|null=null;
    if(scan.baseline_id){
      const baseline=await this.read(parcel,scan.baseline_id);
      if(baseline.baseline_id)throw new ScanArchiveError("Reference the original baseline scan",409);
      if(baseline.model_id!==scan.model_id)throw new ScanArchiveError("Baseline and follow-up must use the same scoring method version",409);
      if(Date.parse(scan.scanned_at)<=Date.parse(baseline.scanned_at))throw new ScanArchiveError("Follow-up must be captured after its baseline",409);
      const distance_m=distance(baseline.location,scan.location);
      if(distance_m>25)throw new ScanArchiveError("Follow-up must be within 25 metres of the baseline location",409);
      const improvement_points=baseline.score-scan.score;
      comparison={baseline_score:baseline.score,improvement_points,distance_m,
        outcome:improvement_points>0?"improved":improvement_points<0?"worsened":"unchanged"};
    }
    // Independent immutable objects avoid shared parcel-index updates and lost concurrent scans.
    const scan_id=`${now.getTime()}-${randomUUID()}`;
    const record:ArchivedParcelScan={...scan,kind:"fireblock.parcel-scan",schema_version:1,scan_id,
      recorded_at:now.toISOString(),metric:"dry-fuel-percent-v1",parcel,comparison};
    const receipt=await this.storage.uploadJson(prefix(parcel.id,parcel.source)+scan_id+".json",record);
    return {scan:record,receipt};
  }
  async history(parcelId:string,cursor?:string,limit=50){
    const id=text(parcelId,128),source=process.env.PARCEL_LAYER_URL||DEFAULT_PARCEL_LAYER;
    const parcel={id,source},key=prefix(id,source);
    if(!Number.isInteger(limit)||limit<1||limit>100)throw new ScanArchiveError("limit must be 1..100");
    if(cursor!==undefined&&(!cursor.startsWith(key)||!ID.test(cursor.slice(key.length,-5))||!cursor.endsWith(".json")))throw new ScanArchiveError("Invalid parcel history cursor");
    const page=await this.storage.listPage(key,cursor,limit),scans:ArchivedParcelScan[]=[];
    for(let offset=0;offset<page.files.length;offset+=4){
      scans.push(...await Promise.all(page.files.slice(offset,offset+4).map(async file=>{
        const scanId=file.fileName.slice(key.length,-5);
        if(!file.fileName.startsWith(key)||!file.fileName.endsWith(".json")||!ID.test(scanId))throw new Error("Invalid scan archive key");
        return stored((await this.storage.readVersion(file.fileId,64*1024)).value,parcel,scanId,this.clock());
      })));
    }
    return {parcel,scans,next_cursor:page.nextFileName};
  }
}
