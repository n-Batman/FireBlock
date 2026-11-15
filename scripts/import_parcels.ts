/** Import a user-supplied GeoJSON export into the server-only parcel snapshot. */
import {readFile,mkdir,writeFile} from "node:fs/promises";
import {basename,join} from "node:path";
import {gzipSync} from "node:zlib";
import {createHash} from "node:crypto";
import {union} from "polyclip-ts";
import type {Polygon,MultiPolygon,Feature,Position} from "geojson";
import {normalizeParcelGeometry} from "../src/lib/parcels";

async function main(){
  const input=process.argv[2];if(!input)throw new Error("Usage: tsx scripts/import_parcels.ts <Parcels.geojson>");
  const bytes=await readFile(input),data=JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/,""));
  if(data.type!=="FeatureCollection"||!Array.isArray(data.features)||!data.features.length)throw new Error("Expected nonempty GeoJSON FeatureCollection");
  const byId=new Map<string,Feature<Polygon|MultiPolygon,{parcelId:string}>>();
  for(const raw of data.features){
    const id=raw.properties?.APN??raw.properties?.apn??raw.properties?.parcelId;
    if(typeof id!=="string"||!id.trim())throw new Error("Each parcel needs an APN");
    let geometry=normalizeParcelGeometry(raw.geometry);const previous=byId.get(id);
    if(previous){
      const a=previous.geometry.type==="Polygon"?[previous.geometry.coordinates]:previous.geometry.coordinates,b=geometry.type==="Polygon"?[geometry.coordinates]:geometry.coordinates;
      const clip=(polygons:Position[][][])=>polygons.map(p=>p.map(r=>r.map(([x,y]):[number,number]=>[x,y])));
      const combined=union(clip(a),clip(b));geometry=combined.length===1?{type:"Polygon",coordinates:combined[0]}:{type:"MultiPolygon",coordinates:combined};
    }
    byId.set(id,{type:"Feature",geometry,properties:{parcelId:id}});
  }
  const features=[...byId.values()].sort((a,b)=>a.properties.parcelId.localeCompare(b.properties.parcelId));
  const snapshot=Buffer.from(JSON.stringify({type:"FeatureCollection",features})),compressed=gzipSync(snapshot,{level:9}),bounds=[Infinity,Infinity,-Infinity,-Infinity];
  for(const f of features)for(const p of f.geometry.type==="Polygon"?f.geometry.coordinates.flat():f.geometry.coordinates.flat(2)){
    bounds[0]=Math.min(bounds[0],p[0]);bounds[1]=Math.min(bounds[1],p[1]);bounds[2]=Math.max(bounds[2],p[0]);bounds[3]=Math.max(bounds[3],p[1]);
  }
  const folder=join(process.cwd(),"src/data/parcels");await mkdir(folder,{recursive:true});
  await writeFile(join(folder,"slo-parcels.geojson.gz"),compressed);
  const manifest={schema_version:1,source_filename:basename(input),source_sha256:createHash("sha256").update(bytes).digest("hex"),source_features:data.features.length,
    parcel_count:features.length,bounds,imported_at:new Date().toISOString(),compressed_bytes:compressed.length,compressed_sha256:createHash("sha256").update(compressed).digest("hex"),
    note:"User-supplied SLO-area export; APN and polygon geometry only. Duplicate APN pieces unioned. Owner links, notes and other source attributes removed."};
  await writeFile(join(folder,"manifest.json"),JSON.stringify(manifest,null,2)+"\n");console.log(JSON.stringify(manifest));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
