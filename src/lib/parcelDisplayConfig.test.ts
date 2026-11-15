import {describe,it,expect} from "vitest";
import {minParcelAcres} from "./parcelDisplayConfig";

describe("parcel acreage tiers",()=>{
  it.each([[20,0],[17,0],[16.9,1],[16,1],[15,4],[14,16],[13,64],[12,256],[0,256]])(
    "uses minimum %s zoom acreage %s",(zoom,acres)=>expect(minParcelAcres(zoom)).toBe(acres));
  it("defaults missing or invalid zoom to full detail",()=>{
    expect(minParcelAcres()).toBe(0);expect(minParcelAcres(NaN)).toBe(0);
  });
});
