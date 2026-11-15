import { findParcels, ParcelError } from "@/lib/parcels";
import {PARCEL_DISPLAY_MODE} from "@/lib/parcelDisplayConfig";
const headers={"Cache-Control":"private, no-store","X-FireBlock-Parcel-Display":PARCEL_DISPLAY_MODE};
export async function GET(request:Request) {
  try {
    return Response.json(await findParcels(new URL(request.url).searchParams),{headers});
  } catch(error) {
    const known=error instanceof ParcelError;
    return Response.json({error:known?error.message:"Parcel lookup failed; try a smaller area or retry later"},{status:known?error.status:502,headers});
  }
}
