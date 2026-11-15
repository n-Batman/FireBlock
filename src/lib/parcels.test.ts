import { describe,it,expect,vi,afterEach,beforeEach } from "vitest";
import { findParcels,searchGeometry } from "./parcels";
import { GET } from "@/app/api/parcels/route";

const polygon={type:"Polygon",coordinates:[[[0,0],[1,0],[1,1],[0,0]]]};
const feature={type:"Feature",geometry:polygon,properties:{apn:"012-345-678",OBJECTID:7,assessee:"Do not expose"}};
beforeEach(()=>vi.stubEnv("PARCEL_DATA_SOURCE","arcgis"));
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
describe("parcel spatial lookup",()=>{
  it("filters by the county's stored square-foot area before requesting geometry",async()=>{
    const fetcher=vi.fn<typeof fetch>().mockImplementation(async()=>Response.json({type:"FeatureCollection",features:[]}));
    await findParcels(new URLSearchParams("bbox=-120.66,35.27,-120.65,35.28&min_acres=4"),fetcher);
    expect(new URL(String(fetcher.mock.calls[0][0])).searchParams.get("where")).toBe("Shape.STArea() >= 174240");
    await findParcels(new URLSearchParams("bbox=-120.66,35.27,-120.65,35.28"),fetcher);
    expect(new URL(String(fetcher.mock.calls[1][0])).searchParams.get("where")).toBe("1=1");
  });
  it.each(["-1","NaN","Infinity","1000001","4 OR 1=1",""])("rejects invalid acreage filter %s before HTTP",async value=>{
    const fetcher=vi.fn();
    await expect(findParcels(new URLSearchParams({bbox:"-120.66,35.27,-120.65,35.28",min_acres:value}),fetcher)).rejects.toThrow(/min_acres/);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("does not apply acreage filtering to exact point lookups",async()=>{
    const fetcher=vi.fn();
    await expect(findParcels(new URLSearchParams("lat=35.28&lon=-120.65&min_acres=1"),fetcher)).rejects.toThrow(/min_acres/);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("builds enclosing point and bounded envelope queries with longitude first",()=>{
    expect(JSON.parse(searchGeometry(new URLSearchParams("lat=35.28&lon=-120.65")).geometry).x).toBe(-120.65);
    expect(searchGeometry(new URLSearchParams("lat=35.28&lon=-120.65&radius=100")).geometryType).toBe("esriGeometryEnvelope");
    expect(searchGeometry(new URLSearchParams("bbox=-120.66,35.27,-120.65,35.28")).geometryType).toBe("esriGeometryEnvelope");
  });
  it.each(["lat=&lon=0","lat=NaN&lon=0","lat=91&lon=0","lat=0&lon=0&radius=-1","bbox=-180,-85,180,85","bbox=1,0,0,1","bbox=0,0,1,1&lat=0"])("rejects invalid or excessive search %s",query=>{
    expect(()=>searchGeometry(new URLSearchParams(query))).toThrow();
  });
  it("returns only parcel identifier, WGS84 geometry and provenance",async()=>{
    const fetcher=vi.fn<typeof fetch>().mockResolvedValue(Response.json({type:"FeatureCollection",features:[feature]}));
    const result=await findParcels(new URLSearchParams("lat=35.28&lon=-120.65"),fetcher);
    const url=new URL(String(fetcher.mock.calls[0][0]));
    expect(url.searchParams.get("outSR")).toBe("4326");
    expect(url.searchParams.get("outFields")).toBe("OBJECTID,apn");
    expect(url.searchParams.get("resultRecordCount")).toBe("501");
    expect(result.features[0].properties.parcelId).toBe("012-345-678");
    expect(result.features[0].properties).not.toHaveProperty("assessee");
    expect(result.features[0].geometry).toEqual(polygon);
    expect(result.metadata.truncated).toBe(false);
  });
  it("marks incomplete results instead of implying a complete property inventory",async()=>{
    const fetcher=vi.fn<typeof fetch>().mockResolvedValue(Response.json({type:"FeatureCollection",features:Array(501).fill(feature)}));
    const result=await findParcels(new URLSearchParams("lat=0&lon=0"),fetcher);
    expect(result.features).toHaveLength(500); expect(result.metadata).toMatchObject({truncated:true,limit:500});
  });
  it("accepts a complete 500-parcel response and reports the active display mode",async()=>{
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue(Response.json({type:"FeatureCollection",features:Array(500).fill(feature)})));
    const response=await GET(new Request("http://localhost/api/parcels?lat=0&lon=0"));
    const result=await response.json();
    expect(result.features).toHaveLength(500);
    expect(result.metadata).toMatchObject({truncated:false,limit:500});
    expect(response.headers.get("X-FireBlock-Parcel-Display")).toBe("individual-parcels");
    expect(response.headers.has("X-FireBlock-Parcel-Threshold")).toBe(false);
  });
  it("preserves holes and multipart geometry",async()=>{
    const geometry={type:"MultiPolygon",coordinates:[polygon.coordinates,polygon.coordinates]};
    const fetcher=vi.fn<typeof fetch>().mockResolvedValue(Response.json({type:"FeatureCollection",features:[{...feature,geometry}]}));
    expect((await findParcels(new URLSearchParams("lat=0&lon=0"),fetcher)).features[0].geometry).toEqual(geometry);
  });
  it("rejects broken geometry and HTTP-200 ArcGIS errors",async()=>{
    for(const payload of [{error:{message:"private diagnostic"}},{type:"FeatureCollection",features:[{...feature,geometry:{type:"Point",coordinates:[0,0]}}]}]){
      const fetcher=vi.fn<typeof fetch>().mockResolvedValue(Response.json(payload));
      await expect(findParcels(new URLSearchParams("lat=0&lon=0"),fetcher)).rejects.toThrow();
    }
  });
  it("API rejects malformed input before contacting the provider",async()=>{
    const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);
    const response=await GET(new Request("http://localhost/api/parcels?lat=bad&lon=0"));
    expect(response.status).toBe(400);expect(fetcher).not.toHaveBeenCalled();
  });
});
