import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {act,fireEvent,render,screen} from "@testing-library/react";
import {useMemo,useState} from "react";
import {MapContainer} from "react-leaflet";
import L from "leaflet";
import type {ParcelUnit} from "@/data/types";
import {ParcelOverlay} from "./ParcelOverlay";
import {useParcels} from "./useParcels";
import {cellsFromRiskMap} from "./parcelScore";
import type {RiskGrid} from "./parcelRisk";
import {clearParcelCache} from "./parcelCache";
import {PARCEL_SCAN_KEY} from "./parcelScanStore";

const place={id:1,lat:35.632,lon:-120.858};
const view={west:-120.87,south:35.62,east:-120.84,north:35.64,zoom:17};
const parcels={type:"FeatureCollection",features:[{
  type:"Feature",geometry:{type:"Polygon",coordinates:[[[-120.86,35.63],[-120.856,35.63],[-120.856,35.634],[-120.86,35.634],[-120.86,35.63]]]},
  properties:{parcelId:"regional-APN",source:"county",fetchedAt:"now"},
}],metadata:{source:"county",truncated:false,limit:500,fetchedAt:"now",note:"GIS"}};
const grid=(score=40,model="v1"):RiskGrid=>({type:"FeatureCollection",features:[{
  type:"Feature",geometry:{type:"Polygon",coordinates:[[[-120.87,35.62],[-120.84,35.62],[-120.84,35.64],[-120.87,35.64],[-120.87,35.62]]]},
  properties:{layer:"relative_risk",cell_id:"regional-cell",risk_score:score,model_id:model,as_of:"2026-11-14T00:00:00Z"},
}]});
const fetchMock=vi.fn();
let response:RiskGrid,status:number,savedScan:string|null;

beforeEach(()=>{
  clearParcelCache();vi.useFakeTimers();
  response=grid();status=200;savedScan=null;
  vi.spyOn(L.Map.prototype,"getBounds").mockReturnValue(L.latLngBounds([view.south,view.west],[view.north,view.east]));
  vi.stubGlobal("localStorage",{getItem:(key:string)=>key===PARCEL_SCAN_KEY?savedScan:null});
  fetchMock.mockImplementation(async(url:string)=>{
    if(url.includes("/api/parcels"))return {ok:true,status:200,json:async()=>parcels};
    if(url.includes("/api/risk-grid"))return {ok:status===200,status,json:async()=>status===200?response:{error:"regional grid unavailable"}};
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch",fetchMock);
});
afterEach(()=>{clearParcelCache();fetchMock.mockReset();vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();});

function SharedMap(){
  const [riskGrid,setRiskGrid]=useState<RiskGrid|null>(null);
  const cells=useMemo(()=>riskGrid?cellsFromRiskMap(riskGrid):[],[riskGrid]);
  const state=useParcels(place,view,cells);
  return <>
    <output data-testid="scores">{JSON.stringify(state.units)}</output>
    <MapContainer center={[place.lat,place.lon]} zoom={17}>
      <ParcelOverlay center={[place.lat,place.lon]} onGridChange={setRiskGrid} parcelMask={[]} showGridByDefault={false}/>
    </MapContainer>
  </>;
}
const advance=async(ms=0)=>{await act(async()=>{await vi.advanceTimersByTimeAsync(ms);});};
const units=()=>JSON.parse(screen.getByTestId("scores").textContent!) as ParcelUnit[];
const riskCalls=()=>fetchMock.mock.calls.filter(([url])=>String(url).includes("/api/risk-grid"));

describe("shared regional risk data",()=>{
  it("uses one padded API response for parcel scores and the overlay without a static-map download",async()=>{
    render(<SharedMap/>);await advance();
    expect(units()[0].score).toMatchObject({score:40,source:{kind:"risk-map",modelId:"v1",coverage:1}});
    expect(screen.getByText(/1 cells.*v1/)).toBeInTheDocument();
    expect(riskCalls()).toHaveLength(1);
    const bbox=new URL(String(riskCalls()[0][0]),"https://local.test").searchParams.get("bbox")!.split(",").map(Number);
    [-120.885,35.61,-120.825,35.65].forEach((value,i)=>expect(bbox[i]).toBeCloseTo(value,10));
    expect(fetchMock.mock.calls.some(([url])=>String(url).includes("risk_map.geojson"))).toBe(false);
    await advance(125000);expect(riskCalls()).toHaveLength(1);
  });

  it("keeps parcels unscored until the regional response arrives",async()=>{
    let release!:(value:unknown)=>void;
    fetchMock.mockImplementation(async(url:string)=>url.includes("/api/parcels")
      ?{ok:true,status:200,json:async()=>parcels}:new Promise(resolve=>{release=resolve;}));
    render(<SharedMap/>);await advance();
    expect(units()).toHaveLength(1);expect(units()[0].score).toBeNull();
    await act(async()=>{release({ok:true,status:200,json:async()=>grid()});});
    expect(units()[0].score?.score).toBe(40);
  });

  it("invalidates parcel scores when manual reload supplies a new regional model",async()=>{
    render(<SharedMap/>);await advance();
    response=grid(80,"v2");
    fireEvent.click(screen.getByRole("button",{name:"Load configured backend grid"}));
    await advance(250);
    expect(riskCalls()).toHaveLength(2);
    expect(units()[0].score).toMatchObject({score:80,source:{kind:"risk-map",modelId:"v2"}});
    expect(screen.getByText(/1 cells.*v2/)).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([url])=>String(url).includes("/api/parcels"))).toHaveLength(1);
  });

  it.each(["empty coverage","failed refresh"])("returns unknown rather than retaining stale static scores after %s",async scenario=>{
    render(<SharedMap/>);await advance();
    expect(units()[0].score?.score).toBe(40);
    if(scenario==="empty coverage")response={type:"FeatureCollection",features:[]};else status=502;
    fireEvent.click(screen.getByRole("button",{name:"Load configured backend grid"}));
    await advance(250);
    expect(units()[0].score).toBeNull();
  });

  it("keeps the saved scan override when regional grid loading fails",async()=>{
    savedScan=JSON.stringify([{lat:place.lat,lon:place.lon,risks:3,clears:1,at:"2026-11-14T00:00:00Z"}]);
    status=502;
    render(<SharedMap/>);await advance();
    expect(units()[0].score).toMatchObject({score:75,source:{kind:"scan"}});
  });
});
