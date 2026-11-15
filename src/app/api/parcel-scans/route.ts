import {createHash,timingSafeEqual} from "node:crypto";
import {ParcelScanArchive,ScanArchiveError} from "@/lib/parcelScanArchive";

export const runtime="nodejs";
const headers={"Cache-Control":"private, no-store"};
function authorize(request:Request){
  const token=process.env.CLOUD_WRITE_TOKEN;
  if(!token)return Response.json({error:"Configure authenticated scan archive access on the server"},{status:503,headers});
  const actual=createHash("sha256").update(request.headers.get("authorization")||"").digest();
  const expected=createHash("sha256").update(`Bearer ${token}`).digest();
  if(!timingSafeEqual(actual,expected))return Response.json({error:"Authenticated scan archive access required"},{status:401,headers});
}
async function body(request:Request){
  const limit=32*1024,reader=request.body?.getReader();
  if(!reader)throw new ScanArchiveError("Send a JSON body");
  const chunks:Uint8Array[]=[];let size=0;
  for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;
    if(size>limit){await reader.cancel();throw new ScanArchiveError("Scan payload exceeds 32 KiB",413);}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  try{return JSON.parse(new TextDecoder().decode(bytes));}catch{throw new ScanArchiveError("Send valid JSON");}
}
function failure(error:unknown){
  if(error instanceof ScanArchiveError)return Response.json({error:error.message},{status:error.status,headers});
  return Response.json({error:"Parcel scan archive unavailable"},{status:502,headers});
}
/** Trusted backend callers only. The frontend scanner does not call this endpoint. */
export async function POST(request:Request){
  const denied=authorize(request);if(denied)return denied;
  try{return Response.json(await new ParcelScanArchive().save(await body(request)),{status:201,headers});}
  catch(error){return failure(error);}
}
export async function GET(request:Request){
  const denied=authorize(request);if(denied)return denied;
  try{
    const query=new URL(request.url).searchParams;
    if(!query.get("parcel_id"))throw new ScanArchiveError("Provide parcel_id");
    const result=await new ParcelScanArchive().history(query.get("parcel_id")!,query.get("cursor")??undefined,Number(query.get("limit")??50));
    return Response.json(result,{headers});
  }catch(error){return failure(error);}
}
