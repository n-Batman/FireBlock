import {describe,it,expect} from "vitest";
import {minParcelAcres} from "./parcelDisplayConfig";

describe("parcel acreage tiers",()=>{
  it.each([[20,0],[17,0],[16.9,.25],[16,.25],[15,1],[14,4],[13,16],[12,64],[0,64]])(
    "uses minimum %s zoom acreage %s",(zoom,acres)=>expect(minParcelAcres(zoom)).toBe(acres));
  it("defaults missing or invalid zoom to full detail",()=>{
    expect(minParcelAcres()).toBe(0);expect(minParcelAcres(NaN)).toBe(0);
  });
});
