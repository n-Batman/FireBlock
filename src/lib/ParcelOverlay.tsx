"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { GeoJSON, Pane, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import type { Parcels } from "./parcels";

/** Independent parcel geometry; never changes or invents risk block scores. */
export function ParcelOverlay({center}:{center:[number,number]}) {
  const map=useMap();
  const [host,setHost]=useState<HTMLElement|null>(null);
  const [lat,setLat]=useState(String(center[0]));
  const [lon,setLon]=useState(String(center[1]));
  const [visible,setVisible]=useState(true);
  const [pick,setPick]=useState(false);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("Search a point or the visible area. SLO County coverage.");
  const [data,setData]=useState<Parcels|null>(null);
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
    setBusy(true); setMessage("Finding parcel boundaries…"); setData(null);
    try{
      const response=await fetch(`/api/parcels?${query}`,{signal:controller.signal});
      const result=await response.json();
      if(!response.ok) throw new Error(result.error || "Lookup failed");
      if(current!==serial.current) return;
      setData(result);setVisible(true);
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
      <small>GIS outlines for planning, not a boundary survey. Risk colors remain the existing risk layer.</small>
      {data && <p><a href={data.metadata.source} target="_blank" rel="noreferrer">County source</a> · <button style={buttonStyle} onClick={()=>{
        const url=URL.createObjectURL(new Blob([JSON.stringify(data)],{type:"application/geo+json"}));
        const a=document.createElement("a");a.href=url;a.download="parcels.geojson";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      }}>Save GeoJSON</button></p>}
    </section>,host)}
    {visible && data && <Pane name="parcel-boundaries" style={{zIndex:450}}>
      <GeoJSON key={data.metadata.fetchedAt} data={data} style={{color:"#38e6ff",weight:3,fill:false}} onEachFeature={(feature,layer)=>{
        const label=document.createElement("span"); label.textContent=`Parcel ${feature.properties.parcelId}`;layer.bindTooltip(label);
      }}/>
    </Pane>}
  </>;
}
