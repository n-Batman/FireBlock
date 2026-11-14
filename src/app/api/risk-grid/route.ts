import { cloudRiskMosaic } from "@/lib/cloudStorage";
import { publishedRiskGrid } from "@/lib/publishedRiskGrid";
import {riskBounds,RiskLimitError,type RiskBounds} from "@/lib/riskMosaic";
export const runtime="nodejs";
export async function GET(request:Request){
  let bbox:RiskBounds|undefined;
  try{const value=new URL(request.url).searchParams.get("bbox");if(value)bbox=riskBounds(value.split(",").map(Number));}
  catch{return Response.json({error:"Provide bbox=west,south,east,north"},{status:400});}
  const configured=[process.env.B2_APPLICATION_KEY_ID,process.env.B2_APPLICATION_KEY,process.env.B2_BUCKET_NAME];
  if(configured.every(value=>!value)){
    try{return Response.json(await publishedRiskGrid(bbox),{headers:{"Cache-Control":"no-store","X-FireBlock-Source":"published-snapshot"}});}
    catch(error){return Response.json({error:error instanceof RiskLimitError?error.message:"Published risk snapshot is unavailable"},{status:error instanceof RiskLimitError?413:503});}
  }
  if(configured.some(value=>!value))return Response.json({error:"Complete the server-side cloud storage configuration"},{status:503});
  try{
    const {grid}=await cloudRiskMosaic(undefined,bbox);
    return Response.json(grid,{headers:{"Cache-Control":"no-store"}});
  }catch(error){return Response.json({error:error instanceof RiskLimitError?error.message:"Cloud risk grid is unavailable or invalid"},{status:error instanceof RiskLimitError?413:502});}
}
