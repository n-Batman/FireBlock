import { cloudRiskGrid } from "@/lib/cloudStorage";
export const runtime="nodejs";
export async function GET(){
  if(!process.env.B2_APPLICATION_KEY_ID)return Response.json({error:"Configure server-side cloud storage credentials"},{status:503});
  try{
    const {grid}=await cloudRiskGrid();
    return Response.json(grid,{headers:{"Cache-Control":"no-store"}});
  }catch{return Response.json({error:"Cloud risk grid is unavailable or invalid"},{status:502});}
}
