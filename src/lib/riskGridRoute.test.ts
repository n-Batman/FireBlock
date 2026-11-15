import {describe,it,expect,vi,afterEach} from "vitest";
import {GET} from "@/app/api/risk-grid/route";
afterEach(()=>vi.unstubAllEnvs());
describe("risk coverage endpoint",()=>{
  it("validates bounds before accessing cloud storage",async()=>{
    const response=await GET(new Request("https://test/api/risk-grid?bbox=1,2,0,3"));
    expect(response.status).toBe(400);
  });
  it("serves combined regional snapshots without cloud credentials",async()=>{
    for(const key of ["B2_APPLICATION_KEY_ID","B2_APPLICATION_KEY","B2_BUCKET_NAME"])vi.stubEnv(key,"");
    const response=await GET(new Request("https://test/api/risk-grid?bbox=-120.72,35.24,-120.61,35.31"));
    expect(response.status).toBe(200);
    const grid=await response.json();expect(grid.features.length).toBeGreaterThanOrEqual(1536);
    expect(grid.publication.runs).toEqual(expect.arrayContaining(["20261114T224834Z-781c21500411","20261114T225722Z-c696fb1ab1a0"]));
    const outside=await GET(new Request("https://test/api/risk-grid?bbox=0,0,1,1"));
    expect((await outside.json()).features).toHaveLength(0);
  });
  it("reports partial server configuration instead of silently serving stale data",async()=>{
    vi.stubEnv("B2_APPLICATION_KEY_ID","id");vi.stubEnv("B2_APPLICATION_KEY","");vi.stubEnv("B2_BUCKET_NAME","");
    expect((await GET(new Request("https://test/api/risk-grid"))).status).toBe(503);
  });
});
