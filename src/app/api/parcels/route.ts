import { findParcels, ParcelError } from "@/lib/parcels";
export async function GET(request:Request) {
  try {
    return Response.json(await findParcels(new URL(request.url).searchParams),{headers:{"Cache-Control":"private, no-store"}});
  } catch(error) {
    const known=error instanceof ParcelError;
    return Response.json({error:known?error.message:"Parcel lookup failed; try a smaller area or retry later"},{status:known?error.status:502,headers:{"Cache-Control":"private, no-store"}});
  }
}
