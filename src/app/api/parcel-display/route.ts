import {findParcels} from "@/lib/parcels";
import {projectGridToParcels} from "@/lib/parcelRisk";
import {archiveParcelDisplay,cloudRiskMosaic} from "@/lib/cloudStorage";
import {riskBounds} from "@/lib/riskMosaic";
export const runtime="nodejs";
export async function POST(request:Request){
  // Same-origin writes: a third-party page must not create cloud objects.
  if(request.headers.get("origin")!==new URL(request.url).origin)return Response.json({error:"Same-origin request required"},{status:403});
  const host=new URL(request.url).hostname;
  const token=process.env.CLOUD_WRITE_TOKEN;
  if(!["localhost","127.0.0.1","[::1]"].includes(host) && (!token||request.headers.get("authorization")!==`Bearer ${token}`))
    return Response.json({error:"Authenticated cloud writes required outside the local control panel"},{status:401});
  if(process.env.PARCEL_CLOUD_CACHE_ALLOWED!=="true")return Response.json({error:"Enable licensed parcel caching on the server before archiving"},{status:503});
  try{
    const query=new URL(request.url).searchParams;
    const parcels=await findParcels(query);
    const points=parcels.features.flatMap(p=>p.geometry.type==="Polygon"?p.geometry.coordinates.flat():p.geometry.coordinates.flat(2));
    if(!points.length)throw new Error("No parcels found");
    const bounds=riskBounds([Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1])),Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))]);
    const {grid,...source}=await cloudRiskMosaic(undefined,bounds);
    const projection=projectGridToParcels(parcels,grid);
    const receipt=await archiveParcelDisplay(parcels,projection,{...source,parcel_source:parcels.metadata});
    return Response.json({projection,receipt},{headers:{"Cache-Control":"no-store"}});
  }catch{return Response.json({error:"Cloud archive failed; no completed parcel manifest is guaranteed"},{status:502});}
}
