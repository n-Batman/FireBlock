/** Synthetic layout/integration example; never creates a real applicant record. */
import {mkdir,readFile,writeFile} from "node:fs/promises";
import {join} from "node:path";
import {randomUUID,createHash} from "node:crypto";
import {renderGrantPdf} from "../src/lib/grantReportPdf";
import {writeGrantNarrative,type GrantNarrative} from "../src/lib/grantNarrative";
import {CloudStorage} from "../src/lib/cloudStorage";
import {GRANT_PROGRAM,METHOD_NOTE,type GrantFacts,type GrantBlock,type Treatment} from "../src/lib/grantReportData";
import {DEFAULT_PARCEL_LAYER} from "../src/lib/parcels";

async function main(){
  const folder=join(process.cwd(),"analysis/grant-report-qa/output/pdf");await mkdir(folder,{recursive:true});
  const now=new Date(),today=now.toISOString().slice(0,10),id=randomUUID();
  const photoBefore=await readFile("public/demo/sample-hillside.jpg"),photoAfter=await readFile("public/demo/sample-row.jpg");
  const blocks:GrantBlock[]=(["mowing","grazing","brush removal","other"] as Treatment[]).map((t,i)=>{
    const w=-120.66+i*.004,s=35.265,ring=[[w,s],[w+.003,s],[w+.003,s+.002],[w,s+.002],[w,s]];
    const scan=(phase:"before"|"after")=>({kind:"fireblock.parcel-scan" as const,schema_version:1 as const,metric:"dry-fuel-percent-v1" as const,
      scan_id:`179472960000${i}-11111111-1111-4111-8111-11111111111${phase==="before"?"1":"2"}`,recorded_at:today+"T11:00:00Z",scanned_at:today+(phase==="before"?"T09:00:00Z":"T11:00:00Z"),
      location:{lat:s+.001,lon:w+.001,accuracy_m:4},score:phase==="before"?72:i===0?0:18,model_id:"synthetic-example-only",baseline_id:null,findings:[],parcel:{id:`EXAMPLE-${i+1}`,source:DEFAULT_PARCEL_LAYER,matched_at:now.toISOString()},comparison:null});
    const props={parcelId:`EXAMPLE-${i+1}`,source:DEFAULT_PARCEL_LAYER,fetchedAt:now.toISOString()};
    const risk={...props,risk_score:i===3?null:15+i*20,observed_mean:15,peak_score:15,coverage:1,status:"estimated" as const,cells:1,model_id:"synthetic-risk-example",as_of:now.toISOString(),source_model_ids:["synthetic-risk-example"],source_as_of:[now.toISOString()],aggregation:"intersection-area-weighted-v1" as const};
    return {block_id:["Illustrative south block","Illustrative grazing block","Illustrative brush block","Unscanned example block"][i],apn:props.parcelId,acres:i+1.25,treatment_type:t,date_treated:today,location:{lat:s+.001,lon:w+.001},
      parcel:{type:"Feature",geometry:{type:"Polygon",coordinates:[ring,...(i===1?[[[w+.001,s+.0005],[w+.002,s+.0005],[w+.002,s+.0015],[w+.001,s+.0015],[w+.001,s+.0005]]]:[])]},properties:props},
      risk_before:null,risk_after:risk,risk_current:risk,before:i===3?null:{scan:scan("before"),photo:{bytes:photoBefore,content_type:"image/jpeg"}},
      after:i===3?null:{scan:scan("after"),...(i===2?{}:{photo:{bytes:photoAfter,content_type:"image/jpeg" as const}})},scan_status:i===3?"not scanned":i===0?"cleared":"still dry"};
  });
  const facts:GrantFacts={project_name:"DEMONSTRATION ONLY - NOT A REAL APPLICATION",county:"San Luis Obispo (illustrative)",program:GRANT_PROGRAM,report_date:today,prepared_by:"FireBlock automated layout QA",
    applicant_name:null,project_description:"SYNTHETIC LAYOUT TEST ONLY. All APNs, treatment acres, dates and measurements are fictional. Photos are unrelated illustrative demo images, not a real before/after evidence pair.",community_benefit:null,implementation_plan:null,requested_funding:null,
    report_id:id,generated_at:now.toISOString(),total_acres:11,acres_by_treatment:{mowing:1.25,grazing:2.25,"brush removal":3.25,other:4.25},date_start:today,date_end:today,blocks,
    risk_sources:{before:null,after_manifest_ids:[]},method_note:METHOD_NOTE};
  let narrative:GrantNarrative={project_summary:facts.project_description!,community_benefit:"Applicant to complete. This example makes no claim about an actual community or property.",implementation:"The treatment table demonstrates all four treatment categories using fictional acreage. No work has been verified by this example.",monitoring:"The example demonstrates archived scan metadata, attached photos and missing evidence. Demonstration photos show different scenes and must not be used as actual before/after proof.",missing_information:["Real applicant, project and community benefit.","Budget, eligibility, permissions and environmental review.","Real APNs, treatment records and stored scan IDs."]};
  let ai:unknown={mode:"offline illustrative narrative"};
  if(process.argv.includes("--live-ai")){
    const result=await writeGrantNarrative(facts);narrative=result.narrative;ai={model:result.model,response_id:result.response_id};
  }
  const bytes=await renderGrantPdf(facts,narrative),path=join(folder,"grant-report-example.pdf");await writeFile(path,bytes);
  if(process.argv.includes("--upload-qa")){
    const storage=new CloudStorage(),prefix=`grant-reports/qa/${id}/`;
    await storage.requirePrivateBucket();
    const pdf=await storage.uploadBytes(prefix+"example.pdf",bytes,"application/pdf");
    const check=await storage.readBytes(pdf.file_id);if(createHash("sha256").update(check.bytes).digest("hex")!==pdf.sha256)throw new Error("Live PDF read-back mismatch");
    const receipt=await storage.uploadJson(prefix+"qa-receipt.json",{kind:"fireblock.grant-report-qa",status:"synthetic-preview-only",created_at:now.toISOString(),pdf,ai});
    await writeFile(join(folder,"cloud-qa-receipt.json"),JSON.stringify(receipt,null,2));console.log("Verified private QA PDF upload and immutable read-back");
  }
  console.log(path);
}
main().catch(()=>{console.error("Grant report preview failed; check local configuration and service availability.");process.exitCode=1;});
