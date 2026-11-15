import {it,expect,vi,afterEach} from "vitest";
import {act,render,screen} from "@testing-library/react";
import {MapContainer,useMap} from "react-leaflet";
import L from "leaflet";
import type {ParcelUnit,PolygonRings} from "@/data/types";
import {useParcelDisplay} from "./ParcelAreas";
afterEach(()=>vi.restoreAllMocks());

it("restores individual boundaries after a real Leaflet zoom/resize cycle",()=>{
  let map:L.Map;
  const R=6378137,ll=(x:number,y:number):[number,number]=>[(2*Math.atan(Math.exp(y/R))-Math.PI/2)*180/Math.PI,x/R*180/Math.PI];
  function lot(id:string,x:number):ParcelUnit{
    return {id,acres:1,center:ll(x+20,30),score:null,parts:[[[ll(x,10),ll(x+40,10),ll(x+40,50),ll(x,50),ll(x,10)]]]};
  }
  const parcels=[lot("a",10),lot("b",50)];
  let outline:PolygonRings[]|undefined;
  function Probe(){
    map=useMap();const display=useParcelDisplay(parcels,null);
    outline=display.areas[0]?.parts;
    return <div data-testid="parcel-detail">{`${display.individuals.length} individuals; ${display.areas.length} groups`}</div>;
  }
  render(<MapContainer center={[0,0]} zoom={15}><Probe/></MapContainer>);
  let bounds=L.latLngBounds(ll(0,0),ll(1000,1000));
  vi.spyOn(map!,"getBounds").mockImplementation(()=>bounds);
  act(()=>{map!.fire("zoomend");});
  expect(screen.getByTestId("parcel-detail").textContent).toBe("0 individuals; 1 groups");
  const originalOutline=outline;
  bounds=L.latLngBounds(ll(-10,0),ll(990,1000));
  act(()=>{map!.fire("moveend");});
  expect(outline).toBe(originalOutline);
  bounds=L.latLngBounds(ll(0,0),ll(100,100));
  act(()=>{map!.fire("zoomend");map!.fire("moveend");});
  expect(screen.getByTestId("parcel-detail").textContent).toBe("2 individuals; 0 groups");
  bounds=L.latLngBounds(ll(0,0),ll(1000,1000));
  act(()=>{map!.fire("resize");});
  expect(screen.getByTestId("parcel-detail").textContent).toBe("0 individuals; 1 groups");
  expect(outline).toBe(originalOutline);
  bounds=L.latLngBounds(ll(0,0),ll(100,100));
  act(()=>{map!.fire("resize");});
  expect(screen.getByTestId("parcel-detail").textContent).toBe("2 individuals; 0 groups");
});
