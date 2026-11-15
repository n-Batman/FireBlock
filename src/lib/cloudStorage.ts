/** Server-only B2 adapter. No durable datasets or tokens are written to disk. */
import {createHash,randomUUID} from "node:crypto";
import type {RiskGrid} from "./parcelRisk";
import {parseRiskGrid} from "./parcelRisk";
import {mergeRiskGrids,intersects,riskBounds,type RiskBounds} from "./riskMosaic";

type Authorization={authorizationToken:string;apiInfo:{storageApi:{apiUrl:string;downloadUrl:string;allowed?:{buckets?:{id:string;name:string}[]}}};accountId:string};
export class CloudStorage {
  private auth:Authorization|null=null;
  constructor(private request:typeof fetch=fetch){}
  private async json(url:string,init:RequestInit={}){
    const response=await this.request(url,{...init,redirect:"error",signal:AbortSignal.timeout(30000)});
    if(!response.ok)throw new Error(`Cloud storage HTTP ${response.status}`);
    return response.json();
  }
  private async authorize(){
    if(this.auth)return this.auth;
    const id=process.env.B2_APPLICATION_KEY_ID,key=process.env.B2_APPLICATION_KEY;
    if(!id||!key)throw new Error("Configure B2 credentials on the server");
    this.auth=await this.json("https://api.backblazeb2.com/b2api/v4/b2_authorize_account",{headers:{Authorization:`Basic ${Buffer.from(`${id}:${key}`).toString("base64")}`}}) as Authorization;
    return this.auth;
  }
  private async api(operation:string,body:unknown){
    const a=await this.authorize();
    return this.json(`${a.apiInfo.storageApi.apiUrl}/b2api/v4/${operation}`,{method:"POST",headers:{Authorization:a.authorizationToken,"Content-Type":"application/json"},body:JSON.stringify(body)});
  }
  private async bucket(){
    const a=await this.authorize(),name=process.env.B2_BUCKET_NAME;
    if(!name)throw new Error("Configure B2_BUCKET_NAME");
    const allowed=a.apiInfo.storageApi.allowed?.buckets?.find(b=>b.name===name);
    if(allowed)return allowed.id;
    const result=await this.api("b2_list_buckets",{accountId:a.accountId,bucketName:name});
    const bucket=result.buckets?.find((b:{bucketName:string})=>b.bucketName===name);
    if(!bucket)throw new Error("Configured cloud bucket unavailable");return bucket.bucketId as string;
  }
  /** Private API access is insufficient if the underlying bucket is public. */
  async requirePrivateBucket(){
    const a=await this.authorize(),id=await this.bucket();
    const result=await this.api("b2_list_buckets",{accountId:a.accountId,bucketName:process.env.B2_BUCKET_NAME});
    if(result.buckets?.find((b:{bucketId:string})=>b.bucketId===id)?.bucketType!=="allPrivate")throw new Error("Grant reports require a private B2 bucket");
  }
  async uploadJson(key:string,value:unknown){
    const bytes=Buffer.from(JSON.stringify(value));
    if(bytes.length>25*1024*1024)throw new Error("Cloud JSON exceeds 25 MiB");
    return this.uploadBytes(key,bytes,"application/json");
  }
  /** Private report/media objects use the same checksum-verified upload path. */
  async uploadBytes(key:string,bytes:Buffer,contentType:string){
    if(!bytes.length||bytes.length>25*1024*1024)throw new Error("Cloud object must be 1 byte to 25 MiB");
    if(!["application/json","application/pdf","image/jpeg","image/png"].includes(contentType))throw new Error("Unsupported cloud content type");
    const hash=createHash("sha1").update(bytes).digest("hex");
    const destination=await this.api("b2_get_upload_url",{bucketId:await this.bucket()});
    const result=await this.json(destination.uploadUrl,{method:"POST",headers:{Authorization:destination.authorizationToken,
      "X-Bz-File-Name":encodeURIComponent(key),"X-Bz-Content-Sha1":hash,"Content-Type":contentType},body:new Uint8Array(bytes)});
    if(result.contentSha1!==hash||result.contentLength!==bytes.length||!result.fileId)throw new Error("Cloud upload verification failed");
    return {key,file_id:String(result.fileId),bytes:bytes.length,sha256:createHash("sha256").update(bytes).digest("hex")};
  }
  async readVersion(fileId:string,maxBytes=25*1024*1024){
    const result=await this.readBytes(fileId,maxBytes);
    return {value:JSON.parse(result.bytes.toString("utf8")),bytes:result.bytes};
  }
  async readBytes(fileId:string,maxBytes=25*1024*1024){
    if(!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>25*1024*1024)throw new Error("Invalid cloud object size limit");
    const info=await this.api("b2_get_file_info",{fileId});
    if(!Number.isSafeInteger(info.contentLength)||info.contentLength<0||info.contentLength>maxBytes||!/^[0-9a-f]{40}$/.test(info.contentSha1))throw new Error("Invalid cloud object metadata");
    const a=await this.authorize();
    const response=await this.request(`${a.apiInfo.storageApi.downloadUrl}/b2api/v4/b2_download_file_by_id?fileId=${encodeURIComponent(fileId)}`,{
      headers:{Authorization:a.authorizationToken},redirect:"error",signal:AbortSignal.timeout(30000)});
    if(!response.ok||!response.body)throw new Error("Cloud object download failed");
    const reader=response.body.getReader(),chunks:Buffer[]=[];let size=0;
    for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>info.contentLength){await reader.cancel();throw new Error("Cloud object size mismatch");}chunks.push(Buffer.from(value));}
    const bytes=Buffer.concat(chunks);
    if(bytes.length!==info.contentLength||createHash("sha1").update(bytes).digest("hex")!==info.contentSha1)throw new Error("Cloud object checksum mismatch");
    return {bytes};
  }
  async readKey(key:string){
    const result=await this.api("b2_list_file_names",{bucketId:await this.bucket(),prefix:key,maxFileCount:1});
    const file=result.files?.find((f:{fileName:string})=>f.fileName===key);
    if(!file?.fileId)throw new Error("No completed risk publication is available");
    return this.readVersion(file.fileId);
  }
  async listKeys(prefix:string){
    const bucketId=await this.bucket();
    const files:{fileName:string;fileId:string}[]=[];
    let startFileName:string|undefined;
    do {
      const result=await this.api("b2_list_file_names",{bucketId,prefix,maxFileCount:100,...(startFileName?{startFileName}:{})});
      if(!Array.isArray(result.files))throw new Error("Invalid cloud catalog listing");
      for(const file of result.files){
        if(typeof file.fileName!=="string"||!file.fileName.startsWith(prefix)||typeof file.fileId!=="string")throw new Error("Invalid cloud catalog entry");
        files.push(file);
      }
      if(files.length>500)throw new Error("Risk catalog exceeds 500 publications; partition the catalog");
      if(result.nextFileName===startFileName&&startFileName)throw new Error("Cloud catalog pagination stalled");
      startFileName=result.nextFileName||undefined;
    }while(startFileName);
    return files;
  }
  /** Bounded page for growing per-parcel archives; cursors stay within their prefix. */
  async listPage(prefix:string,startFileName?:string,limit=50){
    if(!prefix||prefix.length>1024||!Number.isInteger(limit)||limit<1||limit>100||
        (startFileName!==undefined&&(!startFileName.startsWith(prefix)||startFileName.length>1024)))throw new Error("Invalid cloud page request");
    const result=await this.api("b2_list_file_names",{bucketId:await this.bucket(),prefix,maxFileCount:limit,...(startFileName?{startFileName}:{})});
    if(!Array.isArray(result.files)||result.files.length>limit)throw new Error("Invalid cloud page");
    const files:{fileName:string;fileId:string}[]=result.files;
    if(files.some((file,i)=>typeof file.fileName!=="string"||!file.fileName.startsWith(prefix)||
        typeof file.fileId!=="string"||!file.fileId||
        (startFileName!==undefined&&file.fileName<startFileName)||(i>0&&file.fileName<=files[i-1].fileName)))throw new Error("Invalid cloud page entry");
    const nextFileName=result.nextFileName??null;
    if(nextFileName!==null&&(typeof nextFileName!=="string"||!nextFileName.startsWith(prefix)||
        !files.length||nextFileName<=files[files.length-1].fileName))throw new Error("Invalid cloud page cursor");
    return {files,nextFileName:nextFileName as string|null};
  }
}

