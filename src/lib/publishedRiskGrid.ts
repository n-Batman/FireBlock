import {readFile} from "node:fs/promises";
import {join} from "node:path";
import {createHash} from "node:crypto";
import catalog from "@/data/real-runs/catalog.json";
import {parseRiskGrid} from "./parcelRisk";
import {mergeRiskGrids,intersects,riskBounds,type RiskBounds} from "./riskMosaic";

/** Public, verified real-data snapshot for deployments without cloud credentials. */
export async function publishedRiskGrid(bbox?:RiskBounds){
  const publications=[];
  for(const item of catalog.publications){
    if(bbox&&!intersects(riskBounds(item.bbox),bbox))continue;
    if(!/^[A-Za-z0-9_-]+\/risk_map\.geojson$/.test(item.path))throw new Error("Invalid snapshot path");
    const bytes=await readFile(join(process.cwd(),"src/data/real-runs",item.path));
    if(createHash("sha256").update(bytes).digest("hex")!==item.sha256)throw new Error("Published risk snapshot checksum mismatch");
    publications.push({id:item.id,grid:parseRiskGrid(JSON.parse(bytes.toString("utf8")))});
  }
  return {...mergeRiskGrids(publications,bbox),publication:{source:"published-snapshot",runs:publications.map(p=>p.id)}};
}
