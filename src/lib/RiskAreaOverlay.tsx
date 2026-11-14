"use client";
import { useMemo,useState } from "react";
import { GeoJSON,Pane,useMap,useMapEvents } from "react-leaflet";
import type { RiskGrid } from "./parcelRisk";
import { riskOverview } from "./riskOverview";
import { scaleColor } from "./riskScale";
import { INDIVIDUAL_PARCEL_ZOOM } from "./parcelDisplay";

/** Larger area shapes below parcel zoom. There are no parcel requests or individual ratings here. */
export function RiskAreaOverlay({grid}:{grid:RiskGrid}){
  const map=useMap();
  const camera=()=>{const b=map.getBounds();return {west:b.getWest(),south:b.getSouth(),east:b.getEast(),north:b.getNorth(),zoom:Math.floor(map.getZoom())};};
  const [view,setView]=useState(camera);
  useMapEvents({moveend:()=>setView(camera())});
  const overview=useMemo(()=>riskOverview(grid,view.zoom,view),[grid,view]);
  if(view.zoom>=INDIVIDUAL_PARCEL_ZOOM||!overview.features.length)return null;
  return <Pane name="risk-area-overview" style={{zIndex:440}}>
    <GeoJSON key={`${view.zoom}:${view.west}:${view.south}:${view.east}:${view.north}`} data={overview} style={feature=>{
      const score=feature?.properties?.risk_score,color=typeof score==='number'?scaleColor(score):'#929b96';
      return {color,fillColor:color,weight:1,fillOpacity:.3};
    }} onEachFeature={(feature,layer)=>{
      const p=feature.properties,node=document.createElement('span');
      node.textContent=`Area summary · ${p.risk_score===null?'Insufficient coverage':`Score ${p.risk_score.toFixed(1)}/100`} · ${(p.coverage*100).toFixed(0)}% scored area · Zoom in for property ratings`;
      layer.bindTooltip(node);
      const ring=feature.geometry.type==='Polygon'?feature.geometry.coordinates[0]:null;
      if(ring)layer.on('click',()=>{map.setView([(ring[0][1]+ring[2][1])/2,(ring[0][0]+ring[2][0])/2],INDIVIDUAL_PARCEL_ZOOM,{animate:false});});
    }}/>
  </Pane>;
}