export async function cloudRiskGrid(storage=new CloudStorage(),publication?:RiskPointer):Promise<{grid:RiskGrid;manifest_file_id:string;grid_file_id:string}>{
  let manifestId=publication?.manifest_file_id||process.env.B2_RISK_MANIFEST_FILE_ID;
  let pointer:RiskPointer|null=publication||null;
  if(!manifestId){
    const {value}=await storage.readKey(process.env.B2_RISK_POINTER_KEY||"risk/latest.json");
    if(value.kind!=="fireblock.risk-pointer"||value.schema_version!==1||typeof value.manifest_file_id!=="string"||
      !/^[0-9a-f]{64}$/.test(value.manifest_sha256)||!Number.isSafeInteger(value.manifest_bytes)||value.manifest_bytes<0)throw new Error("Invalid risk publication pointer");
    manifestId=value.manifest_file_id;pointer=value;
  }
  const {value:manifest,bytes:manifestBytes}=await storage.readVersion(manifestId!);
  if(pointer&&(manifestBytes.length!==pointer.manifest_bytes||createHash("sha256").update(manifestBytes).digest("hex")!==pointer.manifest_sha256))throw new Error("Publication pointer does not match its analysis manifest");
  if(manifest.status!=="complete"||!Array.isArray(manifest.artifacts))throw new Error("Cloud analysis is incomplete");
  const artifact=manifest.artifacts.find((a:{path:string})=>a.path==="risk/risk_map.geojson");
  if(!artifact?.storage?.file_id)throw new Error("Completed cloud run has no risk grid");
  const {value,bytes}=await storage.readVersion(artifact.storage.file_id);
  if(bytes.length!==artifact.bytes||createHash("sha256").update(bytes).digest("hex")!==artifact.sha256)throw new Error("Risk grid does not match its manifest");
  return {grid:parseRiskGrid(value),manifest_file_id:manifestId!,grid_file_id:artifact.storage.file_id};
}
type RiskPointer={kind:string;schema_version:number;manifest_file_id:string;manifest_sha256:string;manifest_bytes:number;bbox?:RiskBounds};
function validatePointer(value:RiskPointer){
  if(value?.kind!=="fireblock.risk-pointer"||value.schema_version!==1||typeof value.manifest_file_id!=="string"||!value.manifest_file_id||!/^[0-9a-f]{64}$/.test(value.manifest_sha256)||!Number.isSafeInteger(value.manifest_bytes)||value.manifest_bytes<0)throw new Error("Invalid risk catalog publication");
  riskBounds(value.bbox);
  return value;
}
// Immutable versions are cached only in bounded process memory. Listings remain
// fresh on every request, so a new publication is discovered without a deploy.
const versionCache=new Map<string,{value:unknown;size:number}>();
const pendingVersions=new Map<string,Promise<unknown>>();
let cachedBytes=0;
async function cached<T>(id:string,load:()=>Promise<{value:T;size:number}>):Promise<T>{
  const hit=versionCache.get(id);
  if(hit){versionCache.delete(id);versionCache.set(id,hit);return hit.value as T;}
  const pending=pendingVersions.get(id);
  if(pending)return pending as Promise<T>;
  const request=(async()=>{
    const result=await load();
    if(result.size<=32*1024*1024){
      while(versionCache.size&&(cachedBytes+result.size>32*1024*1024||versionCache.size>=500)){
        const key=versionCache.keys().next().value!;cachedBytes-=versionCache.get(key)!.size;versionCache.delete(key);
      }
      versionCache.set(id,result);cachedBytes+=result.size;
    }
    return result.value;
  })();
  pendingVersions.set(id,request);
  try{return await request;}finally{pendingVersions.delete(id);}
}
export async function cloudRiskMosaic(storage=new CloudStorage(),bbox?:RiskBounds){
  const files=await storage.listKeys("risk/catalog/");
  if(!files.length){const result=await cloudRiskGrid(storage);return {...result,grid:mergeRiskGrids([{id:result.manifest_file_id,grid:result.grid}],bbox)};}
  const publications:{id:string;grid:RiskGrid}[]=[],sources:string[]=[];
  // Limit simultaneous cloud requests, even for large catalogs.
  for(let offset=0;offset<files.length;offset+=4){
    const batch=await Promise.all(files.slice(offset,offset+4).map(async file=>{
      const pointer=await cached(`pointer:${file.fileId}`,async()=>{
        const result=await storage.readVersion(file.fileId);return {value:validatePointer(result.value),size:result.bytes.length};
      });
      if(bbox&&!intersects(pointer.bbox!,bbox))return null;
      const result=await cached(`grid:${pointer.manifest_file_id}:${pointer.manifest_sha256}`,async()=>{
        const value=await cloudRiskGrid(storage,pointer);return {value,size:Buffer.byteLength(JSON.stringify(value))};
      });
      return {id:result.manifest_file_id,grid:result.grid};
    }));
    for(const item of batch)if(item&&!sources.includes(item.id)){publications.push(item);sources.push(item.id);}
  }
  return {grid:{...mergeRiskGrids(publications,bbox),publication:{source:"cloud-catalog",runs:sources}},manifest_file_ids:sources};
}
export async function archiveParcelDisplay(parcels:unknown,projection:unknown,source:unknown,storage=new CloudStorage()){
  if(process.env.PARCEL_CLOUD_CACHE_ALLOWED!=="true")throw new Error("Parcel cloud storage requires provider license approval: PARCEL_CLOUD_CACHE_ALLOWED=true");
  const prefix=`parcel-displays/${randomUUID()}`;
  const boundaries=await storage.uploadJson(`${prefix}/boundaries.geojson`,parcels);
  const summary=await storage.uploadJson(`${prefix}/risk.geojson`,projection);
  const manifest={schema_version:1,kind:"fireblock.parcel-display",status:"complete",created_at:new Date().toISOString(),source,
    boundaries,projection:summary};
  const receipt=await storage.uploadJson(`${prefix}/manifest.json`,manifest);
  return {manifest_file_id:receipt.file_id,manifest_key:receipt.key};
}
