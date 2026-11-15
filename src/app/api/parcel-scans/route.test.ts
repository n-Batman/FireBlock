import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
const {save,history}=vi.hoisted(()=>({save:vi.fn(),history:vi.fn()}));
vi.mock("@/lib/parcelScanArchive",async load=>{
  const actual=await load<typeof import("@/lib/parcelScanArchive")>();
  return {...actual,ParcelScanArchive:class{save=save;history=history;}};
});
import {GET,POST} from "./route";
import {ScanArchiveError} from "@/lib/parcelScanArchive";
const url="https://app.test/api/parcel-scans";
const authorization="Bearer backend-only-token";
beforeEach(()=>{vi.stubEnv("CLOUD_WRITE_TOKEN","backend-only-token");save.mockReset();history.mockReset();});
afterEach(()=>vi.unstubAllEnvs());

describe("backend parcel scan endpoint",()=>{
  it("requires authenticated reads and writes, including localhost",async()=>{
    expect((await GET(new Request(url+"?parcel_id=123"))).status).toBe(401);
    expect((await POST(new Request("http://localhost/api/parcel-scans",{method:"POST",body:"{}"}))).status).toBe(401);
    expect((await GET(new Request(url,{headers:{authorization:"Bearer wrong"}}))).status).toBe(401);
    expect(save).not.toHaveBeenCalled();expect(history).not.toHaveBeenCalled();
  });
  it("fails closed when archive authentication is not configured",async()=>{
    vi.stubEnv("CLOUD_WRITE_TOKEN","");
    expect((await POST(new Request(url,{method:"POST",headers:{authorization},body:"{}"}))).status).toBe(503);
  });
  it("archives an authorized observation and disables response caching",async()=>{
    const input={score:70};save.mockResolvedValue({scan:{scan_id:"saved"},receipt:{file_id:"verified"}});
    const result=await POST(new Request(url,{method:"POST",headers:{authorization},body:JSON.stringify(input)}));
    expect(result.status).toBe(201);expect(save).toHaveBeenCalledWith(input);
    expect(result.headers.get("cache-control")).toBe("private, no-store");
    expect(await result.json()).toMatchObject({receipt:{file_id:"verified"}});
  });
  it("reads one parcel page and forwards its bounded pagination options",async()=>{
    history.mockResolvedValue({scans:[],next_cursor:null});
    const result=await GET(new Request(url+"?parcel_id=123-456&cursor=next&limit=20",{headers:{authorization}}));
    expect(result.status).toBe(200);expect(history).toHaveBeenCalledWith("123-456","next",20);
    expect(result.headers.get("cache-control")).toContain("no-store");
    expect((await GET(new Request(url,{headers:{authorization}}))).status).toBe(400);
  });
  it("rejects malformed or oversized streamed JSON before archiving",async()=>{
    expect((await POST(new Request(url,{method:"POST",headers:{authorization},body:"{"}))).status).toBe(400);
    expect((await POST(new Request(url,{method:"POST",headers:{authorization,"content-length":"2"},body:"x".repeat(32769)}))).status).toBe(413);
    expect(save).not.toHaveBeenCalled();
  });
  it("returns validation errors and redacts provider/storage failures",async()=>{
    save.mockRejectedValueOnce(new ScanArchiveError("No matching parcel",422));
    expect((await POST(new Request(url,{method:"POST",headers:{authorization},body:"{}"}))).status).toBe(422);
    history.mockRejectedValueOnce(new Error("private-cloud-key"));
    const result=await GET(new Request(url+"?parcel_id=123",{headers:{authorization}}));
    expect(result.status).toBe(502);expect(JSON.stringify(await result.json())).not.toContain("private-cloud-key");
  });
});
