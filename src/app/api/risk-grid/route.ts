import { cloudRiskGrid } from "@/lib/cloudStorage";
import { publishedRiskGrid } from "@/lib/publishedRiskGrid";
export const runtime="nodejs";
export async function GET(){
  const configured=[process.env.B2_APPLICATION_KEY_ID,process.env.B2_APPLICATION_KEY,process.env.B2_BUCKET_NAME];
  if(configured.every(value=>!value)){
    try{return Response.json(await publishedRiskGrid(),{headers:{"Cache-Control":"no-store","X-FireBlock-Source":"published-snapshot"}});}
    catch{return Response.json({error:"Published risk snapshot is unavailable"},{status:503});}
  }
  if(configured.some(value=>!value))return Response.json({error:"Complete the server-side cloud storage configuration"},{status:503});
  try{
    const {grid}=await cloudRiskGrid();
    return Response.json(grid,{headers:{"Cache-Control":"no-store"}});
  }catch{return Response.json({error:"Cloud risk grid is unavailable or invalid"},{status:502});}
}
