import { findParcels, ParcelError } from "@/lib/parcels";
import {PARCEL_DISPLAY_MODE} from "@/lib/parcelDisplayConfig";
export const runtime="nodejs";
const headers={"Cache-Control":"private, no-store","X-FireBlock-Parcel-Display":PARCEL_DISPLAY_MODE};
export async function GET(request:Request) {
  try {
    const parcels=await findParcels(new URL(request.url).searchParams);
    return Response.json(parcels,{headers:{...headers,"X-FireBlock-Parcel-Source":parcels.metadata.dataSource??"arcgis"}});
  } catch(error) {
    const known=error instanceof ParcelError;
    return Response.json({error:known?error.message:"Parcel lookup failed; try a smaller area or retry later"},{status:known?error.status:502,headers});
  }
}
