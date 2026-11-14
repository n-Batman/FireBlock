"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { GeoJSON, Pane, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import type { Parcels } from "./parcels";
import { parseRiskGrid,projectGridToParcels,type RiskGrid } from "./parcelRisk";

/** Independent parcel geometry; never changes or invents risk block scores. */
export function ParcelOverlay({center,onGridActive}:{center:[number,number];onGridActive?:(active:boolean)=>void}) {
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
  const [showGrid,setShowGrid]=useState(true);
  const [gridMessage,setGridMessage]=useState("Load backend risk_map.geojson to color whole properties.");
  useEffect(()=>{onGridActive?.(!!grid);},[grid,onGridActive]);
  const projection=useMemo(()=>{
    if(!data||!grid)return {data:null,error:null};
    try{return {data:projectGridToParcels(data,grid),error:null};}
    catch(error){return {data:null,error:error instanceof Error?error.message:"Projection failed"};}
  },[data,grid]);
  function loadGrid(value:unknown){
    const parsed=parseRiskGrid(value);gridGeneration.current++;setGrid(parsed);setGridRevision(v=>v+1);
    const publication=(value as {publication?:{source?:string}}).publication;
    setGridMessage(`${publication?.source==="published-snapshot"?"Published real-data snapshot · ":""}${parsed.features.length} cells · ${parsed.features[0].properties.model_id} · ${parsed.features[0].properties.as_of}`);
    setShowGrid(true);
    const bounds=L.geoJSON(parsed).getBounds();
    if(bounds.isValid())map.fitBounds(bounds,{padding:[40,40],maxZoom:14});
  }
  useEffect(()=>{
    const abort=new AbortController();const generation=gridGeneration.current;
    void fetch("/api/risk-grid",{signal:abort.signal}).then(async response=>{
      const value=await response.json();if(!response.ok)throw new Error(value.error);
      if(gridGeneration.current===generation)loadGrid(value);
    }).catch(()=>{if(!abort.signal.aborted&&gridGeneration.current===generation)setGridMessage("No published cloud grid available yet. Run the cloud risk pipeline or load a grid file.");});
    return ()=>abort.abort();
  },[]);
  const pending=useRef<AbortController|null>(null);
  const serial=useRef(0);
  useEffect(()=>{
    const control=new L.Control({position:"bottomright"});
    const node=L.DomUtil.create("div");
    node.style.cssText="background:white;color:#18241d;padding:12px;width:270px;max-height:45vh;overflow:auto;border:1px solid #aaa;border-radius:6px;font:13px system-ui";
    L.DomEvent.disableClickPropagation(node); L.DomEvent.disableScrollPropagation(node);
    control.onAdd=()=>node; control.addTo(map); setHost(node);
    return ()=>{serial.current++;pending.current?.abort();control.remove();};
  },[map]);
  async function search(query:URLSearchParams){
    pending.current?.abort(); const controller=new AbortController(); pending.current=controller;
    const current=++serial.current;
    setBusy(true); setMessage("Finding parcel boundaries…"); setData(null);setLastQuery(null);setArchiveMessage("");
    try{
      const response=await fetch(`/api/parcels?${query}`,{signal:controller.signal});
      const result=await response.json();
      if(!response.ok) throw new Error(result.error || "Lookup failed");
      if(current!==serial.current) return;
      setData(result);setVisible(true);setLastQuery(query.toString());
      setMessage(`${result.features.length} parcels${result.metadata.truncated?" — limit reached; narrow your area":""}.`);
      if(result.features.length){const bounds=L.geoJSON(result).getBounds();if(bounds.isValid())map.fitBounds(bounds,{padding:[35,35],maxZoom:18});}
    }catch(error){if(current===serial.current && !controller.signal.aborted)setMessage(error instanceof Error?error.message:"Lookup failed");}
    finally{if(current===serial.current)setBusy(false);}
  }
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
      <button style={buttonStyle} onClick={async()=>{
        setGridMessage("Loading backend grid…");
        try{const response=await fetch("/api/risk-grid");const value=await response.json();if(!response.ok)throw new Error(value.error);loadGrid(value);}
        catch(error){setGridMessage(error instanceof Error?error.message:"Grid unavailable");}
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
    {visible && data && <Pane name="parcel-boundaries" style={{zIndex:450}}>
      <GeoJSON key={`${data.metadata.fetchedAt}-${gridRevision}`} data={projection.data??data} style={feature=>{
        const p=feature?.properties;const score=p?.risk_score;
        return {color:"#38e6ff",weight:2,fill:!!projection.data,fillColor:typeof score==="number"?`hsl(${45-score*.45} 75% ${75-score*.38}%)`:"#777777",fillOpacity:.6};
      }} onEachFeature={(feature,layer)=>{
        const p=feature.properties;const label=document.createElement("span");
        label.textContent=`Parcel ${p.parcelId}`+("coverage" in p?` · ${p.risk_score===null?"Unknown / insufficient coverage":`Score ${p.risk_score.toFixed(1)}/100`} · Known area ${(p.coverage*100).toFixed(0)}% · Peak cell ${p.peak_score??"unknown"}`:"");layer.bindTooltip(label);
      }}/>
    </Pane>}
    {showGrid&&grid&&<Pane name="backend-risk-grid" style={{zIndex:410}}><GeoJSON key={gridRevision} data={grid} style={feature=>{
      const score=feature?.properties?.risk_score;return {color:"#eeeeee",weight:1,fillColor:typeof score==="number"?`hsl(${45-score*.45} 75% ${75-score*.38}%)`:"#777777",fillOpacity:.3};
    }}/></Pane>}
  </>;
}
