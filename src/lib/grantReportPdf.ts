/** Server PDF renderer: measured facts are drawn directly; AI supplies prose only. */
import {PDFDocument,StandardFonts,rgb,PDFOperator,PDFOperatorNames,moveTo,lineTo,closePath,pushGraphicsState,popGraphicsState,
  setFillingRgbColor,setStrokingRgbColor,setLineWidth,type PDFPage,type PDFFont} from "pdf-lib";
import type {Position} from "geojson";
import {GrantReportError,METHOD_NOTE,PROGRAM_SOURCE,TREATMENTS,type GrantFacts,type Proof} from "./grantReportData";
import type {GrantNarrative} from "./grantNarrative";

const INK=rgb(.12,.19,.2),MUTED=rgb(.35,.4,.42),GREEN=rgb(.12,.36,.3),PALE=rgb(.94,.96,.95),BORDER=rgb(.8,.85,.83);
const W=612,H=792,M=42,CW=W-2*M;
function printable(value:string,font:PDFFont){
  return [...value.normalize("NFKD").replace(/[\u0300-\u036f]/g,"").replace(/[\u2010-\u2015]/g,"-").replace(/[“”]/g,'"').replace(/[‘’]/g,"'")]
    .map(c=>{try{font.encodeText(c);return c;}catch{return "?";}}).join("");
}
function wrap(value:string,font:PDFFont,size:number,width:number){
  const lines:string[]=[];let line="";
  for(const word of printable(value,font).split(/\s+/)){
    if(font.widthOfTextAtSize(word,size)>width){
      if(line){lines.push(line);line="";}
      let part="";for(const c of word){if(font.widthOfTextAtSize(part+c,size)>width){lines.push(part);part="";}part+=c;}line=part;
    }else if(line&&font.widthOfTextAtSize(line+" "+word,size)>width){lines.push(line);line=word;}
    else line+=(line?" ":"")+word;
  }
  if(line)lines.push(line);return lines;
}
function score(value:number|null|undefined){return value==null?"Not available":value.toFixed(1);}
function riskColor(value:number|null){return value===null?rgb(.76,.79,.8):value<25?rgb(.51,.75,.61):value<50?rgb(.94,.8,.36):value<75?rgb(.91,.53,.29):rgb(.77,.26,.23);}

