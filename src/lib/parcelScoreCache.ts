import type {ParcelUnit,ParcelScore} from "@/data/types";

/** Owned by one hook and one risk/scan version; never shared across users. */
export class ParcelScoreCache {
  private entries=new Map<string,{geometry:string;score:ParcelScore|null;bytes:number}>();
  private bytes=0;
  get stats(){return {entries:this.entries.size,bytes:this.bytes};}
  clear(){this.entries.clear();this.bytes=0;}
  get(unit:ParcelUnit,compute:()=>ParcelScore|null):ParcelScore|null {
    const geometry=JSON.stringify(unit.parts);
    const old=this.entries.get(unit.id);
    if(old?.geometry===geometry){this.entries.delete(unit.id);this.entries.set(unit.id,old);return structuredClone(old.score);}
    const score=compute();
    if(old){this.bytes-=old.bytes;this.entries.delete(unit.id);}
    const bytes=new TextEncoder().encode(geometry).byteLength;
    if(bytes<=128*1024){
      this.entries.set(unit.id,{geometry,score:structuredClone(score),bytes});this.bytes+=bytes;
      // A provider response has up to 500 parcels. A smaller LRU evicts the
      // start of a full response before its next pass, making every score miss.
      while(this.entries.size>512||this.bytes>1024*1024){
        const first=this.entries.keys().next().value!;this.bytes-=this.entries.get(first)!.bytes;this.entries.delete(first);
      }
    }
    return score;
  }
}
