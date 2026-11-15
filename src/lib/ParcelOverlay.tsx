"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { GeoJSON, Pane, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import type { Parcels } from "./parcels";
import { parseRiskGrid,projectGridToParcels,type RiskGrid } from "./parcelRisk";
import type { MultiPolygon, Polygon } from "geojson";
import { gridOutsideParcels, gridSignature } from "./gridCoverage";
import { insideSlo } from "./geocode";
import { OUTSIDE_COUNTY_MESSAGE } from "@/content/placeMessages";
import { fetchParcelResponse } from "./parcelCache";

/** Independent parcel geometry; never changes or invents risk block scores. `lookup` is a place picked in the address search; a new `id` runs a new lookup. `onPoint` reports the point of a latitude/longitude or "Pick on map" lookup. */
export function ParcelOverlay({center,onGridActive,lookup,onPoint,showGridByDefault=true,parcelMask}:{center:[number,number];onGridActive?:(active:boolean)=>void;lookup?:{lat:number;lon:number;id:number}|null;onPoint?:(p:{lat:number;lon:number})=>void;showGridByDefault?:boolean;parcelMask?:(Polygon|MultiPolygon)[]}) {
  const map=useMap();
  const [host,setHost]=useState<HTMLElement|null>(null);
  const [lat,setLat]=useState(String(center[0]));
  const [lon,setLon]=useState(String(center[1]));
  const [visible,setVisible]=useState(true);
  const [pick,setPick]=useState(false);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("Search a point or the visible area. SLO County coverage.");
  const [data,setData]=useState<Parcels|null>(null);
  const [lastQuery,setLastQuery]=useState<string|null>(null);
  const [archiveBusy,setArchiveBusy]=useState(false);
  const [archiveMessage,setArchiveMessage]=useState("");
  const [grid,setGrid]=useState<RiskGrid|null>(null);
  const [gridRevision,setGridRevision]=useState(0);
  const gridGeneration=useRef(0);
  const automaticGrid=useRef(true);
  const forceGrid=useRef(false);
  const [showGrid,setShowGrid]=useState(showGridByDefault);
  const [gridMessage,setGridMessage]=useState("Load backend risk_map.geojson to color whole properties.");
  const managedParcels=parcelMask!==undefined;
  useEffect(()=>{onGridActive?.(!!grid?.features.length);},[grid,onGridActive]);
  const projection=useMemo(()=>{
    if(!visible||managedParcels||!data||!grid)return {data:null,error:null};
    try{return {data:projectGridToParcels(data,grid),error:null};}
    catch(error){return {data:null,error:error instanceof Error?error.message:"Projection failed"};}
  },[data,grid,visible,managedParcels]);
  // The grid is drawn only where no parcel covers it. Scoring above still uses the whole grid.
  const visibleGrid=useMemo(()=>{
    if(!visible||!showGrid||!grid)return null;
    return gridOutsideParcels(grid,managedParcels?parcelMask!:(data?.features.map(f=>f.geometry)??[]));
  },[grid,parcelMask,data,visible,showGrid,managedParcels]);
  const loadGrid=useCallback((value:unknown,focus=true)=>{
    const parsed=parseRiskGrid(value);
    if(focus)automaticGrid.current=false;
    gridGeneration.current++;setGrid(parsed);setGridRevision(v=>v+1);
    const publication=(value as {publication?:{source?:string}}).publication;
    const times=[...new Set(parsed.features.map(f=>f.properties.as_of))].sort();
    setGridMessage(parsed.features.length?`${publication?.source==="published-snapshot"?"Published real-data snapshot · ":""}${parsed.features.length} cells · ${[...new Set(parsed.features.map(f=>f.properties.model_id))].join(", ")} · ${times.length===1?times[0]:"multiple observation times"}`:"No published risk coverage in this area.");
    if(focus)setShowGrid(showGridByDefault);
    const bounds=L.geoJSON(parsed).getBounds();
    if(focus&&bounds.isValid())map.fitBounds(bounds,{padding:[40,40],maxZoom:14});
  },[map,showGridByDefault]);
  useEffect(()=>{
    let abort:AbortController|undefined,timer:ReturnType<typeof setTimeout>|undefined;
    let fetchedBox:L.LatLngBounds|undefined;
    function refresh(){
      if(!automaticGrid.current)return;
      const force=forceGrid.current;forceGrid.current=false;
      const b=map.getBounds();
      if(!force&&fetchedBox?.contains(b))return;
      abort?.abort();const control=new AbortController();abort=control;
      const generation=gridGeneration.current,padded=b.pad(.5);
      const box=L.latLngBounds([Math.max(-85,padded.getSouth()),Math.max(-180,padded.getWest())],[Math.min(85,padded.getNorth()),Math.min(180,padded.getEast())]);
      const bbox=[box.getWest(),box.getSouth(),box.getEast(),box.getNorth()].join(",");
      void fetch(`/api/risk-grid?bbox=${bbox}`,{signal:control.signal,cache:"no-store"}).then(async response=>{
        const value=await response.json();if(!response.ok)throw new Error(value.error);
        if(!control.signal.aborted&&gridGeneration.current===generation){loadGrid(value,false);fetchedBox=box;}
      }).catch(error=>{if(!control.signal.aborted&&gridGeneration.current===generation){fetchedBox=undefined;setGrid(null);setGridMessage(error instanceof Error?error.message:"Risk coverage is unavailable");}});
    }
    const moved=()=>{
      abort?.abort();clearTimeout(timer);
      if(automaticGrid.current&&(forceGrid.current||!fetchedBox?.contains(map.getBounds())))timer=setTimeout(refresh,250);
    };
    refresh();map.on("moveend",moved);
    return ()=>{abort?.abort();clearTimeout(timer);map.off("moveend",moved);};
  },[map,loadGrid]);
  const pending=useRef<AbortController|null>(null);
  const serial=useRef(0);
  useEffect(()=>{
    const control=new L.Control({position:"bottomright"});
    const node=L.DomUtil.create("div");
    node.style.cssText="background:white;color:#18241d;padding:12px;width:270px;max-height:45vh;overflow:auto;border:1px solid #aaa;border-radius:6px;font:13px system-ui";
    L.DomEvent.disableClickPropagation(node); L.DomEvent.disableScrollPropagation(node);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the Leaflet control's host node exists only after mount
    control.onAdd=()=>node; control.addTo(map); setHost(node);
    return ()=>{serial.current++;pending.current?.abort();control.remove();};
  },[map]);
  async function search(query:URLSearchParams){
    const lat0=Number(query.get("lat")),lon0=Number(query.get("lon"));
    if(query.has("lat")&&Number.isFinite(lat0)&&Number.isFinite(lon0))onPoint?.({lat:lat0,lon:lon0});
    if(query.has("lat")&&Number.isFinite(lat0)&&Number.isFinite(lon0)&&!insideSlo(lat0,lon0)){pending.current?.abort();setData(null);setMessage(OUTSIDE_COUNTY_MESSAGE);return;}
    pending.current?.abort(); const controller=new AbortController(); pending.current=controller;
    const current=++serial.current;
    setBusy(true); setMessage("Finding parcel boundaries…"); setData(null);setLastQuery(null);setArchiveMessage("");
    try{
      const response=await fetchParcelResponse(query,{signal:controller.signal});
      const result=await response.json() as Parcels & {error?:string};
      if(!response.ok) throw new Error(result.error || "Lookup failed");
      if(current!==serial.current) return;
      setData(result);setVisible(true);setLastQuery(query.toString());
      setMessage(`${result.features.length} parcels${result.metadata.truncated?" — limit reached; narrow your area":""}.`);
      if(result.features.length){const bounds=L.geoJSON(result).getBounds();if(bounds.isValid())map.fitBounds(bounds,{padding:[35,35],maxZoom:18});}
    }catch(error){if(current===serial.current && !controller.signal.aborted)setMessage(error instanceof Error?error.message:"Lookup failed");}
    finally{if(current===serial.current)setBusy(false);}
  }
  useEffect(()=>{
    // eslint-disable-next-line react-hooks/set-state-in-effect -- starts a fetch for a new address-search pick
    if(lookup&&!managedParcels) void search(new URLSearchParams({lat:String(lookup.lat),lon:String(lookup.lon)}));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per address-search pick (its id), not on every render
  },[lookup?.id,managedParcels]);
  useMapEvents({click(event){if(pick){setLat(String(event.latlng.lat));setLon(String(event.latlng.lng));setPick(false);void search(new URLSearchParams({lat:String(event.latlng.lat),lon:String(event.latlng.lng)}));}}});
  const buttonStyle={border:"1px solid #888",padding:"5px 8px",borderRadius:3,margin:"4px 3px 4px 0",cursor:"pointer"};
  return <>
    {host && createPortal(<section aria-label="Property boundary search">
      <strong>Property boundaries</strong>
      <form onSubmit={e=>{e.preventDefault();setPick(false);void search(new URLSearchParams({lat,lon}));}}>
        <label style={{display:"block"}}>Latitude <input aria-label="Parcel latitude" type="number" step="any" min="-85" max="85" required value={lat} onChange={e=>setLat(e.target.value)} style={{width:120,border:"1px solid #aaa",margin:3}}/></label>
        <label style={{display:"block"}}>Longitude <input aria-label="Parcel longitude" type="number" step="any" min="-180" max="180" required value={lon} onChange={e=>setLon(e.target.value)} style={{width:120,border:"1px solid #aaa",margin:3}}/></label>
        <button style={buttonStyle} disabled={busy}>Find at point</button>
        <button style={buttonStyle} type="button" disabled={busy} onClick={()=>setPick(!pick)}>{pick?"Cancel map pick":"Pick on map"}</button>
      </form>
      <button style={buttonStyle} disabled={busy} onClick={()=>{setPick(false);const b=map.getBounds();void search(new URLSearchParams({bbox:[b.getWest(),b.getSouth(),b.getEast(),b.getNorth()].join(",")}));}}>Find in visible area</button>
      <label style={{display:"block"}}><input type="checkbox" checked={visible} onChange={e=>setVisible(e.target.checked)}/> Show parcel outlines over risk</label>
      <p role="status">{pick?"Click a location on the map.":message}</p>
      <hr style={{margin:"8px 0"}}/>
      <strong>Property risk display</strong>
      <label style={{display:"block"}}>Backend grid file <input aria-label="Backend risk grid file" type="file" accept=".json,.geojson" onChange={async e=>{
        const file=e.target.files?.[0];if(!file)return;
        try{if(file.size>25*1024*1024)throw new Error("Select a file smaller than 25 MiB");loadGrid(JSON.parse(await file.text()));}
        catch(error){setGridMessage(error instanceof Error?error.message:"Invalid grid file");}
        e.target.value="";
      }}/></label>
      <button style={buttonStyle} onClick={()=>{
        setGridMessage("Loading backend grid…");
        automaticGrid.current=true;forceGrid.current=true;map.fire("moveend");
      }}>Load configured backend grid</button>
      <label style={{display:"block"}}><input type="checkbox" checked={showGrid} onChange={e=>setShowGrid(e.target.checked)}/> Show underlying grid</label>
      <p role="status">{gridMessage}</p>
      <button style={buttonStyle} disabled={!lastQuery||archiveBusy||busy} onClick={async()=>{
        setArchiveBusy(true);setArchiveMessage("Archiving licensed boundaries and cloud-grid projection…");
        try{
          const response=await fetch(`/api/parcel-display?${lastQuery}`,{method:"POST"});
          const value=await response.json();if(!response.ok)throw new Error(value.error);
          setArchiveMessage(`Stored in Backblaze. Manifest: ${value.receipt.manifest_file_id}. Uses the configured cloud grid, not an imported local file.`);
        }catch(error){setArchiveMessage(error instanceof Error?error.message:"Archive failed");}
        finally{setArchiveBusy(false);}
      }}>Save property display to cloud</button>
      <p role="status">{archiveMessage}</p>
      {projection.error&&<p role="alert">{projection.error}</p>}
      {projection.data&&<p>{projection.data.features.filter(f=>f.properties.status==="estimated").length} / {projection.data.features.length} properties with sufficient coverage.</p>}
      <small>Property colors: area-weighted grid score, 0–100 (yellow → red). Gray: under 60% known coverage. No grid means outlines only. GIS boundaries are not surveys.</small>
      {grid&&<p><small>Imported grid replaces sample block colors. The existing sidebar and Low/Medium/High legend still describe sample blocks; use this 0–100 parcel scale for the loaded grid.</small></p>}
      {data && <p><a href={data.metadata.source} target="_blank" rel="noreferrer">County source</a> · <button style={buttonStyle} onClick={()=>{
        const url=URL.createObjectURL(new Blob([JSON.stringify(projection.data??data)],{type:"application/geo+json"}));
        const a=document.createElement("a");a.href=url;a.download="parcels.geojson";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      }}>Save GeoJSON</button></p>}
    </section>,host)}
    {visible && data && !managedParcels && <Pane name="parcel-boundaries" style={{zIndex:450}}>
      <GeoJSON key={`${data.metadata.fetchedAt}-${gridRevision}`} data={projection.data??data} style={feature=>{
        const p=feature?.properties;const score=p?.risk_score;
        return {color:"#38e6ff",weight:2,fill:!!projection.data,fillColor:typeof score==="number"?`hsl(${45-score*.45} 75% ${75-score*.38}%)`:"#777777",fillOpacity:.6};
      }} onEachFeature={(feature,layer)=>{
        const p=feature.properties;const label=document.createElement("span");
        label.textContent=`Parcel ${p.parcelId}`+("coverage" in p?` · ${p.risk_score===null?"Unknown / insufficient coverage":`Score ${p.risk_score.toFixed(1)}/100`} · Known area ${(p.coverage*100).toFixed(0)}% · Peak cell ${p.peak_score??"unknown"}`:"");layer.bindTooltip(label);
      }}/>
    </Pane>}
    {showGrid&&visibleGrid&&<Pane name="backend-risk-grid" style={{zIndex:410}}><GeoJSON key={`${gridRevision}-${gridSignature(visibleGrid)}`} data={visibleGrid} style={feature=>{
      const score=feature?.properties?.risk_score;return {color:"#eeeeee",weight:1,fillColor:typeof score==="number"?`hsl(${45-score*.45} 75% ${75-score*.38}%)`:"#777777",fillOpacity:.3};
    }}/></Pane>}
  </>;
}
