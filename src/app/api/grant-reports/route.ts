import {createHash,timingSafeEqual} from "node:crypto";
import {GrantReports} from "@/lib/grantReports";
import {GrantReportError} from "@/lib/grantReportData";
import {ScanArchiveError} from "@/lib/parcelScanArchive";

export const runtime="nodejs";
export const maxDuration=300;
const headers={"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"};
function authorize(request:Request){
  const token=process.env.CLOUD_WRITE_TOKEN;
  if(!token)return Response.json({error:"Configure private report access on the server"},{status:503,headers});
  const actual=createHash("sha256").update(request.headers.get("authorization")||"").digest();
  const expected=createHash("sha256").update(`Bearer ${token}`).digest();
  if(!timingSafeEqual(actual,expected))return Response.json({error:"Authenticated report access required"},{status:401,headers});
}
async function body(request:Request){
  const reader=request.body?.getReader();if(!reader)throw new GrantReportError("Send a JSON body");
  const chunks:Uint8Array[]=[];let size=0;
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
    if(size>12*1024*1024){await reader.cancel();throw new GrantReportError("Report request exceeds 12 MiB",413);}chunks.push(value);}
  try{return JSON.parse(Buffer.concat(chunks).toString("utf8"));}catch{throw new GrantReportError("Send valid JSON");}
}
function failure(error:unknown){
  if(error instanceof GrantReportError||error instanceof ScanArchiveError)return Response.json({error:error.message},{status:error.status,headers});
  return Response.json({error:"Grant report generation or cloud storage unavailable"},{status:502,headers});
}
/** Backend callers only: the browser never receives the OpenAI/B2 keys or write token. */
export async function POST(request:Request){
  const denied=authorize(request);if(denied)return denied;
  try{return Response.json(await new GrantReports().create(await body(request)),{status:201,headers});}
  catch(error){return failure(error);}
}
export async function GET(request:Request){
  const denied=authorize(request);if(denied)return denied;
  try{
    const id=new URL(request.url).searchParams.get("report_id");if(!id)throw new GrantReportError("Provide report_id");
    const bytes=await new GrantReports().download(id);
    return new Response(new Uint8Array(bytes),{headers:{...headers,"Content-Type":"application/pdf","Content-Disposition":`attachment; filename="fireblock-grant-${id}.pdf"`}});
  }catch(error){return failure(error);}
}
