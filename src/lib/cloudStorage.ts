/** Server-only B2 adapter. No durable datasets or tokens are written to disk. */
import {createHash,randomUUID} from "node:crypto";
import type {RiskGrid} from "./parcelRisk";
import {parseRiskGrid} from "./parcelRisk";

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
  async uploadJson(key:string,value:unknown){
    const bytes=Buffer.from(JSON.stringify(value));
    if(bytes.length>25*1024*1024)throw new Error("Cloud JSON exceeds 25 MiB");
    const hash=createHash("sha1").update(bytes).digest("hex");
    const destination=await this.api("b2_get_upload_url",{bucketId:await this.bucket()});
    const result=await this.json(destination.uploadUrl,{method:"POST",headers:{Authorization:destination.authorizationToken,
      "X-Bz-File-Name":encodeURIComponent(key),"X-Bz-Content-Sha1":hash,"Content-Type":"application/json"},body:bytes});
    if(result.contentSha1!==hash||result.contentLength!==bytes.length||!result.fileId)throw new Error("Cloud upload verification failed");
    return {key,file_id:String(result.fileId),bytes:bytes.length,sha256:createHash("sha256").update(bytes).digest("hex")};
  }
  async readVersion(fileId:string){
    const info=await this.api("b2_get_file_info",{fileId});
    if(!Number.isSafeInteger(info.contentLength)||info.contentLength<0||info.contentLength>25*1024*1024||!/^[0-9a-f]{40}$/.test(info.contentSha1))throw new Error("Invalid cloud object metadata");
    const a=await this.authorize();
    const response=await this.request(`${a.apiInfo.storageApi.downloadUrl}/b2api/v4/b2_download_file_by_id?fileId=${encodeURIComponent(fileId)}`,{
      headers:{Authorization:a.authorizationToken},redirect:"error",signal:AbortSignal.timeout(30000)});
    if(!response.ok||!response.body)throw new Error("Cloud object download failed");
    const reader=response.body.getReader(),chunks:Buffer[]=[];let size=0;
    for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>info.contentLength){await reader.cancel();throw new Error("Cloud object size mismatch");}chunks.push(Buffer.from(value));}
    const bytes=Buffer.concat(chunks);
    if(bytes.length!==info.contentLength||createHash("sha1").update(bytes).digest("hex")!==info.contentSha1)throw new Error("Cloud object checksum mismatch");
    return {value:JSON.parse(bytes.toString("utf8")),bytes};
  }
  async readKey(key:string){
    const result=await this.api("b2_list_file_names",{bucketId:await this.bucket(),prefix:key,maxFileCount:1});
    const file=result.files?.find((f:{fileName:string})=>f.fileName===key);
    if(!file?.fileId)throw new Error("No completed risk publication is available");
    return this.readVersion(file.fileId);
  }
}

export async function cloudRiskGrid(storage=new CloudStorage()):Promise<{grid:RiskGrid;manifest_file_id:string;grid_file_id:string}>{
  let manifestId=process.env.B2_RISK_MANIFEST_FILE_ID;
  let pointer:{manifest_sha256:string;manifest_bytes:number}|null=null;
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
