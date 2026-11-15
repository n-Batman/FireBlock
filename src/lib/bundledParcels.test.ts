// @vitest-environment node
import {afterEach,describe,expect,it,vi} from "vitest";
import {ParcelSpatialIndex,type SnapshotParcel} from "./bundledParcels";
import {findParcels,DEFAULT_PARCEL_LAYER} from "./parcels";
import {GET} from "@/app/api/parcels/route";
import manifest from "@/data/parcels/manifest.json";
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
const ring=(w=0,s=0,e=.01,n=.01)=>[[w,s],[e,s],[e,n],[w,n],[w,s]];
const parcel=(id:string,rings=[ring()]):SnapshotParcel=>({type:"Feature",geometry:{type:"Polygon",coordinates:rings},properties:{parcelId:id}});
describe("backend parcel snapshot",()=>{
  it("serves the actual downloaded SLO point with no HTTP or B2 dependency",async()=>{
    vi.stubEnv("PARCEL_DATA_SOURCE","");vi.stubEnv("PARCEL_LAYER_URL","");const network=vi.fn();vi.stubGlobal("fetch",network);
    const response=await GET(new Request("https://test/api/parcels?lat=35.269972&lon=-120.655722&radius=0")),data=await response.json();
    expect(response.status).toBe(200);expect(response.headers.get("X-FireBlock-Parcel-Source")).toBe("bundled-geojson");
    expect(data.features.length).toBeGreaterThan(0);expect(data.features[0].properties.source).toBe(DEFAULT_PARCEL_LAYER);
    expect(Object.keys(data.features[0].properties).sort()).toEqual(["fetchedAt","parcelId","source"]);expect(network).not.toHaveBeenCalled();
    expect(data.metadata.note).toContain("not the entire county");expect(manifest.parcel_count).toBe(17468);
  });
  it("keeps viewport acreage filtering, response limits and source reporting",async()=>{
    vi.stubEnv("PARCEL_DATA_SOURCE","bundled");vi.stubEnv("PARCEL_LAYER_URL","");
    const query="bbox=-120.68,35.27,-120.65,35.29";
    const all=await findParcels(new URLSearchParams(query)),large=await findParcels(new URLSearchParams(query+"&min_acres=4"));
    expect(all.features).toHaveLength(500);expect(all.metadata.truncated).toBe(true);expect(large.features.length).toBeLessThan(all.features.length);
    expect(large.metadata.dataSource).toBe("bundled-geojson");
    const outside=await findParcels(new URLSearchParams("lat=35.74&lon=-120.67"));expect(outside.features).toEqual([]);
  });
  it("uses exact polygon intersections, preserving holes, multipart pieces and shared edges",()=>{
    const hole=parcel("hole",[ring(),ring(.003,.003,.007,.007)]),multi:SnapshotParcel={type:"Feature",geometry:{type:"MultiPolygon",coordinates:[[ring(.02,0,.03,.01)],[ring(.04,0,.05,.01)]]},properties:{parcelId:"multi"}};
    const index=new ParcelSpatialIndex([hole,multi]);
    expect(index.query([.004,.004,.006,.006]).features).toEqual([]);
    expect(index.query([.005,.005,.005,.005],0,[.005,.005]).features).toEqual([]);
    expect(index.query([.045,.005,.045,.005],0,[.045,.005]).features[0].properties.parcelId).toBe("multi");
    expect(index.query([.01,.005,.011,.006]).features[0].properties.parcelId).toBe("hole");
    const gap=parcel("triangle",[[[.06,0],[.07,0],[.06,.01],[.06,0]]]);
    expect(new ParcelSpatialIndex([gap]).query([.069,.009,.07,.01]).features).toEqual([]);
  });
  it("sorts deterministically and truncates only after 500 actual matches",()=>{
    const rows=Array.from({length:501},(_,i)=>parcel(String(i).padStart(3,"0"))),index=new ParcelSpatialIndex(rows.reverse());
    const result=index.query([.001,.001,.002,.002]);expect(result.features).toHaveLength(500);expect(result.truncated).toBe(true);expect(result.features[0].properties.parcelId).toBe("000");
    expect(index.query([.001,.001,.002,.002],1e6).features).toEqual([]);
  });
  it("retains explicit ArcGIS provider support",async()=>{
    vi.stubEnv("PARCEL_DATA_SOURCE","arcgis");const network=vi.fn<typeof fetch>().mockResolvedValue(Response.json({type:"FeatureCollection",features:[]}));
    await findParcels(new URLSearchParams("lat=35.27&lon=-120.65"),network);expect(network).toHaveBeenCalledTimes(1);
  });
  it("calls the county when a point has no saved parcel, including outside the export",async()=>{
    vi.stubEnv("PARCEL_DATA_SOURCE","");vi.stubEnv("PARCEL_LAYER_URL","");
    const geometry={type:"Polygon",coordinates:[ring(-120.68,35.73,-120.66,35.75)]};
    const network=vi.fn<typeof fetch>().mockResolvedValue(Response.json({type:"FeatureCollection",features:[{type:"Feature",geometry,properties:{apn:"county-only",OBJECTID:1}}]}));
    const result=await findParcels(new URLSearchParams("lat=35.74&lon=-120.67"),network);
    expect(network).toHaveBeenCalledTimes(1);expect(result.features[0].properties.parcelId).toBe("county-only");expect(result.metadata.dataSource).toBe("arcgis");
    await expect(findParcels(new URLSearchParams("lat=35.74&lon=-120.67"),vi.fn().mockRejectedValue(new Error("county unavailable")))).rejects.toThrow("county unavailable");
    const insideHole=vi.fn<typeof fetch>().mockResolvedValue(Response.json({type:"FeatureCollection",features:[]}));
    await findParcels(new URLSearchParams("lat=35.319&lon=-120.737"),insideHole);expect(insideHole).toHaveBeenCalledTimes(1);
  });
  it("merges mixed-coverage county results without duplicating APNs and preserves local matches on failure",async()=>{
    vi.stubEnv("PARCEL_DATA_SOURCE","");vi.stubEnv("PARCEL_LAYER_URL","");
    const query=new URLSearchParams("bbox=-120.618,35.243,-120.602,35.256"),local=await findParcels(new URLSearchParams(query.toString()+"&min_acres=0"),vi.fn().mockRejectedValue(new Error("offline")));
    // This eastern-edge viewport includes some saved parcels and extends beyond the export.
    expect(local.features.length).toBeGreaterThan(0);expect(local.metadata.truncated).toBe(true);expect(local.metadata.note).toContain("fallback unavailable");
    const f=local.features[0],network=vi.fn<typeof fetch>().mockResolvedValue(Response.json({type:"FeatureCollection",features:[{...f,properties:{apn:f.properties.parcelId,OBJECTID:1}},
      {type:"Feature",geometry:{type:"Polygon",coordinates:[ring(-120.604,35.247,-120.603,35.248)]},properties:{apn:"remote-extra",OBJECTID:2}}]}));
    const merged=await findParcels(query,network);expect(network).toHaveBeenCalledTimes(1);expect(merged.features.filter(p=>p.properties.parcelId===f.properties.parcelId)).toHaveLength(1);
    expect(merged.features.some(p=>p.properties.parcelId==="remote-extra")).toBe(true);expect(merged.metadata.dataSource).toBe("bundled-geojson+arcgis");
  });
});