export async function renderGrantPdf(facts:GrantFacts,narrative:GrantNarrative):Promise<Buffer>{
  const doc=await PDFDocument.create(),regular=await doc.embedFont(StandardFonts.Helvetica),bold=await doc.embedFont(StandardFonts.HelveticaBold);
  doc.setTitle(facts.project_name+" - Grant application draft");doc.setAuthor(facts.prepared_by);doc.setSubject(facts.program);doc.setCreator("FireBlock grant reports");
  let page!:PDFPage;let y=0;
  const draw=(value:string,x:number,top:number,size=10,font=regular,color=INK)=>page.drawText(printable(value,font),{x,y:top-size,size,font,color});
  function fresh(title:string){
    page=doc.addPage([W,H]);page.drawRectangle({x:0,y:H-10,width:W,height:10,color:GREEN});
    draw("FIREBLOCK  /  TREATMENT EVIDENCE",M,H-28,8,bold,GREEN);
    const titleLines=wrap(title,bold,21,CW);let top=H-50;
    for(const line of titleLines){draw(line,M,top,21,bold);top-=26;}
    draw("AI-ASSISTED APPLICATION DRAFT - PREPARER REVIEW REQUIRED",M,top-5,8,bold,MUTED);y=top-31;
  }
  function ensure(height:number,title="Application draft - continued"){if(y-height<58)fresh(title);}
  function para(value:string,size=10,color=INK,width=CW){
    for(const line of wrap(value,regular,size,width)){ensure(size+5);draw(line,M,y,size,regular,color);y-=size+5;}y-=8;
  }
  function section(label:string){ensure(48);draw(label.toUpperCase(),M,y,10,bold,GREEN);y-=21;}
  function field(label:string,value:string){para(label+": "+value,10);}
  fresh(facts.project_name);
  field("Program",facts.program);field("County",facts.county);field("APNs",[...new Set(facts.blocks.map(b=>b.apn))].join(", "));
  field("Report date",facts.report_date);field("Prepared by",facts.prepared_by);field("Applicant",facts.applicant_name??"Applicant to complete");
  if(facts.requested_funding!==null)field("Requested funding",new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(facts.requested_funding));
  section("Treatment summary");
  para(`${facts.total_acres.toFixed(2)} total acres treated | ${facts.date_start} to ${facts.date_end}`,13);
  para(TREATMENTS.map(type=>`${type}: ${facts.acres_by_treatment[type].toFixed(2)} acres`).join("  |  "),10);
  para("Acres, treatment types and treatment dates are provided by the preparer. Count distinct treated ground once; phone scans do not measure acres.",9,MUTED);
  for(const [heading,value] of [["Project summary",narrative.project_summary],["Community benefit",narrative.community_benefit],["Implementation",narrative.implementation],["Monitoring",narrative.monitoring]]){section(heading);para(value);}
  section("Applicant to complete");
  para("Confirm applicant eligibility, project scope and community benefit, itemized budget, landowner permissions, environmental review and the current solicitation's application requirements. This PDF does not submit an application or establish reimbursement eligibility.",9,MUTED);
  for(const item of narrative.missing_information)para("- "+item,9);
  para("Program reference: "+PROGRAM_SOURCE,8,MUTED);

  fresh("Treatment register");
  para("One row per treated block. Risk is a relative satellite/FIRMS model score (0-100), separate from the phone scan's dry vegetation percentage.",10);
  const widths=[114,44,78,74,68,68,82],labels=["Block / APN","Acres","Treatment","Treated","Risk before","Risk after","Scan status"];
  function tableHeader(){
    page.drawRectangle({x:M,y:y-35,width:CW,height:35,color:GREEN});let x=M;
    labels.forEach((label,i)=>{wrap(label,bold,8,widths[i]-10).forEach((line,j)=>draw(line,x+5,y-7-j*10,8,bold,rgb(1,1,1)));x+=widths[i];});y-=35;
  }
  tableHeader();
  for(const [index,b] of facts.blocks.entries()){
    const cells=[b.block_id+" / "+b.apn,b.acres.toFixed(2),b.treatment_type,b.date_treated,score(b.risk_before?.risk_score),score(b.risk_after.risk_score),b.scan_status];
    const lines=cells.map((cell,i)=>wrap(cell,regular,8,widths[i]-10)),height=Math.max(42,...lines.map(l=>l.length*11+14));
    if(y-height<105){fresh("Treatment register - continued");tableHeader();}
    page.drawRectangle({x:M,y:y-height,width:CW,height,color:index%2?rgb(1,1,1):PALE,borderColor:BORDER,borderWidth:.4});let x=M;
    lines.forEach((list,i)=>{list.forEach((line,j)=>draw(line,x+5,y-7-j*11,8));x+=widths[i];});y-=height;
  }
  y-=18;para("Risk before requires a pinned historical cloud publication. After risk is shown only when all contributing model runs are dated on or after treatment and no later than the report date. Not available is never zero. Source imagery may predate work; score changes do not prove treatment effects.",9,MUTED);
  para("Cleared = zero dry vegetation detected in the after-scan view. Still dry = after scan detected dry vegetation. Not scanned = no after scan. These labels apply only to the sampled view and do not certify the parcel.",9,MUTED);
  section("Method note");para(METHOD_NOTE,11);
  para("Dry ground cover (%) in this report is the dry share of visible ground vegetation, excluding vines and trees. It is not percent of the whole frame or parcel. Risk is an experimental relative index, not ignition probability or official fire danger. Valid weather can also contribute to version 2 risk scores.",9,MUTED);

  fresh("Parcel risk map");
  para("Current saved risk by parcel, with before/after scan locations. North up; local equirectangular projection. GIS outlines are for planning, not surveyed boundaries.",10);
  const map={x:M,y:250,w:CW,h:358};
  page.drawRectangle({x:map.x,y:map.y,width:map.w,height:map.h,color:PALE,borderColor:BORDER,borderWidth:1});
  const unique=[...new Map(facts.blocks.map(b=>[b.apn,b])).values()];
  const positions=unique.flatMap(b=>b.parcel.geometry.type==="Polygon"?b.parcel.geometry.coordinates.flat():b.parcel.geometry.coordinates.flat(2));
  const [minLon,minLat,maxLon,maxLat]=positions.reduce((b,p)=>[Math.min(b[0],p[0]),Math.min(b[1],p[1]),Math.max(b[2],p[0]),Math.max(b[3],p[1])],[Infinity,Infinity,-Infinity,-Infinity]);
  const cos=Math.cos((minLat+maxLat)/2*Math.PI/180),spanX=Math.max((maxLon-minLon)*cos,1e-8),spanY=Math.max(maxLat-minLat,1e-8),scale=Math.min((map.w-40)/spanX,(map.h-40)/spanY);
  const offsetX=map.x+(map.w-spanX*scale)/2,offsetY=map.y+(map.h-spanY*scale)/2;
  const xy=(p:Position)=>[offsetX+(p[0]-minLon)*cos*scale,offsetY+(p[1]-minLat)*scale];
  for(const b of unique){
    const polygons=b.parcel.geometry.type==="Polygon"?[b.parcel.geometry.coordinates]:b.parcel.geometry.coordinates;
    const c=riskColor(b.risk_current.risk_score);
    for(const polygon of polygons){
      page.pushOperators(pushGraphicsState(),setFillingRgbColor(c.red,c.green,c.blue),setStrokingRgbColor(.2,.3,.27),setLineWidth(.8));
      for(const ring of polygon){const first=xy(ring[0]);page.pushOperators(moveTo(first[0],first[1]));for(const p of ring.slice(1)){const q=xy(p);page.pushOperators(lineTo(q[0],q[1]));}page.pushOperators(closePath());}
      page.pushOperators(PDFOperator.of(PDFOperatorNames.FillEvenOddAndStroke),popGraphicsState());
    }
  }
  for(const [index,b] of facts.blocks.entries())for(const phase of ["before","after"] as const){
    const proof=b[phase];if(!proof)continue;const p=xy([proof.scan.location.lon,proof.scan.location.lat]);
    const shift=phase==="before"?-5:5;page.drawLine({start:{x:p[0],y:p[1]},end:{x:p[0]+shift,y:p[1]+12},thickness:.7,color:INK});
    page.drawCircle({x:p[0]+shift,y:p[1]+16,size:7,color:phase==="before"?rgb(1,1,1):INK,borderColor:INK,borderWidth:1});
    page.drawText(String(index+1),{x:p[0]+shift-2.5,y:p[1]+13,size:7,font:bold,color:phase==="before"?INK:rgb(1,1,1)});
  }
  draw("N",map.x+map.w-22,map.y+map.h-10,10,bold);page.drawLine({start:{x:map.x+map.w-19,y:map.y+map.h-35},end:{x:map.x+map.w-19,y:map.y+map.h-23},thickness:1,color:INK});
  y=229;
  const legends:[string,number|null][]=[["0-24.9",0],["25-49.9",25],["50-74.9",50],["75-100",75],["Unknown",null]];
  legends.forEach(([label,value],i)=>{const x=M+i*103;page.drawRectangle({x,y:y-12,width:12,height:12,color:riskColor(value)});draw(label,x+17,y,8);});y-=29;
  para("White pins: before. Dark pins: after. Pin numbers match the block numbers below; nearby pins may overlap. Labels are offset from the exact GPS point for legibility.",8,MUTED);
  for(const [i,b] of facts.blocks.entries()){ensure(15,"Map block key - continued");para(`${i+1}. ${b.block_id} | APN ${b.apn} | Current risk ${score(b.risk_current.risk_score)}`,8);}

  for(const [index,b] of facts.blocks.entries()){
    fresh(`Proof ${index+1}: ${b.block_id}`);field("APN",b.apn);field("Treatment",`${b.treatment_type} | ${b.acres.toFixed(2)} acres | ${b.date_treated}`);
    para("Photos attached by the preparer. Dates, times, GPS and measurements below come from the stored scan records; photo capture metadata is not independently verified.",9,MUTED);
    const top=y-8,width=(CW-18)/2;
    const maxInfoHeight=Math.max(...(["before","after"] as const).map(phase=>{
      const proof=b[phase];return proof?proofLines(proof).reduce((sum,line)=>sum+wrap(line,regular,9,width).length*13+6,0):100;
    }));
    const height=Math.min(190,top-22-maxInfoHeight-160);
    for(const [i,phase] of (["before","after"] as const).entries()){
      const x=M+i*(width+18),proof=b[phase];draw(phase.toUpperCase(),x,top,11,bold,GREEN);
      const bottom=top-22-height;page.drawRectangle({x,y:bottom,width,height,color:PALE,borderColor:BORDER,borderWidth:.8});
      if(proof?.photo){
        try{
          const image=proof.photo.content_type==="image/png"?await doc.embedPng(proof.photo.bytes):await doc.embedJpg(proof.photo.bytes);
          if(image.width*image.height>8_000_000)throw new Error();
          const factor=Math.min((width-12)/image.width,(height-12)/image.height);
          page.drawImage(image,{x:x+(width-image.width*factor)/2,y:bottom+(height-image.height*factor)/2,width:image.width*factor,height:image.height*factor});
        }catch{throw new GrantReportError("Photo could not be decoded; attach a valid JPEG or PNG");}
      }else draw(proof?"Photo not supplied":"Not scanned",x+15,bottom+height/2+4,10,regular,MUTED);
      let lineTop=bottom-14;
      const info=proof?proofLines(proof):["No archived scan supplied.","Date / time: Not available","GPS: Not available","Dry ground cover: Not available"];
      for(const value of info){for(const line of wrap(value,regular,9,width)){draw(line,x,lineTop,9);lineTop-=13;}lineTop-=6;}
    }
    y=120;para("Dry ground cover is measured within the phone scan's visible ground vegetation. These photographs sample a view, not the entire block. No before/after comparison is inferred when evidence is missing.",9,MUTED);
  }
  for(const [i,p] of doc.getPages().entries()){
    page=p;page.drawLine({start:{x:M,y:40},end:{x:W-M,y:40},thickness:.5,color:BORDER});
    draw(facts.report_date+" | "+(facts.project_name.startsWith("DEMONSTRATION ONLY")?"SYNTHETIC EXAMPLE":"FireBlock")+" | "+facts.report_id.slice(0,8),M,30,8,regular,MUTED);
    draw(`${i+1} / ${doc.getPageCount()}`,W-M-42,30,8,regular,MUTED);
  }
  return Buffer.from(await doc.save());
}
function proofLines(proof:Proof){
  const s=proof.scan;
  return [`Date / time (UTC): ${new Date(s.scanned_at).toISOString().replace("T"," ").replace(".000Z","Z")}`,
    `GPS: ${s.location.lat.toFixed(6)}, ${s.location.lon.toFixed(6)}`,...(s.location.accuracy_m===undefined?[]:[`GPS accuracy: ${s.location.accuracy_m.toFixed(1)} m`]),
    `Dry ground cover: ${s.score.toFixed(1)}%`,`Measurement: dry share of ground vegetation`,`Method: ${s.model_id}`,`Stored scan: ${s.scan_id}`];
}
