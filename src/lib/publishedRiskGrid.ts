import {readFile} from "node:fs/promises";
import {join} from "node:path";
import {createHash} from "node:crypto";
import provenance from "@/data/real-runs/slo-town-20261114/provenance.json";
import {parseRiskGrid} from "./parcelRisk";

/** Public, verified real-data snapshot for deployments without cloud credentials. */
export async function publishedRiskGrid(){
  const bytes=await readFile(join(process.cwd(),"src/data/real-runs/slo-town-20261114/risk_map.geojson"));
  if(createHash("sha256").update(bytes).digest("hex")!==provenance.artifact_sha256["risk_map.geojson"])
    throw new Error("Published risk snapshot checksum mismatch");
  return {...parseRiskGrid(JSON.parse(bytes.toString("utf8"))),publication:{
    source:"published-snapshot",run_id:provenance.run_id,as_of:provenance.as_of,
    results_url:"/results/slo-town/index.html",
  }};
}
